#!/usr/bin/env python3
"""
Nona Metadata — client library, CLI, and MCP server.

Nona Metadata (https://github.com/wesamjabali/nona-metadata) turns a media link
(YouTube, SoundCloud, Bandcamp, ...) into a properly tagged file in a music
library: `Artist/Album/Track.m4a` plus `.lrc` lyrics and `cover.*` art.

Its HTTP API only accepts a *URL*. This module closes the gap for agents and
humans who think in song names: it resolves "Shadi by Fairuz" to a link that is
verified downloadable, then hands that link to Nona.

Three ways to use it:

  CLI      python nona_mcp.py add "Shadi by Fairuz"
  Library  from nona_mcp import resolve, add_music, wait_for_job
  MCP      python nona_mcp.py serve        # stdio MCP server for Hermes etc.

Configuration (env):
  NONA_BASE_URL   Nona API root.            default http://localhost:80
  NONA_YTDLP      yt-dlp executable.        default "yt-dlp" from PATH
  NONA_TIMEOUT    httpx-free HTTP timeout.  default 60 (seconds)
"""

from __future__ import annotations

import argparse
import difflib
import http.client
import json
import math
import os
import re
import subprocess
import sys
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request

DEFAULT_BASE_URL = os.environ.get("NONA_BASE_URL", "http://localhost:80").rstrip("/")
YTDLP = os.environ.get("NONA_YTDLP", "yt-dlp")
HTTP_TIMEOUT = float(os.environ.get("NONA_TIMEOUT", "60"))

# Nona reports "processing" while a job runs. Everything else is finished:
# "completed", "failed", and "stopped" — which is what the server sets on its own
# startup for any job that was in flight when it restarted
# (see `stopAllProcessingJobs` in src/services/cache.ts). Listing the *running*
# states instead of the terminal ones means a status we have never seen is
# treated as finished rather than waited on forever.
RUNNING_STATUSES = {"processing", "pending", "queued", "starting", "running"}

# Sources Nona can ingest, mapped to the yt-dlp search prefix that finds them.
SEARCH_PREFIX = {
    "youtube": "ytsearch",
    "soundcloud": "scsearch",
    "bandcamp": "ytsearch",
}

# Title words that usually mean "not the recording you asked for". Each is only
# penalised when the query itself did not ask for it.
NOISE_WORDS = (
    "remix", "cover", "reaction", "karaoke", "instrumental", "slowed",
    "reverb", "sped up", "nightcore", "mashup", "tutorial", "loop",
    "extended", "1 hour", "one hour", "8d audio", "bass boosted", "teaser",
    "da3", "dabke", "bootleg", "edit", "vip mix", "flip", "rework",
    "audition", "the voice", "x factor", "arab idol", "tribute", "impersonat",
)
# A performance captured in front of people, or a re-recording, is not the
# release. Penalised harder than the generic noise above: a live take is
# *almost* right, which makes it the most annoying kind of wrong.
LIVE_WORDS = (
    "live", "concert", "festival", "unplugged", "acoustic", "session",
    "on tour", "in concert", "at the", "mtv", "nobel", "coke studio",
    "orchestra", "symphony", "audience", "soundcheck", "rehearsal",
    "soundtrack", "remake", "revisited", "anniversary edition",
)
# Markers of the released recording, when the uploader bothered to say so.
STUDIO_WORDS = (
    "audio", "album version", "studio version", "original version",
    "original recording", "full song", "official",
)
# Words YouTube appends to auto-generated artist channels ("Fairuz - Topic").
CHANNEL_NOISE = {"topic", "vevo", "official"}
# A "<Artist> - Topic" channel is assembled by YouTube from the label's own
# release, so it is the most reliable "this is the studio recording" signal there
# is — worth more than any title keyword.
TOPIC_BONUS = 6.0

# Rough Arabic -> Latin letters, used only to compare names written in different
# scripts ("سناء موسى" vs "Sanaa Moussa"). Not a linguistically correct
# transliteration — it just has to make the two spellings look alike.
ARABIC_TRANSLIT = {
    "ا": "a", "أ": "a", "إ": "i", "آ": "a", "ٱ": "a", "ب": "b", "ت": "t",
    "ث": "th", "ج": "j", "ح": "h", "خ": "kh", "د": "d", "ذ": "dh", "ر": "r",
    "ز": "z", "س": "s", "ش": "sh", "ص": "s", "ض": "d", "ط": "t", "ظ": "z",
    "ع": "a", "غ": "gh", "ف": "f", "ق": "q", "ك": "k", "ل": "l", "م": "m",
    "ن": "n", "ه": "h", "و": "u", "ي": "i", "ى": "a", "ة": "a", "ء": "",
    "ئ": "", "ؤ": "", "ﻻ": "la", "پ": "p", "چ": "ch", "ژ": "zh", "گ": "g",
}
# Canonical uploads live on YouTube and Nona's metadata/thumbnail pipeline is
# strongest there, so an equally-scoring YouTube hit beats another source.
SOURCE_BONUS = {"youtube": 1.5, "soundcloud": 0.0, "bandcamp": 0.0}
# Prefer full songs over shorts/clips; seconds.
DURATION_IDEAL = (60, 600)
DURATION_OK = (30, 1800)

# Some artists' canonical recordings are long live performances — Oum Kalthoum's
# famous takes run 30-60 minutes, so the short studio edit is the *wrong* answer
# and the length is the whole point. A "full" request inverts the duration
# preference instead of fighting it.
FULL_MIN_SECONDS = 1200  # 20 minutes: the bar for "a full version"
CONCERT_SECONDS = 5400   # 90 minutes: that is many songs, not one
SHORT_WORDS = (
    "part 1", "part 2", "part 3", "part one", "part two", "excerpt", "clip",
    "short version", "radio edit", "teaser", "مقطع", "جزء", "مختصر",
)
FULL_WORDS = (
    "complete", "full version", "full song", "كاملة", "كامله", "الكاملة",
    "full", "live at", "حفلة كاملة",
)

