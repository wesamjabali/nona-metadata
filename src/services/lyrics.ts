import { promises as fs } from "fs";
import { getLyricsFilePath } from "../utils/file.js";

/**
 * Lyrics fetching backed by LRCLIB (https://lrclib.net).
 *
 * LRCLIB is a free, key-less service that returns time-synced (`.lrc`) lyrics.
 * It stores lyrics in their original script, so English and Arabic tracks are
 * both matched natively (no transliteration is performed).
 *
 * API notes (https://lrclib.net/docs):
 * - A descriptive `User-Agent` header is required.
 * - Requests must be sequential with a short delay (200-500ms) between them.
 * - `429` responses include a `Retry-After` header which MUST be honored.
 * - `/api/get` only matches when `duration` is within +/-2s, so we retry
 *   without it when the precise lookup misses.
 */

const LRCLIB_BASE_URL = "https://lrclib.net/api";
const USER_AGENT =
  "nona-metadata v1.0.0 (https://github.com/nona-metadata/nona-metadata)";

/** Polite delay between sequential LRCLIB requests (docs recommend 200-500ms). */
const REQUEST_DELAY_MS = 300;

/** Upper bound for how long we will block on a `Retry-After` hint. */
const MAX_RETRY_AFTER_MS = 15000;

/** LRCLIB only accepts a `duration` between 1 and 3600 seconds. */
const MIN_DURATION_SECONDS = 1;
const MAX_DURATION_SECONDS = 3600;

export interface LyricsRecord {
  id: number;
  trackName: string;
  artistName: string;
  albumName: string | null;
  duration: number | null;
  instrumental: boolean;
  plainLyrics: string | null;
  syncedLyrics: string | null;
}

export interface LyricsMeta {
  artist: string;
  title: string;
  album: string | null;
  /** Duration of the audio file itself, preferred for the `[length:]` header. */
  duration?: number | null;
}

/** Serializes all outgoing LRCLIB requests so we never fire them in parallel. */
let requestChain: Promise<unknown> = Promise.resolve();
let lastRequestTime = 0;

/**
 * Runs `task` after every previously queued LRCLIB task has settled, then
 * enforces the minimum spacing between requests.
 */
function schedule<T>(task: () => Promise<T>): Promise<T> {
  const result = requestChain.then(async () => {
    const elapsed = Date.now() - lastRequestTime;
    if (elapsed < REQUEST_DELAY_MS) {
      await new Promise((resolve) =>
        setTimeout(resolve, REQUEST_DELAY_MS - elapsed),
      );
    }
    try {
      return await task();
    } finally {
      lastRequestTime = Date.now();
    }
  });

  // Keep the chain alive even when a task rejects.
  requestChain = result.catch(() => undefined);
  return result;
}

/**
 * Performs a throttled GET against LRCLIB, honoring `Retry-After` on 429s.
 * @param path API path including the query string, e.g. `/get?track_name=...`
 * @returns The parsed JSON body, or null when the track was not found.
 */
async function lrclibGet<T>(path: string): Promise<T | null> {
  return schedule(async () => {
    const url = `${LRCLIB_BASE_URL}${path}`;

    for (let attempt = 0; attempt < 2; attempt++) {
      const response = await fetch(url, {
        headers: { "User-Agent": USER_AGENT },
      });

      if (response.status === 404) {
        return null;
      }

      if (response.status === 429) {
        const retryAfterSeconds = Number(response.headers.get("Retry-After"));
        const waitMs = Math.min(
          Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
            ? retryAfterSeconds * 1000
            : 2000,
          MAX_RETRY_AFTER_MS,
        );
        console.warn(
          `LRCLIB rate limited, waiting ${waitMs}ms before retrying...`,
        );
        await new Promise((resolve) => setTimeout(resolve, waitMs));
        continue;
      }

      if (!response.ok) {
        console.warn(
          `LRCLIB request failed (${response.status} ${response.statusText}): ${url}`,
        );
        return null;
      }

      return (await response.json()) as T;
    }

    console.warn(`LRCLIB still rate limited, giving up on: ${url}`);
    return null;
  });
}

