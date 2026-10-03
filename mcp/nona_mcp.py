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

TERMINAL_STATUSES = {"completed", "failed", "error", "cancelled"}

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
# Words YouTube appends to auto-generated artist channels ("Fairuz - Topic").
CHANNEL_NOISE = {"topic", "vevo", "official"}

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
             timeout=HTTP_TIMEOUT):
    url = (base_url or DEFAULT_BASE_URL).rstrip("/") + path
    if params:
        url += "?" + urllib.parse.urlencode(params)
    data = json.dumps(body).encode("utf-8") if body is not None else None
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
        raise NonaError(f"{method} {path} -> HTTP {exc.code}: {detail}") from None
    except urllib.error.URLError as exc:
        raise NonaError(f"{method} {path} -> {exc.reason}") from None
    if not raw.strip():
        return {}
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        raise NonaError(f"{method} {path} -> non-JSON response: {raw[:200]}") from None


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
    # Collapse doubled letters so "Moussa" == "Mousa" and "Sanaa" == "Sana".
    return re.sub(r"(.)\1+", r"\1", token)


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


def score_candidate(candidate: dict, query: str) -> float:
    """Rank a search hit against the requested song name.

    Deliberately rewards precision as well as recall: a title that contains every
    requested word *and nothing else* is the recording itself, whereas one that
    contains the words plus four others is somebody's cover, reaction or medley.
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

    lowered = title.lower()
    for word in NOISE_WORDS:
        if word in lowered and word not in query.lower():
            score -= 3.0

    duration = candidate.get("duration")
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
            verify: bool = True) -> dict:
    """Turn a song name (or URL) into a Nona-processable link.

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
            hit["score"] = score_candidate(hit, query)
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
    """Poll a job until it reaches a terminal status."""
    deadline = time.time() + timeout
    last = None
    while True:
        job = get_job(job_id, base_url=base_url)
        if on_update and job.get("status") != last:
            on_update(job)
        last = job.get("status")
        if (job.get("status") or "").lower() in TERMINAL_STATUSES:
            return job
        if time.time() >= deadline:
            raise NonaError(
                f"Job {job_id} still {job.get('status')!r} after {timeout:.0f}s"
            )
        time.sleep(interval)


def add_music(query: str, source: str = "auto", wait: bool = True,
              timeout: float = 900, base_url=None, ytdlp: str = YTDLP,
              verify: bool = True) -> dict:
    """Resolve a song name (or URL) and have Nona download + tag it.

    Returns {"resolved": ..., "job": ..., "result": ...}.
    """
    resolved = resolve(query, source=source, ytdlp=ytdlp, verify=verify)
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


# --------------------------------------------------------------------------- #
# MCP server
# --------------------------------------------------------------------------- #
def build_mcp_server():
    """FastMCP server exposing Nona as agent tools. Requires the `mcp` package."""
    from mcp.server.fastmcp import FastMCP

    mcp = FastMCP("nona")

    @mcp.tool()
    def music_search(query: str, source: str = "youtube", limit: int = 6) -> str:
        """Search YouTube/SoundCloud for a song and rank candidate links.

        Args:
            query: Song name, e.g. "Shadi by Fairuz".
            source: "youtube", "soundcloud", or "auto".
            limit: Max results per source.
        """
        if source == "auto":
            rows = []
            for src in ("youtube", "soundcloud"):
                rows.extend(yt_search(query, source=src, limit=limit))
        else:
            rows = yt_search(query, source=source, limit=limit)
        for row in rows:
            row["score"] = score_candidate(row, query)
        rows.sort(key=lambda r: r["score"], reverse=True)
        return json.dumps(rows, ensure_ascii=False, indent=2)

    @mcp.tool()
    def music_add(query: str, source: str = "auto", wait: bool = True,
                  timeout_seconds: int = 900) -> str:
        """Download and add a song to the Nona library by name or URL.

        Resolves the name to a verified-downloadable link, asks Nona to process
        it, and (by default) waits for the job to finish.

        Args:
            query: Song name ("Shadi by Fairuz") or a direct media URL.
            source: "auto", "youtube", or "soundcloud".
            wait: Block until the job reaches a terminal status.
            timeout_seconds: Max wait when wait=True.
        """
        payload = add_music(query, source=source, wait=wait,
                            timeout=float(timeout_seconds))
        return format_result(payload) + "\n\n" + json.dumps(payload, ensure_ascii=False)

    @mcp.tool()
    def music_job(job_id: str) -> str:
        """Get the status and result of a Nona processing job."""
        return json.dumps(get_job(job_id), ensure_ascii=False, indent=2)

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

    p = sub.add_parser("add", help="resolve a song name or URL and download it")
    p.add_argument("query")
    p.add_argument("--source", default="auto",
                   choices=["auto", "youtube", "soundcloud"])
    p.add_argument("--timeout", type=float, default=900)
    p.add_argument("--no-wait", action="store_true")
    p.add_argument("--no-verify", action="store_true",
                   help="skip the pre-flight downloadability check")

    p = sub.add_parser("resolve", help="resolve a name to a link without adding")
    p.add_argument("query")
    p.add_argument("--source", default="auto",
                   choices=["auto", "youtube", "soundcloud"])

    p = sub.add_parser("jobs", help="list recent jobs")
    p.add_argument("--limit", type=int, default=20)

    p = sub.add_parser("job", help="show one job")
    p.add_argument("job_id")

    p = sub.add_parser("library", help="list/search library files")
    p.add_argument("query", nargs="?", default="")

    p = sub.add_parser("stats", help="cache + library stats")

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
                row["score"] = score_candidate(row, args.query)
            rows.sort(key=lambda r: r["score"], reverse=True)
            _print(rows)
        elif args.cmd == "resolve":
            _print(resolve(args.query, source=args.source))
        elif args.cmd == "add":
            payload = add_music(
                args.query, source=args.source, wait=not args.no_wait,
                timeout=args.timeout, verify=not args.no_verify,
            )
            print(format_result(payload))
            if not payload.get("result"):
                _print(payload["job"])
        elif args.cmd == "jobs":
            _print(list_jobs(limit=args.limit))
        elif args.cmd == "job":
            _print(get_job(args.job_id))
        elif args.cmd == "library":
            _print(list_files(args.query))
        elif args.cmd == "stats":
            _print(library_stats())
    except NonaError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        return 130
    return 0


if __name__ == "__main__":
    sys.exit(main())