STOPWORDS = {
    "the", "a", "an", "and", "by", "of", "for", "feat", "ft", "with",
    "official", "video", "audio", "song", "track", "lyrics", "lyric", "hd",
    "hq", "full", "album", "music",
}


class NonaError(RuntimeError):
    """Any failure talking to Nona or resolving a link."""


# --------------------------------------------------------------------------- #
# HTTP client
# --------------------------------------------------------------------------- #
def _request(method: str, path: str, body=None, params=None, base_url=None,
             timeout=HTTP_TIMEOUT, retries: int = 3):
    url = (base_url or DEFAULT_BASE_URL).rstrip("/") + path
    if params:
        url += "?" + urllib.parse.urlencode(params)
    data = json.dumps(body).encode("utf-8") if body is not None else None

    last_error = None
    for attempt in range(max(1, retries)):
        req = urllib.request.Request(url, data=data, method=method)
        # Nona serves the SPA on /jobs unless the client asks for JSON.
        req.add_header("Accept", "application/json")
        if data is not None:
            req.add_header("Content-Type", "application/json")
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                raw = resp.read().decode("utf-8", "replace")
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode("utf-8", "replace")[:400]
            message = f"{method} {path} -> HTTP {exc.code}: {detail}"
            # 5xx is worth another go; 4xx is our mistake and never will be.
            if exc.code < 500:
                raise NonaError(message) from None
            last_error = NonaError(message)
        except (urllib.error.URLError, http.client.HTTPException,
                ConnectionError, TimeoutError) as exc:
            # A dropped connection under load is not a reason to abandon a
            # 20-song batch. `RemoteDisconnected` lands here, and it used to
            # take the whole run down with it.
            last_error = NonaError(f"{method} {path} -> {exc!r}")
        else:
            if not raw.strip():
                return {}
            try:
                return json.loads(raw)
            except json.JSONDecodeError:
                raise NonaError(
                    f"{method} {path} -> non-JSON response: {raw[:200]}"
                ) from None
        if attempt < retries - 1:
            time.sleep(min(2 ** attempt, 8))

    raise last_error if last_error else NonaError(f"{method} {path} -> request failed")


def api_get(path, params=None, **kw):
    return _request("GET", path, params=params, **kw)


def api_post(path, body=None, **kw):
    return _request("POST", path, body=body if body is not None else {}, **kw)


def api_patch(path, body=None, **kw):
    return _request("PATCH", path, body=body if body is not None else {}, **kw)


def api_delete(path, params=None, **kw):
    return _request("DELETE", path, params=params, **kw)


def health(base_url=None) -> dict:
    """Cheap liveness probe: /cache/stats is JSON and always cheap."""
    return api_get("/cache/stats", base_url=base_url)


# --------------------------------------------------------------------------- #
# Link resolution: song name -> downloadable URL
# --------------------------------------------------------------------------- #
def _normalize(text: str, strip_brackets: bool = True) -> str:
    text = unicodedata.normalize("NFKD", text or "")
    text = "".join(ch for ch in text if not unicodedata.combining(ch))
    text = text.lower()
    if strip_brackets:
        text = re.sub(r"[\(\[\{][^\)\]\}]*[\)\]\}]", " ", text)
    text = re.sub(r"[^\w\s\u0600-\u06FF]+", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def _tokens(text: str, strip_brackets: bool = True) -> list[str]:
    raw = [
        t for t in _normalize(text, strip_brackets=strip_brackets).split()
        if t and t not in STOPWORDS
    ]
    # Collapse stylised spaced-out names: "E M E L" -> "emel", "Z E Y N E" -> "zeyne".
    out: list[str] = []
    run: list[str] = []
    for token in raw:
        if len(token) == 1:
            run.append(token)
            continue
        if len(run) > 1:
            out.append("".join(run))
        elif run:
            out.extend(run)
        run = []
        out.append(token)
    if len(run) > 1:
        out.append("".join(run))
    elif run:
        out.extend(run)
    return out


def _latin_tokens(tokens: list[str]) -> list[str]:
    return [t for t in tokens if re.search(r"[a-z]", t)]


def _phrase_present(haystack: str, phrase: str) -> bool:
    """Word-boundary containment, so "live" does not match "olive"."""
    return (
        re.search(rf"(?<![0-9a-z]){re.escape(phrase)}(?![0-9a-z])", haystack.lower())
        is not None
    )


def _is_topic_channel(uploader: str) -> bool:
    """True for YouTube's auto-generated "<Artist> - Topic" channels."""
    return _phrase_present(uploader or "", "topic")


def _similar(a: str, b: str, threshold: float = 0.8) -> bool:
    """Fuzzy token equality across spellings and scripts.

    Latin transliterations of the same name vary wildly ("Shadi"/"Shady"/
    "Chadi", "Fairuz"/"Fairouz"/"Fayrouz"), Arabic spellings differ by hamza and
    ya/alf-maqsura, and the same artist is written in Latin on one channel and
    Arabic on another ("سناء موسى" vs "Sanaa Moussa"). Exact string comparison
    loses all of those, so tokens are reduced to a comparison key first.
    """
    key_a, key_b = _match_key(a), _match_key(b)
    if key_a == key_b:
        return True
    if len(key_a) < 3 or len(key_b) < 3:
        return False
    if key_a in key_b or key_b in key_a:
        return True
    return difflib.SequenceMatcher(None, key_a, key_b).ratio() >= threshold


def _match_key(token: str) -> str:
    """Reduce a token to a spelling-insensitive, script-insensitive key."""
    if re.search(r"[\u0600-\u06FF]", token):
        token = _transliterate_arabic(token)
    # Collapse doubled letters so "Moussa" == "Mousa" and "Sanaa" == "Sana",
    # and fold y to i so "Shady" == "Shadi" and "ya" == "يا".
    token = token.replace("y", "i")
    return re.sub(r"(.)\1+", r"\1", token)


def _same_name(a: str, b: str, threshold: float = 0.85) -> bool:
    """Strict name equality, for deciding "do I already have this song?".

    Deliberately much stricter than `_similar`, which is tuned for spotting a
    song name inside a noisy video title. Here a false match silently drops a
    song the user asked for, so a short token may never match a long one
    ("ana" must not match "alruzana") and merely-similar mid-length names
    ("ghzali" vs "ghalia") must not match either. A false miss only costs a
    duplicate, which is recoverable.
    """
    key_a, key_b = _match_key(a), _match_key(b)
    if key_a == key_b:
        return True
    if min(len(key_a), len(key_b)) < 3:
        return False
    if min(len(key_a), len(key_b)) / max(len(key_a), len(key_b)) < 0.7:
        return False
    if key_a in key_b or key_b in key_a:
        return True
    return difflib.SequenceMatcher(None, key_a, key_b).ratio() >= threshold


def _transliterate_arabic(text: str) -> str:
    """Rough Arabic -> Latin map, only for comparing names across scripts."""
    return "".join(ARABIC_TRANSLIT.get(ch, ch) for ch in text)


def looks_like_url(value: str) -> bool:
    value = (value or "").strip()
    return bool(re.match(r"^https?://", value, re.I))


def yt_search(query: str, source: str = "youtube", limit: int = 6,
              ytdlp: str = YTDLP) -> list[dict]:
    """Search a source with yt-dlp and return candidate dicts."""
    prefix = SEARCH_PREFIX.get(source)
    if not prefix:
        raise NonaError(f"Unsupported source {source!r}; use youtube or soundcloud")
    template = (
        "%(title)s\t%(uploader,channel|)s\t%(duration|)s\t"
        "%(webpage_url,url|)s\t%(view_count|)s"
    )
    cmd = [
        ytdlp, "--no-warnings", "--ignore-errors", "--flat-playlist",
        "--print", template, f"{prefix}{limit}:{query}",
    ]
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=180)
    except FileNotFoundError:
        raise NonaError(
            f"yt-dlp not found at {ytdlp!r}. Install it or set NONA_YTDLP."
        ) from None
    except subprocess.TimeoutExpired:
        raise NonaError(f"yt-dlp search timed out for {query!r}") from None

    candidates = []
    for position, line in enumerate(proc.stdout.splitlines()):
        parts = (line.split("\t") + [""] * 5)[:5]
        title, uploader, duration, url, views = parts
        if not url:
            continue

        def _num(value):
            try:
                return int(float(value))
            except (TypeError, ValueError):
                return None

        candidates.append({
            "title": title,
            "uploader": uploader,
            "duration": _num(duration),
            "url": url,
            "view_count": _num(views),
            "source": source,
            "rank": position,
        })
    if not candidates and proc.stderr.strip():
        raise NonaError(f"yt-dlp search failed: {proc.stderr.strip()[:300]}")
    return candidates