/**
 * Builds a query string, omitting absent/placeholder values.
 * @param params The key/value pairs to serialize.
 * @returns An encoded query string (without the leading `?`).
 */
function buildQuery(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") {
      continue;
    }
    search.set(key, String(value));
  }

  return search.toString();
}

/**
 * Returns the duration only when it is usable by LRCLIB.
 * @param duration The track duration in seconds.
 * @returns A whole number of seconds, or undefined when out of range.
 */
function usableDuration(duration: number | null | undefined): number | undefined {
  if (!duration || Number.isNaN(duration)) {
    return undefined;
  }

  const rounded = Math.round(duration);
  if (rounded < MIN_DURATION_SECONDS || rounded > MAX_DURATION_SECONDS) {
    return undefined;
  }

  return rounded;
}

/**
 * Normalizes a string for loose comparison (case/punctuation-insensitive).
 */
function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Scores a candidate record against the requested track. Higher is better.
 * Duration proximity matters most, then exact title/artist matches.
 */
function scoreCandidate(
  candidate: LyricsRecord,
  meta: LyricsMeta,
  duration: number | undefined,
): number {
  let score = 0;

  if (normalize(candidate.trackName) === normalize(meta.title)) {
    score += 10;
  } else if (
    normalize(candidate.trackName).includes(normalize(meta.title)) ||
    normalize(meta.title).includes(normalize(candidate.trackName))
  ) {
    score += 5;
  }

  if (normalize(candidate.artistName) === normalize(meta.artist)) {
    score += 6;
  } else if (
    normalize(candidate.artistName).includes(normalize(meta.artist)) ||
    normalize(meta.artist).includes(normalize(candidate.artistName))
  ) {
    score += 3;
  }

  if (
    meta.album &&
    candidate.albumName &&
    normalize(candidate.albumName) === normalize(meta.album)
  ) {
    score += 4;
  }

  if (duration && candidate.duration) {
    const delta = Math.abs(candidate.duration - duration);
    if (delta <= 2) {
      score += 8;
    } else if (delta <= 10) {
      score += 3;
    } else if (delta > 30) {
      score -= 5;
    }
  }

  // Prefer candidates that actually carry lyrics.
  if (candidate.syncedLyrics) {
    score += 2;
  } else if (candidate.plainLyrics) {
    score += 1;
  }

  return score;
}

/**
 * Picks the best matching record from a search result set.
 * @returns The best candidate, or null when nothing usable was returned.
 */
function pickBestCandidate(
  candidates: LyricsRecord[],
  meta: LyricsMeta,
  duration: number | undefined,
): LyricsRecord | null {
  const usable = candidates.filter(
    (candidate) =>
      candidate.instrumental ||
      (candidate.plainLyrics?.trim() ?? "") !== "" ||
      (candidate.syncedLyrics?.trim() ?? "") !== "",
  );

  if (usable.length === 0) {
    return null;
  }

  return usable.reduce((best, candidate) =>
    scoreCandidate(candidate, meta, duration) >
    scoreCandidate(best, meta, duration)
      ? candidate
      : best,
  );
}

/**
 * Fetches lyrics for a track from LRCLIB.
 *
 * Strategy (first hit wins):
 * 1. Exact signature lookup (`/api/get`) with artist, title, album, duration.
 * 2. Same lookup without the duration (LRCLIB enforces a tight +/-2s window).
 * 3. Structured search on artist + track (album used to disambiguate).
 * 4. Free-text search combining artist and title, which helps when the stored
 *    title differs slightly from the LRCLIB entry (common for Arabic tracks).
 *
 * @param artist The track artist.
 * @param title The track title.
 * @param album The album name, if known.
 * @param duration The track duration in seconds, if known.
 * @returns The matching lyrics record, or null when no lyrics were found.
 */
