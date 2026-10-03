# Nona MCP / CLI

Turn a **song name** into a track in the library.

The Nona HTTP API ([`../README.md`](../README.md)) only accepts a media *URL*:
`POST /` with `{"prompt": "https://..."}`. That is fine when you already have a
link, but not when you are holding a song title. This directory adds a client
that closes that gap:

```
"Shadi by Fairuz"  ->  resolve  ->  https://www.youtube.com/watch?v=oXlxnK849t0
                                  ->  POST / {"prompt": "<url>"}
                                  ->  job completes, track is tagged and filed
```

Three ways to use it, all backed by the same `nona_mcp.py`:

| Use it as | How |
| --- | --- |
| CLI | `python nona_mcp.py add "Shadi by Fairuz"` |
| Python library | `from nona_mcp import resolve, add_music, wait_for_job` |
| MCP server | `python nona_mcp.py serve` (stdio) |

## Setup

```bash
# A python with the MCP SDK and yt-dlp. Any venv will do:
python3 -m venv ~/.venvs/nona
~/.venvs/nona/bin/pip install 'mcp<2' yt-dlp
```

`mcp<2` is pinned for the `FastMCP` server API; `mcp` 2.x renamed it to
`MCPServer`. Nothing else is needed — the HTTP client is stdlib-only.

Configure by environment variable:

| Variable | Default | Meaning |
| --- | --- | --- |
| `NONA_BASE_URL` | `http://localhost:80` | Nona API root (no `/api` suffix) |
| `NONA_YTDLP` | `yt-dlp` on `PATH` | yt-dlp executable used for search |
| `NONA_TIMEOUT` | `60` | HTTP timeout in seconds |

## CLI

```bash
nona resolve "Shadi by Fairuz"   # show the one link it would use, and why
nona search  "Shadi by Fairuz"   # rank every candidate, no download
nona add     "Shadi by Fairuz"   # resolve, hand to Nona, wait for the job
nona add     "https://youtu.be/..." --no-verify
nona add     "..." --no-wait     # return the job id immediately
nona jobs                        # recent jobs
nona job     job_1791016770831_gz1rgw0p1
nona library fairuz              # search what is already filed
nona existing                    # every artist/track already filed
nona stats
```

`add` exits non-zero with a message on stderr if nothing usable is found.

## Bulk: "download 20 of X I don't already have"

```bash
nona add-many "زهرة المدائن - فيروز" "يا زريف الطول" "دمي فلسطيني - محمد عساف"
nona add-many --file songs.txt --batch-size 3
nona add-many --file songs.txt --dry-run    # resolve + plan, submit nothing
nona add-many --file songs.txt --force      # do not skip existing
nona add-many --file songs.txt --no-wait    # submit, return job ids
```

- **Skipped, not duplicated.** Every request is checked against the filed
  library first (fuzzy, script-aware, so "Fairuz Li Beirut" matches a filed
  `Le Beirut.m4a`). Already-present songs are reported and left alone.
- **Batched.** Songs are submitted `--batch-size` at a time (default 3) and each
  batch is waited on before the next, so a 20-song list does not open twenty
  concurrent downloads on the server.
- **Verified first.** Every pick is probed with `yt-dlp --simulate`; an
  unusable link is skipped and the next candidate tried.
- `--dry-run` is worth running first on a curated list: it prints the link and
  video it would use for each line, so a wrong pick is visible before anything
  is downloaded.

The *choosing* of songs is a judgement call and belongs to the caller; this
command makes the mechanical part (resolve, dedupe, verify, submit, wait)
idempotent and inspectable.

## MCP tools

`python nona_mcp.py serve` exposes:

| Tool | Purpose |
| --- | --- |
| `music_search` | Rank candidate links for a query |
| `music_add` | Resolve and download a song by name or URL, wait for the result |
| `music_add_many` | Resolve and download a list, skipping what is already filed |
| `music_job` / `music_jobs` | Job status and history |
| `library_search` | Search files already in the library |
| `library_stats_tool` | Cache and library counts |

Registering it with Hermes Agent:

```bash
hermes mcp add nona \
  --command ~/.venvs/nona/bin/python \
  --env NONA_BASE_URL=https://nona.example.com NONA_YTDLP=$HOME/.venvs/nona/bin/yt-dlp \
  --args /path/to/nona-metadata/mcp/nona_mcp.py serve
```

New sessions pick the tools up automatically; `/reload-mcp` loads them into an
open one.

## How a name becomes a link

1. **Search** the source(s) with yt-dlp (`ytsearch`/`scsearch`, flat playlist).
2. **Score** every hit. The signals, in order of weight:
   - *recall* — how many words of the request appear in the title;
   - *the artist's own channel* — the single strongest signal for a canonical
     recording, matched fuzzily and across scripts ("سناء موسى" vs `Sanaa Moussa`);
   - *precision* — a title that is **only** the request beats one padded with
     commentary, plus a penalty per extra word;
   - *popularity* — `sqrt(views)`, so the canonical upload wins among duplicas;
   - *noise* — remixes, covers, karaoke, talent-show auditions, etc.;
   - *duration* — full songs preferred over clips;
   - *rank* — a small prior for the search engine's own ordering.
3. **Verify** the winner with `yt-dlp --simulate` before handing it to Nona.
   A link that cannot be extracted is dropped and the next candidate is tried, so
   a failed download never becomes a failed job.
4. **Submit** the verified URL to `POST /` and poll `GET /jobs/:id`.

Transliteration is handled deliberately, because it is where naive matching
fails: "Shadi"/"Shady"/"Chadi", "Fairuz"/"Fairouz", "Moussa"/"Musa", stylised
spaced-out names ("E M E L"), and the same name in Arabic on one channel and
Latin on another.

### Known limits

Resolution is title-based. It will not distinguish two different recordings that
share a title (a studio take vs. a live version), and it can be misled by an
upload whose title lies about its contents. `resolve`/`search` return the ranked
`alternatives` alongside the pick, so an ambiguous case can be eyeballed and
overridden by passing a URL directly to `add`.

## Files

- `nona_mcp.py` — client, resolver, CLI and MCP server (single file, no state)