def _is_artist_channel(uploader: str, query: str) -> bool:
    """True when the channel is essentially just the requested artist.

    The artist's own channel ("Fairuz", "E M E L - آمال مثلوثي", "Fairuz - Topic")
    carries the canonical recording, so it is the single strongest signal we
    have. Everything else the channel name says must have come from the request,
    otherwise it is somebody else's channel (a fan page, a talent show, a
    compilation account).

    Only the channel's Latin-script tokens are required to match: artist channels
    commonly append the name in its own script, which will never fuzzy-match a
    Latin query.
    """
    channel_tokens = [t for t in _tokens(uploader) if t not in CHANNEL_NOISE]
    if not channel_tokens:
        return False
    comparable = _latin_tokens(channel_tokens) or channel_tokens
    query_tokens = _tokens(query)
    return all(
        any(_similar(ct, qt, 0.75) for qt in query_tokens) for ct in comparable
    )


def score_candidate(candidate: dict, query: str, version: str = "studio") -> float:
    """Rank a search hit against the requested song name.

    Deliberately rewards precision as well as recall: a title that contains every
    requested word *and nothing else* is the recording itself, whereas one that
    contains the words plus four others is somebody's cover, reaction or medley.

    `version` is "studio" (prefer the released recording, penalise live takes) or
    "full" (prefer the long version, as for Oum Kalthoum where the canonical
    recording *is* the 40-minute concert take).
    """
    title = candidate.get("title") or ""
    uploader = candidate.get("uploader") or ""
    q_tokens = _tokens(query)
    # Recall looks at the whole title (a song name hidden in "(...)" still counts);
    # precision looks at the title without its bracketed tails, so a title padded
    # with "(Official Video)" boilerplate is not punished for boilerplate.
    recall_tokens = _tokens(title, strip_brackets=False)
    t_tokens = _tokens(title)
    if not q_tokens:
        return 0.0

    matched = sum(1 for tok in q_tokens if any(_similar(tok, t) for t in recall_tokens))
    coverage = matched / len(q_tokens)  # did we find the words?
    precision = matched / len(t_tokens) if t_tokens else 0.0  # is the title just that?
    score = coverage * 8.0 + precision * 5.0
    if coverage == 1.0:
        score += 3.0

    # A short request answered by a very long title is usually somebody's
    # description, concert listing, compilation or commentary, not the track.
    score -= 0.5 * max(0, len(t_tokens) - len(q_tokens) - 2)

    if _is_artist_channel(uploader, query):
        score += 6.0

    if _is_topic_channel(uploader):
        score += TOPIC_BONUS

    lowered = title.lower()
    asked = query.lower()
    duration = candidate.get("duration")

    if version == "full":
        if duration is None:
            # "Full" is a decision about length. An entry whose length we cannot
            # read cannot be confirmed as the long version, so it must not win by
            # default over one that can.
            score -= 1.5
        if duration:
            if duration >= FULL_MIN_SECONDS:
                score += 4.0          # exactly what was asked for
            elif duration >= 900:
                score += 2.5
            elif duration >= 600:
                score += 1.0
            elif duration < 300:
                score -= 4.0          # a clip, not the song
            if duration > CONCERT_SECONDS:
                score -= 3.0          # a whole concert, not one song
        for word in SHORT_WORDS:
            if _phrase_present(lowered, word) and not _phrase_present(asked, word):
                score -= 3.0
        for word in FULL_WORDS:
            if _phrase_present(lowered, word):
                score += 2.0
        # These artists' canonical takes are live, so being live is not a fault —
        # but a two-hour concert recording is still the wrong thing to pick.
        for word in LIVE_WORDS:
            if _phrase_present(lowered, word) and not _phrase_present(asked, word):
                score -= 1.5
    else:
        for word in NOISE_WORDS:
            if _phrase_present(lowered, word) and not _phrase_present(asked, word):
                score -= 3.0
        for word in LIVE_WORDS:
            if _phrase_present(lowered, word) and not _phrase_present(asked, word):
                score -= 4.5
        for word in STUDIO_WORDS:
            if _phrase_present(lowered, word):
                score += 2.0
        if duration:
            if DURATION_IDEAL[0] <= duration <= DURATION_IDEAL[1]:
                score += 2.0
            elif not (DURATION_OK[0] <= duration <= DURATION_OK[1]):
                score -= 2.0

    # Popularity separates equally-named uploads; sqrt keeps the top of the range
    # discriminating instead of flattening every million-view video together.
    views = candidate.get("view_count") or 0
    score += min(math.sqrt(views) / 200.0, 8.0)

    score += SOURCE_BONUS.get(candidate.get("source") or "", 0.0)

    # Trust the search engine a little: its ranking is a strong prior, and pure
    # feature scoring tends to outsmart it on well-formed queries.
    rank = candidate.get("rank")
    if isinstance(rank, int):
        score += max(0.0, 2.0 - 0.5 * rank)
    return round(score, 3)