export async function fetchLyrics(
  artist: string,
  title: string,
  album: string | null,
  duration: number | null,
): Promise<LyricsRecord | null> {
  if (!artist?.trim() || !title?.trim()) {
    return null;
  }

  const meta: LyricsMeta = { artist, title, album };
  const albumParam = album && album !== "Unknown Album" ? album : undefined;
  const durationParam = usableDuration(duration);

  const exact = await lrclibGet<LyricsRecord>(
    `/get?${buildQuery({
      artist_name: artist,
      track_name: title,
      album_name: albumParam,
      duration: durationParam,
    })}`,
  );

  if (exact) {
    return exact;
  }

  if (durationParam !== undefined) {
    const withoutDuration = await lrclibGet<LyricsRecord>(
      `/get?${buildQuery({
        artist_name: artist,
        track_name: title,
        album_name: albumParam,
      })}`,
    );

    if (withoutDuration) {
      return withoutDuration;
    }
  }

  const structured = await lrclibGet<LyricsRecord[]>(
    `/search?${buildQuery({
      artist_name: artist,
      track_name: title,
      album_name: albumParam,
    })}`,
  );

  const structuredBest = structured
    ? pickBestCandidate(structured, meta, durationParam)
    : null;

  if (structuredBest) {
    return structuredBest;
  }

  const freeText = await lrclibGet<LyricsRecord[]>(
    `/search?${buildQuery({ q: `${artist} ${title}` })}`,
  );

  return freeText ? pickBestCandidate(freeText, meta, durationParam) : null;
}

/**
 * Formats lyrics as an LRC document with standard metadata headers.
 * @param record The LRCLIB record to serialize.
 * @param meta The track metadata used for the header tags.
 * @returns The `.lrc` file contents.
 */
export function buildLrcContent(record: LyricsRecord, meta: LyricsMeta): string {
  const headers = [
    `[ti:${record.trackName || meta.title}]`,
    `[ar:${record.artistName || meta.artist}]`,
  ];

  const album = record.albumName || meta.album;
  if (album && album !== "Unknown Album") {
    headers.push(`[al:${album}]`);
  }

  // The audio file's own duration is the ground truth for a sidecar next to it.
  const lengthSeconds = meta.duration || record.duration;
  if (lengthSeconds) {
    const minutes = Math.floor(lengthSeconds / 60);
    const seconds = Math.floor(lengthSeconds % 60);
    headers.push(
      `[length:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}]`,
    );
  }
  headers.push("[re:LRCLIB]", "[by:nona-metadata]");

  const body = record.instrumental
    ? "[00:00.00] \u266a Instrumental \u266a"
    : (record.syncedLyrics?.trim() || record.plainLyrics?.trim() || "");

  if (!body) {
    return "";
  }

  return `${headers.join("\n")}\n${body}\n`;
}

/**
 * Writes lyrics to an `.lrc` sidecar next to the audio file.
 * @param record The lyrics record returned by {@link fetchLyrics}.
 * @param audioFilePath The organized audio file path.
 * @param meta The track metadata used for the header tags.
 * @returns The path to the written lyrics file, or null if there was nothing to write.
 */
export async function saveLyrics(
  record: LyricsRecord,
  audioFilePath: string,
  meta: LyricsMeta,
): Promise<string | null> {
  const content = buildLrcContent(record, meta);
  if (!content) {
    console.log(`Lyrics: Nothing to save for "${meta.title}"`);
    return null;
  }

  const lyricsPath = getLyricsFilePath(audioFilePath);

  try {
    await fs.writeFile(lyricsPath, content, "utf8");
    console.log(`Lyrics: Saved to ${lyricsPath}`);
    return lyricsPath;
  } catch (error) {
    console.warn(`Lyrics: Failed to write ${lyricsPath}:`, error);
    return null;
  }
}