def probe_url(url: str, ytdlp: str = YTDLP, timeout: int = 120) -> dict:
    """Verify a URL is actually fetchable before Nona is asked to process it.

    This is the "a URL that works" guarantee: the same yt-dlp Nona uses is asked
    to extract metadata; if it cannot, the link is rejected here instead of
    becoming a failed job.
    """
    cmd = [
        ytdlp, "--no-warnings", "--simulate", "--no-playlist",
        "--print", "%(title)s\t%(uploader,channel|)s\t%(duration|)s\t%(is_live|)s",
        url,
    ]
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
    except FileNotFoundError:
        raise NonaError(f"yt-dlp not found at {ytdlp!r}") from None
    except subprocess.TimeoutExpired:
        raise NonaError(f"Timed out verifying {url}") from None
    if proc.returncode != 0 or not proc.stdout.strip():
        reason = (proc.stderr or proc.stdout).strip().splitlines()
        reason = reason[-1] if reason else "unknown error"
        raise NonaError(f"Link is not downloadable ({reason[:200]}): {url}")

    parts = (proc.stdout.splitlines()[0].split("\t") + [""] * 4)[:4]
    title, uploader, duration, is_live = parts
    try:
        duration = int(float(duration)) if duration else None
    except ValueError:
        duration = None
    if is_live == "True":
        raise NonaError(f"Refusing a live stream: {url}")
    return {"url": url, "title": title, "uploader": uploader, "duration": duration}


def resolve(query: str, source: str = "auto", limit: int = 6, ytdlp: str = YTDLP,
            verify: bool = True, version: str = "studio") -> dict:
    """Turn a song name (or URL) into a Nona-processable link.

    `version` is "studio" or "full" — see `score_candidate`.

    Returns a resolved dict including `alternatives`, the ranked candidates that
    were considered, so a caller can offer choices if the pick looks wrong.
    """
    query = (query or "").strip()
    if not query:
        raise NonaError("Empty search query")

    if looks_like_url(query):
        info = probe_url(query, ytdlp=ytdlp) if verify else {"url": query}
        info.update({"query": query, "score": None, "alternatives": [], "picked": "url"})
        return info

    sources = ["youtube", "soundcloud"] if source == "auto" else [source]
    ranked, errors = [], []
    for src in sources:
        try:
            hits = yt_search(query, source=src, limit=limit, ytdlp=ytdlp)
        except NonaError as exc:
            errors.append(str(exc))
            continue
        for hit in hits:
            hit["score"] = score_candidate(hit, query, version)
        ranked.extend(sorted(hits, key=lambda h: h["score"], reverse=True))

    if not ranked:
        raise NonaError(
            f"No results for {query!r}. " + ("; ".join(errors) if errors else "")
        )

    ranked.sort(key=lambda h: (h["score"], h.get("view_count") or 0), reverse=True)
    tried = []
    if not verify:
        best = dict(ranked[0])
        best.update({"query": query, "alternatives": ranked[1:6], "picked": "search"})
        return best

    for candidate in ranked[:5]:
        tried.append(f"{candidate['title']} [{candidate['url']}]")
        try:
            probed = probe_url(candidate["url"], ytdlp=ytdlp)
        except NonaError as exc:
            errors.append(str(exc))
            continue
        # Keep the search title when the probe title is empty.
        probed.setdefault("title", candidate["title"])
        probed.update({
            "query": query,
            "score": candidate["score"],
            "source": candidate["source"],
            "alternatives": [c for c in ranked if c["url"] != candidate["url"]][:5],
            "picked": "search",
        })
        return probed

    raise NonaError(
        f"Found {len(ranked)} candidates for {query!r} but none were downloadable. "
        + "; ".join(errors[-2:])
    )


# --------------------------------------------------------------------------- #
# Nona API operations
# --------------------------------------------------------------------------- #
def add_url(url: str, base_url=None) -> dict:
    """POST a media URL to Nona; returns the created job."""
    return api_post("/", {"prompt": url}, base_url=base_url)


def get_job(job_id: str, base_url=None) -> dict:
    return api_get(f"/jobs/{job_id}", base_url=base_url)


def list_jobs(limit: int = 20, base_url=None) -> list[dict]:
    jobs = api_get("/jobs", base_url=base_url).get("jobs", [])
    return jobs[:limit]


def wait_for_job(job_id: str, timeout: float = 900, interval: float = 3.0,
                 base_url=None, on_update=None) -> dict:
    """Poll a job until it stops running."""
    deadline = time.time() + timeout
    last = None
    while True:
        job = get_job(job_id, base_url=base_url)
        if on_update and job.get("status") != last:
            on_update(job)
        last = job.get("status")
        if (job.get("status") or "").lower() not in RUNNING_STATUSES:
            return job
        if time.time() >= deadline:
            raise NonaError(
                f"Job {job_id} still {job.get('status')!r} after {timeout:.0f}s"
            )
        time.sleep(interval)


def add_music(query: str, source: str = "auto", wait: bool = True,
              timeout: float = 900, base_url=None, ytdlp: str = YTDLP,
              verify: bool = True, version: str = "studio") -> dict:
    """Resolve a song name (or URL) and have Nona download + tag it.

    Returns {"resolved": ..., "job": ..., "result": ...}.
    """
    resolved = resolve(query, source=source, ytdlp=ytdlp, verify=verify,
                       version=version)
    job = add_url(resolved["url"], base_url=base_url)
    job_id = job.get("jobId")
    out = {"resolved": resolved, "job": job, "result": None}
    if wait and job_id:
        out["result"] = wait_for_job(job_id, timeout=timeout, base_url=base_url)
    return out


def list_files(query: str = "", base_url=None) -> dict:
    data = api_get("/files", base_url=base_url)
    if query:
        needle = _normalize(query)
        data = dict(data)
        data["files"] = [
            f for f in data.get("files", []) if needle in _normalize(f)
        ]
        data["matched"] = len(data["files"])
    return data


def library_stats(base_url=None) -> dict:
    return {
        "cache": api_get("/cache/stats", base_url=base_url),
        "files": {k: v for k, v in api_get("/files", base_url=base_url).items()
                  if k != "files"},
    }


# --------------------------------------------------------------------------- #
# Bulk: resolve a list of songs, skip what is already filed, process the rest
# --------------------------------------------------------------------------- #
AUDIO_EXTENSIONS = (".m4a", ".mp3", ".flac", ".ogg", ".opus", ".wav", ".aac")


def build_library_index(base_url=None) -> list[dict]:
    """Every audio file already filed, with tokens for fuzzy matching."""
    data = api_get("/files", base_url=base_url)
    index = []
    for path in data.get("files", []):
        if not path.lower().endswith(AUDIO_EXTENSIONS):
            continue
        parts = path.split("/")
        track = parts[-1].rsplit(".", 1)[0]
        artist = parts[0] if len(parts) >= 3 else ""
        # Album folders add noise ("Unknown Album"), so match on artist + track.
        index.append({
            "path": path,
            "artist": artist,
            "track": track,
            "tokens": set(_tokens(track)) | set(_tokens(artist)),
        })
    return index


def match_in_library(query: str, index: list[dict], threshold: float = 0.8):
    """Closest already-filed track for a request, if it is a confident match.

    Returns (entry | None, coverage). Coverage is the share of the request's
    words found in the file's artist/track names, so "Shadi by Fairuz" matches
    "Fairuz/Habbaitak Be El Saif/Shady.m4a" completely and a different Fairuz
    song only partially.

    One- and two-letter words are ignored ("Li Beirut" vs a filed "Le Beirut"):
    they are articles/prepositions that differ between transliterations, and
    keeping them would make the same song look like a different one.
    """
    q_tokens = [t for t in _tokens(query) if len(t) > 2] or _tokens(query)
    if not q_tokens:
        return None, 0.0
    best, best_coverage = None, 0.0
    for entry in index:
        matched = sum(
            1 for tok in q_tokens if any(_same_name(tok, x) for x in entry["tokens"])
        )
        coverage = matched / len(q_tokens)
        if coverage > best_coverage:
            best, best_coverage = entry, coverage
    if best_coverage >= threshold:
        return best, best_coverage
    return None, best_coverage


def add_many(queries, source: str = "auto", skip_existing: bool = True,
             dry_run: bool = False, batch_size: int = 2, timeout: float = 900,
             limit: int | None = None, wait: bool = True, version: str = "studio",
             base_url=None, ytdlp: str = YTDLP, progress=None) -> dict:
    """Resolve many song names and hand each to Nona.

    Skips anything already in the library (matched on artist/track names) and
    processes the rest in small batches, so a long list does not open twenty
    simultaneous downloads on the server.

    Set `wait=False` for long lists: jobs are submitted and their ids returned
    immediately, to be polled later (a 20-song run can outlast one call).

    `progress` is called with each finished row as it lands, for live reporting.
    """
    queries = [q.strip() for q in queries if q and q.strip()]
    if limit:
        queries = queries[:limit]
    index = build_library_index(base_url=base_url) if skip_existing else []
    rows: list[dict] = []

    def emit(row):
        rows.append(row)
        if progress:
            progress(row)

    for start in range(0, len(queries), max(1, batch_size)):
        submitted = []
        for query in queries[start:start + max(1, batch_size)]:
            row = {"query": query}
            try:
                if skip_existing:
                    existing, coverage = match_in_library(query, index)
                    if existing:
                        row.update({
                            "status": "already_in_library",
                            "existing": existing["path"],
                            "match": round(coverage, 2),
                        })
                        emit(row)
                        continue
                resolved = resolve(query, source=source, ytdlp=ytdlp,
                                   version=version)
                row.update({
                    "url": resolved["url"],
                    "video": resolved.get("title"),
                    "channel": resolved.get("uploader"),
                })
                if dry_run:
                    row["status"] = "planned"
                    emit(row)
                    continue
                job = add_url(resolved["url"], base_url=base_url)
                row.update({"status": "submitted", "jobId": job.get("jobId")})
                submitted.append(row)
            except Exception as exc:  # one bad song must not kill the batch
                row.update({"status": "error", "error": str(exc)})
                emit(row)

        # Wait for this batch before opening the next one.
        for row in submitted:
            if not wait:
                row["status"] = "submitted"
                emit(row)
                continue
            try:
                result = wait_for_job(row["jobId"], timeout=timeout, base_url=base_url)
                row["status"] = (result.get("status") or "unknown").lower()
                row["result"] = result.get("results") or []
                row["errors"] = result.get("errors") or []
            except Exception as exc:  # a dropped poll must not lose the batch
                row.update({"status": "timeout", "error": str(exc)})
            emit(row)

    summary = {
        "requested": len(queries),
        "added": sum(1 for r in rows if r.get("status") in ("completed", "completed_with_errors")),
        "skipped": sum(1 for r in rows if r.get("status") == "already_in_library"),
        "planned": sum(1 for r in rows if r.get("status") == "planned"),
        "submitted": sum(1 for r in rows if r.get("status") == "submitted"),
        "failed": sum(1 for r in rows if r.get("status") in
                      ("error", "failed", "timeout", "stopped")),
    }
    # A stopped job means the server restarted underneath it; the song did not
    # land, so it is safe and correct to re-run that line.
    summary["retryable"] = [r["query"] for r in rows
                            if r.get("status") in ("stopped", "error", "timeout")]
    return {"summary": summary, "rows": rows}


def format_many(payload: dict) -> str:
    """Compact report for add_many()."""
    lines = []
    for row in payload["rows"]:
        status = row.get("status", "?")
        if status == "already_in_library":
            lines.append(f"  [have]  {row['query']}  ->  {row['existing']}")
        elif status == "planned":
            lines.append(f"  [plan]  {row['query']}  ->  {row['url']}")
        elif status in ("completed", "completed_with_errors"):
            for item in row.get("result") or []:
                lines.append(
                    f"  [added] {item.get('artist')} — {item.get('title')}"
                    f"{' [' + str(item['album']) + ']' if item.get('album') else ''}"
                    f"   <{row['url']}>"
                )
        elif status == "stopped":
            lines.append(f"  [stopped] {row['query']}: server restarted mid-job;"
                         f" re-run this line")
        else:
            lines.append(f"  [{status}] {row['query']}: "
                         f"{row.get('error') or row.get('errors') or ''}")
    s = payload["summary"]
    lines.append(
        f"\nrequested {s['requested']} | added {s['added']} | "
        f"already had {s['skipped']} | planned {s['planned']} | failed {s['failed']}"
    )
    if s.get("retryable"):
        lines.append("re-run these: " + "; ".join(s["retryable"]))
    return "\n".join(lines)


def format_result(payload: dict) -> str:
    """Human-readable summary of add_music() output."""
    resolved = payload.get("resolved") or {}
    result = payload.get("result") or {}
    lines = [
        f"Link      : {resolved.get('url')}",
        f"Video     : {resolved.get('title')} — {resolved.get('uploader') or '?'}"
        + (f" ({resolved['duration']}s)" if resolved.get("duration") else ""),
        f"Job       : {(payload.get('job') or {}).get('jobId')} "
        f"({(payload.get('job') or {}).get('type')})",
    ]
    if result:
        lines.append(f"Status    : {result.get('status')}")
        for item in result.get("results") or []:
            bits = [b for b in (
                f"{item['duration']}s" if item.get("duration") else None,
                item.get("genre"),
                item.get("language"),
            ) if b]
            lines.append(
                f"Track     : {item.get('artist')} — {item.get('title')}"
                f"{' [' + str(item['album']) + ']' if item.get('album') else ''}"
                f"{' (' + ', '.join(bits) + ')' if bits else ''}"
            )
            if item.get("albumArtPath"):
                lines.append(f"Art       : {item['albumArtPath']}")
            if item.get("lyricsPath"):
                lines.append(f"Lyrics    : {item['lyricsPath']}")
        for err in result.get("errors") or []:
            lines.append(f"Error     : {err}")
    return "\n".join(lines)


def backfill_album_art(wait: bool = True, timeout: float = 3600,
                       base_url=None) -> dict:
    """Give every album folder in the library a cover.

    Nona resolves each folder's art in order of trust: an iTunes/Deezer match for
    the album, then for the track, then the source video's thumbnail, and finally
    a generated cover. Folders that already have (real) artwork are left alone,
    and folders whose cover is a generated placeholder are retried, so this is
    safe and cheap to re-run.
    """
    job = api_post("/fetch-album-art", base_url=base_url)
    job_id = job.get("jobId")
    out = {"job": job, "result": None}
    if wait and job_id:
        out["result"] = wait_for_job(job_id, timeout=timeout, base_url=base_url)
    return out


def album_art_state(base_url=None) -> dict:
    """Report which album folders have no cover at all.

    Derived from the file listing: a folder is missing art when it holds audio
    but no `cover.*`. Whether an existing cover is real or generated is recorded
    on the server (under its cache directory), not in the listing, so this reports
    what is verifiable from the API — the state before and after a backfill.
    """
    files = api_get("/files", base_url=base_url).get("files", [])
    folders: dict[str, dict] = {}
    for path in files:
        parts = path.split("/")
        if len(parts) < 3:
            continue
        folder = "/".join(parts[:2])
        entry = folders.setdefault(folder, {"folder": folder, "tracks": 0,
                                            "cover": False})
        name = parts[-1].lower()
        if name.startswith("cover."):
            entry["cover"] = True
        elif name.endswith(AUDIO_EXTENSIONS):
            entry["tracks"] += 1

    missing = sorted(e["folder"] for e in folders.values()
                     if e["tracks"] and not e["cover"])

    return {
        "folders": len(folders),
        "withCover": sum(1 for e in folders.values() if e["cover"]),
        "missing": missing,
        "missingCount": len(missing),
    }


def format_art(payload: dict) -> str:
    """Human-readable report for an album-art backfill job."""
    job = payload.get("job") or {}
    result = payload.get("result") or {}

    lines = [f"Job       : {job.get('jobId')}"]
    lines.append(f"Status    : {result.get('status') or job.get('status')}")

    summary = result.get("albumArtResults") or {}
    if summary:
        lines.append(f"Folders   : {summary.get('processed')} processed")
        lines.append(
            f"Covers    : {summary.get('fetched')} written"
            f" ({summary.get('upgraded')} replaced a generated placeholder)"
        )
        lines.append(f"Existing  : {summary.get('existed')} already had artwork")
        lines.append(f"Skipped   : {summary.get('skipped')} (nothing to search with)")
        lines.append(f"No art    : {summary.get('failed')}")
        by_source = summary.get("bySource") or {}
        if by_source:
            lines.append(
                "Sources   : "
                + ", ".join(f"{key}: {value}" for key, value in sorted(by_source.items()))
            )

    progress = result.get("progress") or {}
    if progress:
        lines.append(
            f"Progress  : {progress.get('completed')}/{progress.get('total')}"
            f" ({progress.get('failed')} failed)"
        )

    for err in result.get("errors") or []:
        lines.append(f"Error     : {err}")

    return "\n".join(lines)


# --------------------------------------------------------------------------- #
# MCP server
# --------------------------------------------------------------------------- #
def build_mcp_server():
    """FastMCP server exposing Nona as agent tools. Requires the `mcp` package."""
    from mcp.server.fastmcp import FastMCP

    mcp = FastMCP("nona")

    @mcp.tool()
    def music_search(query: str, source: str = "youtube", limit: int = 6,
                     version: str = "studio") -> str:
        """Search YouTube/SoundCloud for a song and rank candidate links.

        Args:
            query: Song name, e.g. "Shadi by Fairuz".
            source: "youtube", "soundcloud", or "auto".
            limit: Max results per source.
            version: "studio" for the released recording, "full" for the long
                version (Oum Kalthoum's 40-minute concert takes, and the like).
        """
        if source == "auto":
            rows = []
            for src in ("youtube", "soundcloud"):
                rows.extend(yt_search(query, source=src, limit=limit))
        else:
            rows = yt_search(query, source=source, limit=limit)
        for row in rows:
            row["score"] = score_candidate(row, query, version)
        rows.sort(key=lambda r: r["score"], reverse=True)
        return json.dumps(rows, ensure_ascii=False, indent=2)

    @mcp.tool()
    def music_add(query: str, source: str = "auto", wait: bool = True,
                  timeout_seconds: int = 900, version: str = "studio") -> str:
        """Download and add a song to the Nona library by name or URL.

        Resolves the name to a verified-downloadable link, asks Nona to process
        it, and (by default) waits for the job to finish.

        Args:
            query: Song name ("Shadi by Fairuz") or a direct media URL.
            source: "auto", "youtube", or "soundcloud".
            wait: Block until the job reaches a terminal status.
            timeout_seconds: Max wait when wait=True.
            version: "studio" for the released recording, "full" for the long
                version (Oum Kalthoum's concert takes run 30-60 minutes).
        """
        payload = add_music(query, source=source, wait=wait,
                            timeout=float(timeout_seconds), version=version)
        return format_result(payload) + "\n\n" + json.dumps(payload, ensure_ascii=False)

    @mcp.tool()
    def music_add_many(queries: list[str], skip_existing: bool = True,
                       dry_run: bool = False, batch_size: int = 2,
                       wait: bool = True, timeout_seconds: int = 900,
                       version: str = "studio") -> str:
        """Download and add MANY songs by name in one go.

        Use this for requests like "find 20 classic Palestinian songs I don't
        already have and download them": pass the curated list of song names.
        Each is resolved to a verified link, anything already in the library is
        skipped, and the rest are submitted to Nona in small batches.

        Args:
            queries: Song names, e.g. ["زهرة المدائن - فيروز", "Ya Tayr El Werwar"].
            skip_existing: Skip songs already in the library (default True).
            dry_run: Only plan and resolve; submit nothing.
            batch_size: Songs in flight at once (keeps the server sane).
            wait: Block until every job finishes. Set False for long lists and
                  poll with music_jobs instead — a 20-song run can outlast one call.
            timeout_seconds: Max wait per job when wait=True.
            version: "studio" for released recordings, "full" for long versions.
        """
        payload = add_many(
            queries, skip_existing=skip_existing, dry_run=dry_run,
            batch_size=batch_size, wait=wait, timeout=float(timeout_seconds),
            version=version,
        )
        return format_many(payload)

    @mcp.tool()
    def music_job(job_id: str) -> str:
        """Get the status and result of a Nona processing job."""
        return json.dumps(get_job(job_id), ensure_ascii=False, indent=2)

    @mcp.tool()
    def album_art_backfill(wait: bool = True, timeout_seconds: int = 3600) -> str:
        """Give every album folder in the library artwork.

        Resolves each folder in order of trust — an iTunes/Deezer match for the
        album, then for the track, then the source video's thumbnail, then a
        generated cover — so nothing is left blank. Folders that already have real
        artwork are skipped, and folders holding a generated placeholder are
        retried and upgraded if real art is now available. Safe to re-run.

        Args:
            wait: Block until the pass finishes (a whole library can take minutes).
            timeout_seconds: Max wait when wait=True.
        """
        payload = backfill_album_art(wait=wait, timeout=float(timeout_seconds))
        return format_art(payload) + "\n\n" + json.dumps(payload, ensure_ascii=False)

    @mcp.tool()
    def music_jobs(limit: int = 10) -> str:
        """List recent Nona processing jobs (newest first)."""
        return json.dumps(list_jobs(limit=limit), ensure_ascii=False, indent=2)

    @mcp.tool()
    def library_search(query: str = "") -> str:
        """List or search files already in the Nona music library."""
        data = list_files(query)
        return json.dumps(data, ensure_ascii=False, indent=2)

    @mcp.tool()
    def library_stats_tool() -> str:
        """Cache and library counts for the Nona instance."""
        return json.dumps(library_stats(), ensure_ascii=False, indent=2)

    return mcp


# --------------------------------------------------------------------------- #
# CLI
# --------------------------------------------------------------------------- #
def _version(args) -> str:
    """CLI --full maps to the resolver's "full" version preference."""
    return "full" if getattr(args, "full", False) else "studio"


def _print(obj):
    print(json.dumps(obj, ensure_ascii=False, indent=2))


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(prog="nona", description=__doc__.split("\n")[1])
    sub = parser.add_subparsers(dest="cmd", required=True)

    p = sub.add_parser("search", help="search for a song name and rank the links")
    p.add_argument("query")
    p.add_argument("--source", default="auto",
                   choices=["auto", "youtube", "soundcloud"])
    p.add_argument("--limit", type=int, default=6)
    p.add_argument("--full", action="store_true",
                   help="prefer the long/full version (Oum Kalthoum concert takes)")


    p = sub.add_parser("add", help="resolve a song name or URL and download it")
    p.add_argument("query")
    p.add_argument("--source", default="auto",
                   choices=["auto", "youtube", "soundcloud"])
    p.add_argument("--timeout", type=float, default=900)
    p.add_argument("--no-wait", action="store_true")
    p.add_argument("--no-verify", action="store_true",
                   help="skip the pre-flight downloadability check")
    p.add_argument("--full", action="store_true",
                   help="prefer the long/full version (Oum Kalthoum concert takes)")


    p = sub.add_parser("add-many",
                       help="add a list of songs, skipping ones already in the library")
    p.add_argument("queries", nargs="*", help="song names (or use --file / stdin)")
    p.add_argument("--file", help="read one song per line from this file ('-' for stdin)")
    p.add_argument("--source", default="auto",
                   choices=["auto", "youtube", "soundcloud"])
    p.add_argument("--limit", type=int, default=None)
    p.add_argument("--batch-size", type=int, default=2,
                   help="songs in flight; the server drops connections above ~3")
    p.add_argument("--timeout", type=float, default=900)
    p.add_argument("--force", action="store_true",
                   help="do not skip songs already in the library")
    p.add_argument("--dry-run", action="store_true",
                   help="resolve and plan only; submit nothing")
    p.add_argument("--no-wait", action="store_true",
                   help="submit and return job ids immediately")
    p.add_argument("--json", action="store_true", help="machine-readable output")
    p.add_argument("--full", action="store_true",
                   help="prefer the long/full version (Oum Kalthoum concert takes)")


    p = sub.add_parser("existing",
                       help="list what the library already has (artist/track)")

    p = sub.add_parser("resolve", help="resolve a name to a link without adding")
    p.add_argument("query")
    p.add_argument("--source", default="auto",
                   choices=["auto", "youtube", "soundcloud"])
    p.add_argument("--full", action="store_true",
                   help="prefer the long/full version (Oum Kalthoum concert takes)")


    p = sub.add_parser("jobs", help="list recent jobs")
    p.add_argument("--limit", type=int, default=20)

    p = sub.add_parser("job", help="show one job")
    p.add_argument("job_id")

    p = sub.add_parser("library", help="list/search library files")
    p.add_argument("query", nargs="?", default="")

    p = sub.add_parser("stats", help="cache + library stats")

    p = sub.add_parser("art",
                       help="give every album folder a cover (real art first)")
    p.add_argument("--timeout", type=float, default=3600)
    p.add_argument("--no-wait", action="store_true")
    p.add_argument("--json", action="store_true", help="machine-readable output")

    p = sub.add_parser("art-missing",
                       help="list album folders that have no cover at all")

    p = sub.add_parser("serve", help="run the stdio MCP server")

    args = parser.parse_args(argv)

    try:
        if args.cmd == "serve":
            build_mcp_server().run()
            return 0
        if args.cmd == "search":
            if args.source == "auto":
                rows = []
                for src in ("youtube", "soundcloud"):
                    rows.extend(yt_search(args.query, source=src, limit=args.limit))
            else:
                rows = yt_search(args.query, source=args.source, limit=args.limit)
            for row in rows:
                row["score"] = score_candidate(row, args.query, _version(args))
            rows.sort(key=lambda r: r["score"], reverse=True)
            _print(rows)
        elif args.cmd == "resolve":
            _print(resolve(args.query, source=args.source,
                           version=_version(args)))
        elif args.cmd == "add":
            payload = add_music(
                args.query, source=args.source, wait=not args.no_wait,
                timeout=args.timeout, verify=not args.no_verify,
                version=_version(args),
            )
            print(format_result(payload))
            if not payload.get("result"):
                _print(payload["job"])
        elif args.cmd == "add-many":
            queries = list(args.queries)
            if args.file:
                if args.file == "-":
                    text = sys.stdin.read()
                else:
                    with open(args.file, encoding="utf-8") as handle:
                        text = handle.read()
                queries += [
                    line.strip() for line in text.splitlines()
                    if line.strip() and not line.strip().startswith("#")
                ]
            if not queries:
                print("error: no songs given (names, --file, or stdin)", file=sys.stderr)
                return 1

            def _progress(row):
                print(f"  ... {row.get('status'):18} {row['query']}", file=sys.stderr)

            payload = add_many(
                queries, source=args.source, skip_existing=not args.force,
                dry_run=args.dry_run, batch_size=args.batch_size,
                timeout=args.timeout, limit=args.limit, wait=not args.no_wait,
                version=_version(args),
                progress=None if args.json else _progress,
            )
            if args.json:
                _print(payload)
            else:
                print(format_many(payload))
        elif args.cmd == "existing":
            index = build_library_index()
            for entry in sorted(index, key=lambda e: (e["artist"].lower(),
                                                      e["track"].lower())):
                print(f"{entry['artist']}/{entry['track']}")
        elif args.cmd == "jobs":
            _print(list_jobs(limit=args.limit))
        elif args.cmd == "job":
            _print(get_job(args.job_id))
        elif args.cmd == "library":
            _print(list_files(args.query))
        elif args.cmd == "stats":
            _print(library_stats())
        elif args.cmd == "art":
            payload = backfill_album_art(
                wait=not args.no_wait, timeout=args.timeout
            )
            if args.json:
                _print(payload)
            else:
                print(format_art(payload))
                if not payload.get("result"):
                    _print(payload["job"])
        elif args.cmd == "art-missing":
            state = album_art_state()
            print(
                f"{state['withCover']}/{state['folders']} album folders have a cover;"
                f" {state['missingCount']} have none"
            )
            for folder in state["missing"]:
                print(f"  {folder}")
    except NonaError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        return 130
    return 0


if __name__ == "__main__":
    sys.exit(main())
