/**
 * Album art search providers.
 *
 * Providers only *find* candidates (metadata + image URL); they never download
 * or judge images. The orchestrator in `albumArt.ts` scores every candidate
 * with `utils/musicMatching.ts` and downloads the best match, which keeps
 * low-precision sources (Cover Art Archive, Discogs, free-text search) from
 * silently returning the wrong cover.
 *
 * Why these providers:
 * - iTunes (`itunes.apple.com/search`) — key-less, no hard rate limit for our
 *   volume, high-resolution artwork (up to 3000px via URL rewrite) and by far
 *   the best coverage for both English and Arabic/MENA releases.
 * - Deezer (`api.deezer.com`) — key-less, 1000px artwork, very strong MENA
 *   catalogue (often the only source for Arabic albums).
 * - MusicBrainz + Cover Art Archive — good for Western releases, weak for
 *   Arabic; kept because it is free and community-corrected.
 * - Discogs — last resort, used for obscure releases; works with or without a
 *   `DISCOGS_API_KEY` (unauthenticated requests have a lower rate limit).
 */

import { discogsApiKey } from "../config/constants.js";
import type { AlbumMatchScore } from "../utils/musicMatching.js";
import {
  MIN_ALBUM_MATCH_SCORE,
  MIN_ALBUM_TITLE_MATCH_SCORE,
  MIN_ARTIST_MATCH_SCORE,
  MIN_ARTIST_ONLY_MATCH_SCORE,
  MIN_TRACK_TITLE_MATCH_SCORE,
  scoreAlbumMatch,
} from "../utils/musicMatching.js";
const USER_AGENT =
  "nona-metadata/1.0.0 (https://github.com/nona-metadata/nona-metadata)";

export type AlbumArtProvider = "itunes" | "deezer" | "musicbrainz" | "discogs";

/** The album we are looking for. */
export interface AlbumArtQuery {
  artist: string;
  album: string;
}

/**
 * A single track we are looking for.
 *
 * This is how albums named "Unknown Album" get artwork at all: there is no
 * album to search for, but the artist + track title identify a release whose
 * cover can be used.
 */
export interface TrackArtQuery {
  artist: string;
  track: string;
}

/** A provider result: metadata to score plus one or more image URLs to try. */
export interface AlbumArtCandidate {
  provider: AlbumArtProvider;
  /** Provider-specific identifier, used to de-duplicate results. */
  id: string;
  artist: string;
  album: string;
  /** Track title, present on candidates that came from a track-level search. */
  track?: string;
  /** Image URLs to try in order, best quality first. */
  imageUrls: string[];
}

/** A candidate paired with its match score. */
export interface ScoredAlbumArtCandidate {
  candidate: AlbumArtCandidate;
  score: AlbumMatchScore;
}

/**
 * Minimal per-provider request throttle. Serializes requests and enforces a
 * minimum gap so MusicBrainz's 1 req/s rule (and iTunes/Discogs politeness
 * limits) hold even when many albums are searched concurrently.
 */
class RequestThrottle {
  private chain: Promise<unknown> = Promise.resolve();
  private lastRequestTime = 0;

  constructor(private readonly minIntervalMs: number) {}

  schedule<T>(task: () => Promise<T>): Promise<T> {
    const result = this.chain.then(async () => {
      const wait = this.minIntervalMs - (Date.now() - this.lastRequestTime);
      if (wait > 0) {
        await new Promise((resolve) => setTimeout(resolve, wait));
      }
      try {
        return await task();
      } finally {
        this.lastRequestTime = Date.now();
      }
    });

    // Keep the chain alive when a task rejects.
    this.chain = result.catch(() => undefined);
    return result;
  }
}

const itunesThrottle = new RequestThrottle(800);
const deezerThrottle = new RequestThrottle(200);
const musicBrainzThrottle = new RequestThrottle(1100);
// 2s keeps us inside Discogs' stricter unauthenticated limit (25 req/min).
const discogsThrottle = new RequestThrottle(2000);

/**
 * When iTunes is throttling us, it is left alone until this timestamp.
 *
 * A single throttling answer applies to the whole client, not to one query: the
 * limit is per address and shared with every search in the run. Without this,
 * each of the hundreds of folders in a backfill would spend two requests and a
 * 2.5s pause rediscovering the same block.
 */
let itunesThrottledUntil = 0;

/** How long to leave iTunes alone after it throttles (it sends no Retry-After). */
const ITUNES_COOLDOWN_MS = 10 * 60 * 1000;

/**
 * Runs one iTunes search request, retrying once when Apple pushes back.
 *
 * iTunes answers 403/429 rather than 5xx when a client is going too fast (it
 * does not send `Retry-After`), so an unretried failure silently turns into
 * "no cover found" for an album that is perfectly searchable. The caller also
 * learns that the provider is throttling, so it can stop fanning out over
 * storefronts — continuing to hammer Apple is what turns a soft limit into a
 * hard block that lasts for the rest of the run.
 * @param url The fully built search URL.
 * @param label What is being searched for, for the log line.
 * @returns The parsed body (or null) and whether the provider is throttling us.
 */
async function requestItunesSearch<T>(
  url: string,
  label: string,
): Promise<{ data: T | null; rateLimited: boolean }> {
  if (Date.now() < itunesThrottledUntil) {
    return { data: null, rateLimited: true };
  }

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await fetch(url, {
        headers: { "User-Agent": USER_AGENT },
      });

      if (response.ok) {
        return { data: (await response.json()) as T, rateLimited: false };
      }

      const throttled = response.status === 429 || response.status === 403;
      const retryable = throttled || response.status >= 500;

      console.warn(
        `iTunes search failed (${response.status} ${response.statusText}) for "${label}"${
          retryable && attempt === 0 ? " — retrying once" : ""
        }`,
      );

      if (!retryable || attempt === 1) {
        if (throttled) {
          itunesThrottledUntil = Date.now() + ITUNES_COOLDOWN_MS;
          console.warn(
            `iTunes is throttling this client; skipping it for ${
              ITUNES_COOLDOWN_MS / 60000
            } minutes and falling back to the other providers.`,
          );
        }
        return { data: null, rateLimited: throttled };
      }
    } catch (error) {
      console.warn(`iTunes search error for "${label}":`, error);
      if (attempt === 1) {
        return { data: null, rateLimited: false };
      }
    }

    await new Promise((resolve) => setTimeout(resolve, 2500));
  }

  return { data: null, rateLimited: false };
}

/**
 * Search terms to try for one field, best first.
 *
 * Provider search indexes are literal: Deezer answers "Ya Tal'een Al Jabal" with
 * nothing at all while a different spelling of the same title returns the track,
 * and a single apostrophe is enough to lose a release. Each term is therefore
 * tried as written and again with punctuation folded out (apostrophes, hyphens,
 * dots) and spaces collapsed — the same words, spelled the way an index is likely
 * to store them. The folded form is only ever used when the literal term found
 * nothing.
 * @param term The term as built from the library's tags.
 * @returns One or two terms; the second is omitted when it is identical.
 */
export function searchTermVariants(term: string): string[] {
  const literal = term.trim();
  const folded = literal
    .replace(/['’`´]/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

  return folded && folded !== literal ? [literal, folded] : [literal];
}

/**
 * Expands terms into the variants to search for.
 * @param terms The terms to expand.
 * @returns Deduplicated variants, in order.
 */
function expandSearchTerms(terms: string[]): string[] {
  return [...new Set(terms.flatMap(searchTermVariants))].filter(Boolean);
}

/** Caches search results so a multi-track album only queries once per term. */
const itunesCache = new Map<string, AlbumArtCandidate[]>();
const deezerCache = new Map<string, AlbumArtCandidate[]>();

/** Deduplicates candidates that appear in several queries/storefronts. */
export function dedupeCandidates(
  candidates: AlbumArtCandidate[],
): AlbumArtCandidate[] {
  const seen = new Set<string>();
  const result: AlbumArtCandidate[] = [];

  for (const candidate of candidates) {
    const key = `${candidate.provider}:${candidate.id}`;
    if (seen.has(key) || candidate.imageUrls.length === 0) {
      continue;
    }
    seen.add(key);
    result.push(candidate);
  }

  return result;
}

/**
 * Ranks candidates by match score, dropping anything below the confidence
 * thresholds. Sorted best-first so the orchestrator can walk down the list when
 * an image URL turns out to be dead.
 *
 * The artist and album floors matter as much as the weighted score: they reject
 * cover versions, remixes and tributes that happen to share the album title but
 * are credited to a different artist.
 * @param candidates The candidates to rank.
 * @param query The album being searched for.
 * @param minScore Minimum combined score to trust (defaults to the shared threshold).
 * @returns Trusted candidates, best first.
 */
export function rankCandidates(
  candidates: AlbumArtCandidate[],
  query: AlbumArtQuery,
  minScore: number = MIN_ALBUM_MATCH_SCORE,
  minArtistScore: number = MIN_ARTIST_MATCH_SCORE,
): ScoredAlbumArtCandidate[] {
  const scored: ScoredAlbumArtCandidate[] = [];

  for (const candidate of candidates) {
    const score = scoreAlbumMatch(
      query.artist,
      query.album,
      candidate.artist,
      candidate.album,
    );

    const trusted =
      score.combined >= minScore &&
      score.artist >= minArtistScore &&
      score.album >= MIN_ALBUM_TITLE_MATCH_SCORE;

    if (!trusted) {
      // Only log near-misses; loose provider searches produce lots of noise.
      if (score.combined >= 0.35) {
        console.log(
          `Album art: rejecting ${candidate.provider} result "${candidate.album}" by "${candidate.artist}" (score ${score.combined.toFixed(
            2,
          )}, artist ${score.artist.toFixed(2)}, album ${score.album.toFixed(2)})`,
        );
      }
      continue;
    }

    scored.push({ candidate, score });
  }

  return scored.sort((a, b) => b.score.combined - a.score.combined);
}

/**
 * Ranks track-level candidates by match score, applying the stricter track
 * title floor.
 *
 * The candidate's track title is what must line up; albums are not compared here
 * because the whole point of this path is that we do not know (or cannot trust)
 * the album name.
 * @param candidates The candidates to rank.
 * @param query The track being searched for.
 * @param minScore Minimum combined score to trust (defaults to the shared threshold).
 * @returns Trusted candidates, best first.
 */
export function rankTrackCandidates(
  candidates: AlbumArtCandidate[],
  query: TrackArtQuery,
  minScore: number = MIN_ALBUM_MATCH_SCORE,
  minArtistScore: number = MIN_ARTIST_MATCH_SCORE,
): ScoredAlbumArtCandidate[] {
  const scored: ScoredAlbumArtCandidate[] = [];

  for (const candidate of candidates) {
    const candidateTrack = candidate.track ?? candidate.album;
    const score = scoreAlbumMatch(
      query.artist,
      query.track,
      candidate.artist,
      candidateTrack,
    );

    const trusted =
      score.combined >= minScore &&
      score.artist >= minArtistScore &&
      score.album >= MIN_TRACK_TITLE_MATCH_SCORE;

    if (!trusted) {
      if (score.combined >= 0.35) {
        console.log(
          `Album art: rejecting ${candidate.provider} track "${candidateTrack}" by "${candidate.artist}" (score ${score.combined.toFixed(
            2,
          )}, artist ${score.artist.toFixed(2)}, title ${score.album.toFixed(2)})`,
        );
      }
      continue;
    }

    scored.push({ candidate, score });
  }

  return scored.sort((a, b) => b.score.combined - a.score.combined);
}

// ---------------------------------------------------------------------------
// iTunes Search API
// ---------------------------------------------------------------------------

interface ITunesAlbum {
  collectionId?: number;
  artistName?: string;
  collectionName?: string;
  artworkUrl100?: string;
}

interface ITunesTrack {
  trackId?: number;
  collectionId?: number;
  artistName?: string;
  collectionName?: string;
  trackName?: string;
  artworkUrl100?: string;
}

/**
 * iTunes storefronts to try, in order. The US storefront indexes most Arabic
 * releases; regional storefronts exist for region-locked albums.
 *
 * This list is deliberately short: every extra storefront is another request for
 * every search that finds nothing, and iTunes starts answering 403/429 once a
 * pass hammers it — which is exactly what happens while backfilling a library.
 * US (catalogue breadth) plus the two largest MENA storefronts covers the cases
 * that matter here.
 */
const ITUNES_STOREFRONTS = ["us", "ae", "eg"];

/**
 * Rewrites an iTunes artwork URL to a larger size (the API only returns
 * 100x100 by default; the CDN serves up to ~3000x3000).
 */
function upgradeItunesArtwork(url: string, size = 1200): string {
  return url.replace(/\d+x\d+bb\./, `${size}x${size}bb.`);
}

/**
 * Looks up album candidates in the iTunes Search API.
 * @param query The album to search for.
 * @param terms Optional free-text terms to try instead of "artist album"
 *   (e.g. the source video title); regional storefronts are skipped when only
 *   widening a search that already used the primary term.
 * @returns Scored-ready candidates (possibly empty).
 */
export async function searchItunesCandidates(
  query: AlbumArtQuery,
  terms?: string[],
): Promise<AlbumArtCandidate[]> {
  const searchTerms = expandSearchTerms(
    terms && terms.length > 0 ? terms : [`${query.artist} ${query.album}`],
  );
  const candidates: AlbumArtCandidate[] = [];

  for (const term of searchTerms) {
    for (const storefront of ITUNES_STOREFRONTS) {
      // Only widen to regional storefronts when the primary term found nothing.
      if (storefront !== "us" && candidates.length > 0) {
        break;
      }

      const cacheKey = `${storefront}:${term}`;
      let results = itunesCache.get(cacheKey);

      if (!results) {
        results = await itunesThrottle.schedule(() =>
          requestItunes(term, storefront),
        );
        // A throttled storefront answers for every storefront: caching the
        // empty result is correct, and the next term stops early too.
        itunesCache.set(cacheKey, results);
      }

      candidates.push(...results);

      if (results.length === 0 && isItunesThrottled()) {
        break;
      }
    }
  }

  return dedupeCandidates(candidates);
}

/**
 * Reports whether iTunes is currently throttling this client.
 * @returns True while the cooldown after a 403/429 is in effect.
 */
function isItunesThrottled(): boolean {
  return Date.now() < itunesThrottledUntil;
}

async function requestItunes(
  term: string,
  storefront: string,
): Promise<AlbumArtCandidate[]> {
  const url = `https://itunes.apple.com/search?${new URLSearchParams({
    term,
    entity: "album",
    limit: "10",
    country: storefront,
  }).toString()}`;

  const data = await requestItunesSearch<{ results?: ITunesAlbum[] }>(
    url,
    `${term} [${storefront}]`,
  );

  if (!data.data) {
    return [];
  }

  return (data.data.results ?? [])
    .filter(
      (album) =>
        !!album.collectionName && !!album.artistName && !!album.artworkUrl100,
    )
    .map((album) => ({
      provider: "itunes" as const,
      id: String(album.collectionId ?? album.collectionName),
      artist: album.artistName as string,
      album: album.collectionName as string,
      imageUrls: [upgradeItunesArtwork(album.artworkUrl100 as string)],
    }));
}

/**
 * Looks up track candidates in the iTunes Search API.
 *
 * A song result carries the album it belongs to and that album's artwork, which
 * is the only way to get artwork for a track whose stored album name is missing
 * or wrong — album-level search has nothing to match on in that case.
 * @param query The track to search for.
 * @param terms Optional free-text terms to try instead of "artist track".
 * @returns Scored-ready candidates (possibly empty).
 */
export async function searchItunesTrackCandidates(
  query: TrackArtQuery,
  terms?: string[],
): Promise<AlbumArtCandidate[]> {
  const searchTerms = expandSearchTerms(
    terms && terms.length > 0 ? terms : [`${query.artist} ${query.track}`],
  );
  const candidates: AlbumArtCandidate[] = [];

  for (const term of searchTerms) {
    for (const storefront of ITUNES_STOREFRONTS) {
      if (storefront !== "us" && candidates.length > 0) {
        break;
      }

      const results = await itunesThrottle.schedule(() =>
        requestItunesTracks(term, storefront),
      );

      candidates.push(...results);

      if (results.length === 0 && isItunesThrottled()) {
        break;
      }
    }
  }

  return dedupeCandidates(candidates);
}

async function requestItunesTracks(
  term: string,
  storefront: string,
): Promise<AlbumArtCandidate[]> {
  const url = `https://itunes.apple.com/search?${new URLSearchParams({
    term,
    entity: "song",
    limit: "10",
    country: storefront,
  }).toString()}`;

  const data = await requestItunesSearch<{ results?: ITunesTrack[] }>(
    url,
    `${term} [${storefront}]`,
  );

  if (!data.data) {
    return [];
  }

  return (data.data.results ?? [])
    .filter(
      (track) =>
        !!track.trackName &&
        !!track.artistName &&
        !!track.artworkUrl100 &&
        !!track.collectionName,
    )
    .map((track) => ({
      provider: "itunes" as const,
      id: String(track.trackId ?? `${track.collectionId}:${track.trackName}`),
      artist: track.artistName as string,
      album: track.collectionName as string,
      track: track.trackName as string,
      imageUrls: [upgradeItunesArtwork(track.artworkUrl100 as string)],
    }));
}

// ---------------------------------------------------------------------------
// Deezer API
// ---------------------------------------------------------------------------
interface DeezerAlbum {
  id?: number;
  title?: string;
  artist?: { name?: string };
  cover_xl?: string;
  cover_big?: string;
}

interface DeezerTrack {
  id?: number;
  title?: string;
  artist?: { name?: string };
  album?: {
    title?: string;
    cover_xl?: string;
    cover_big?: string;
  };
}

/**
 * Looks up album candidates in the key-less Deezer API.
 * @param query The album to search for.
 * @param terms Optional free-text terms to try instead of "artist album".
 * @returns Scored-ready candidates (possibly empty).
 */
export async function searchDeezerCandidates(
  query: AlbumArtQuery,
  terms?: string[],
): Promise<AlbumArtCandidate[]> {
  const searchTerms = expandSearchTerms(
    terms && terms.length > 0 ? terms : [`${query.artist} ${query.album}`],
  );
  const candidates: AlbumArtCandidate[] = [];

  for (const term of searchTerms) {
    const cacheKey = term;
    let results = deezerCache.get(cacheKey);

    if (!results) {
      results = await deezerThrottle.schedule(() => requestDeezer(term));
      deezerCache.set(cacheKey, results);
    }

    candidates.push(...results);
  }

  return dedupeCandidates(candidates);
}

async function requestDeezer(term: string): Promise<AlbumArtCandidate[]> {
  const url = `https://api.deezer.com/search/album?${new URLSearchParams({
    q: term,
    limit: "10",
  }).toString()}`;

  try {
    const response = await fetch(url, {
      headers: { "User-Agent": USER_AGENT },
    });

    if (!response.ok) {
      console.warn(
        `Deezer search failed (${response.status} ${response.statusText}) for "${term}"`,
      );
      return [];
    }

    const data = (await response.json()) as {
      data?: DeezerAlbum[];
      error?: unknown;
    };

    if (data.error || !Array.isArray(data.data)) {
      console.warn(`Deezer returned an error payload for "${term}"`);
      return [];
    }

    return data.data
      .filter(
        (album) =>
          !!album.title &&
          !!album.artist?.name &&
          !!(album.cover_xl ?? album.cover_big),
      )
      .map((album) => ({
        provider: "deezer" as const,
        id: String(album.id ?? album.title),
        artist: album.artist?.name as string,
        album: album.title as string,
        imageUrls: [album.cover_xl ?? album.cover_big ?? ""].filter(Boolean),
      }));
  } catch (error) {
    console.warn(`Deezer search error for "${term}":`, error);
    return [];
  }
}

/**
 * Looks up track candidates in the key-less Deezer API.
 *
 * Deezer's MENA catalogue is often the only source for Arabic releases, and a
 * track result carries its album artwork — same rescue as the iTunes track path.
 * @param query The track to search for.
 * @param terms Optional free-text terms to try instead of "artist track".
 * @returns Scored-ready candidates (possibly empty).
 */
export async function searchDeezerTrackCandidates(
  query: TrackArtQuery,
  terms?: string[],
): Promise<AlbumArtCandidate[]> {
  const searchTerms = expandSearchTerms(
    terms && terms.length > 0 ? terms : [`${query.artist} ${query.track}`],
  );
  const candidates: AlbumArtCandidate[] = [];

  for (const term of searchTerms) {
    const results = await deezerThrottle.schedule(() =>
      requestDeezerTracks(term),
    );
    candidates.push(...results);
  }

  return dedupeCandidates(candidates);
}

async function requestDeezerTracks(
  term: string,
): Promise<AlbumArtCandidate[]> {
  const url = `https://api.deezer.com/search/track?${new URLSearchParams({
    q: term,
    limit: "10",
  }).toString()}`;

  try {
    const response = await fetch(url, {
      headers: { "User-Agent": USER_AGENT },
    });

    if (!response.ok) {
      console.warn(
        `Deezer track search failed (${response.status} ${response.statusText}) for "${term}"`,
      );
      return [];
    }

    const data = (await response.json()) as {
      data?: DeezerTrack[];
      error?: unknown;
    };

    if (data.error || !Array.isArray(data.data)) {
      console.warn(`Deezer track search returned an error payload for "${term}"`);
      return [];
    }

    return data.data
      .filter(
        (track) =>
          !!track.title &&
          !!track.artist?.name &&
          !!track.album?.title &&
          !!(track.album?.cover_xl ?? track.album?.cover_big),
      )
      .map((track) => ({
        provider: "deezer" as const,
        id: String(track.id ?? track.title),
        artist: track.artist?.name as string,
        album: track.album?.title as string,
        track: track.title as string,
        imageUrls: [
          track.album?.cover_xl ?? track.album?.cover_big ?? "",
        ].filter(Boolean),
      }));
  } catch (error) {
    console.warn(`Deezer track search error for "${term}":`, error);
    return [];
  }
}

// ---------------------------------------------------------------------------
// MusicBrainz + Cover Art Archive
// ---------------------------------------------------------------------------
interface MusicBrainzRelease {
  id?: string;
  title?: string;
  "artist-credit"?: { name?: string; artist?: { name?: string } }[];
  "release-group"?: { id?: string };
}

/**
 * Searches MusicBrainz for releases and maps them to Cover Art Archive
 * candidates. Both a strict (quoted) and a loose query are attempted; scoring
 * happens later, so loose results are safe to include.
 * @param query The album to search for.
 * @returns Scored-ready candidates (possibly empty).
 */
export async function searchMusicBrainzCandidates(
  query: AlbumArtQuery,
): Promise<AlbumArtCandidate[]> {
  const quoted = `artist:"${query.artist}" AND release:"${query.album}"`;
  const loose = `artist:${query.artist} AND release:${query.album}`;

  for (const [label, searchQuery] of [
    ["strict", quoted],
    ["loose", loose],
  ] as const) {
    const releases = await requestMusicBrainz(searchQuery);
    const candidates = releasesToCandidates(releases);

    if (candidates.length > 0) {
      console.log(
        `Album art: MusicBrainz ${label} query returned ${candidates.length} candidate(s)`,
      );
      return candidates;
    }
  }

  return [];
}

async function requestMusicBrainz(
  searchQuery: string,
): Promise<MusicBrainzRelease[]> {
  const url = `https://musicbrainz.org/ws/2/release?${new URLSearchParams({
    query: searchQuery,
    fmt: "json",
    limit: "10",
  }).toString()}`;

  return musicBrainzThrottle.schedule(async () => {
    try {
      const response = await fetch(url, {
        headers: { "User-Agent": USER_AGENT },
      });

      if (!response.ok) {
        console.warn(
          `MusicBrainz search failed (${response.status} ${response.statusText})`,
        );
        return [];
      }

      const data = (await response.json()) as {
        releases?: MusicBrainzRelease[];
      };
      return data.releases ?? [];
    } catch (error) {
      console.warn("MusicBrainz search error:", error);
      return [];
    }
  });
}

function releasesToCandidates(
  releases: MusicBrainzRelease[],
): AlbumArtCandidate[] {
  const candidates: AlbumArtCandidate[] = [];

  for (const release of releases) {
    const mbid = release["release-group"]?.id;
    if (!mbid || !release.title) {
      continue;
    }

    const credit = release["artist-credit"]?.[0];
    const artist = credit?.artist?.name ?? credit?.name ?? "";

    candidates.push({
      provider: "musicbrainz",
      id: mbid,
      artist,
      album: release.title,
      imageUrls: [
        `https://coverartarchive.org/release-group/${mbid}/front-1200`,
        `https://coverartarchive.org/release-group/${mbid}/front-500`,
        `https://coverartarchive.org/release-group/${mbid}/front`,
      ],
    });
  }

  return dedupeCandidates(candidates);
}

interface MusicBrainzRecording {
  id?: string;
  title?: string;
  "artist-credit"?: { name?: string; artist?: { name?: string } }[];
  releases?: { title?: string; "release-group"?: { id?: string } }[];
}

/**
 * Searches MusicBrainz for *recordings*, mapping each to the artwork of a release
 * it appears on.
 *
 * The album-level MusicBrainz query cannot help a folder whose album name is
 * useless, and for an obscure single the recording is the only entry that exists.
 * Both a strict (quoted) and a loose query are attempted; scoring happens later.
 * @param query The track to search for.
 * @returns Scored-ready candidates (possibly empty).
 */
export async function searchMusicBrainzRecordingCandidates(
  query: TrackArtQuery,
): Promise<AlbumArtCandidate[]> {
  const quoted = `artist:"${query.artist}" AND recording:"${query.track}"`;
  const loose = `artist:${query.artist} AND recording:${query.track}`;

  for (const [label, searchQuery] of [
    ["strict", quoted],
    ["loose", loose],
  ] as const) {
    const recordings = await requestMusicBrainzRecordings(searchQuery);
    const candidates = recordingsToCandidates(recordings);

    if (candidates.length > 0) {
      console.log(
        `Album art: MusicBrainz ${label} recording query returned ${candidates.length} candidate(s)`,
      );
      return candidates;
    }
  }

  return [];
}

async function requestMusicBrainzRecordings(
  searchQuery: string,
): Promise<MusicBrainzRecording[]> {
  const url = `https://musicbrainz.org/ws/2/recording?${new URLSearchParams({
    query: searchQuery,
    fmt: "json",
    limit: "10",
  }).toString()}`;

  return musicBrainzThrottle.schedule(async () => {
    try {
      const response = await fetch(url, {
        headers: { "User-Agent": USER_AGENT },
      });

      if (!response.ok) {
        console.warn(
          `MusicBrainz recording search failed (${response.status} ${response.statusText})`,
        );
        return [];
      }

      const data = (await response.json()) as {
        recordings?: MusicBrainzRecording[];
      };
      return data.recordings ?? [];
    } catch (error) {
      console.warn("MusicBrainz recording search error:", error);
      return [];
    }
  });
}

function recordingsToCandidates(
  recordings: MusicBrainzRecording[],
): AlbumArtCandidate[] {
  const candidates: AlbumArtCandidate[] = [];

  for (const recording of recordings) {
    if (!recording.title) {
      continue;
    }

    const credit = recording["artist-credit"]?.[0];
    const artist = credit?.artist?.name ?? credit?.name ?? "";
    const release = recording.releases?.find(
      (entry) => entry["release-group"]?.id,
    );
    const mbid = release?.["release-group"]?.id;

    candidates.push({
      provider: "musicbrainz",
      id: recording.id ?? `${artist}:${recording.title}`,
      artist,
      // The containing release, for the log line; the track is what is scored.
      album: release?.title ?? "",
      track: recording.title,
      imageUrls: mbid
        ? [
            `https://coverartarchive.org/release-group/${mbid}/front-1200`,
            `https://coverartarchive.org/release-group/${mbid}/front-500`,
            `https://coverartarchive.org/release-group/${mbid}/front`,
          ]
        : [],
    });
  }

  return dedupeCandidates(candidates);
}

// ---------------------------------------------------------------------------
// Discogs
// ---------------------------------------------------------------------------
interface DiscogsSearchResult {
  id?: number;
  title?: string;
  cover_image?: string;
  thumb?: string;
}

interface DiscogsRelease {
  images?: { type?: string; uri?: string }[];
}

/**
 * Performs a Discogs request, authenticating when a token is configured.
 *
 * Discogs search/`releases` data is readable without a token (at a lower rate
 * limit), so a rejected/expired token must not disable the provider entirely —
 * an invalid token has silently broken this provider in the past.
 * @param url The fully built Discogs API URL.
 * @param authenticated Whether to attach the configured token.
 * @returns The raw response.
 */
async function requestDiscogs(
  url: string,
  authenticated: boolean,
): Promise<Response> {
  const headers: Record<string, string> = { "User-Agent": USER_AGENT };

  if (authenticated && discogsApiKey) {
    headers.Authorization = `Discogs token=${discogsApiKey}`;
  }

  let response = await fetch(url, { headers });

  if (response.status === 401 && authenticated && discogsApiKey) {
    console.warn(
      "Discogs rejected the configured DISCOGS_API_KEY (401); retrying without authentication. Check that the token is valid.",
    );
    response = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  }

  return response;
}

/**
 * Searches Discogs. Search results only expose small thumbnails, so the release
 * detail endpoint is queried (for the top few results) to get full-size scans.
 * @param query The album to search for.
 * @returns Scored-ready candidates (possibly empty).
 */
export async function searchDiscogsCandidates(
  query: AlbumArtQuery,
): Promise<AlbumArtCandidate[]> {
  if (!discogsApiKey) {
    console.log(
      "Discogs API key not configured; using unauthenticated Discogs search",
    );
  }

  const url = `https://api.discogs.com/database/search?${new URLSearchParams({
    artist: query.artist,
    release_title: query.album,
    type: "release",
    per_page: "5",
  }).toString()}`;

  const results = await discogsThrottle.schedule(async () => {
    try {
      const response = await requestDiscogs(url, true);

      if (!response.ok) {
        console.warn(
          `Discogs search failed (${response.status} ${response.statusText})`,
        );
        return [] as DiscogsSearchResult[];
      }

      const data = (await response.json()) as {
        results?: DiscogsSearchResult[];
      };
      return data.results ?? [];
    } catch (error) {
      console.warn("Discogs search error:", error);
      return [] as DiscogsSearchResult[];
    }
  });

  const candidates: AlbumArtCandidate[] = [];
  let detailLookups = 0;

  for (const result of results) {
    if (!result.id) {
      continue;
    }

    const parsed = parseDiscogsTitle(result.title ?? "");
    const imageUrls: string[] = [];

    if (result.cover_image) {
      imageUrls.push(result.cover_image);
    }

    // Search results only carry 150px thumbs; fetch the release for full scans
    // (bounded so a single album search cannot fan out into many requests).
    if (!result.cover_image && detailLookups < 3) {
      detailLookups++;
      const release = await fetchDiscogsRelease(result.id);
      const primary =
        release?.images?.find((image) => image.type === "primary") ??
        release?.images?.[0];

      if (primary?.uri) {
        imageUrls.push(primary.uri);
      } else if (result.thumb) {
        imageUrls.push(result.thumb);
      }
    }

    if (imageUrls.length === 0 && result.thumb) {
      imageUrls.push(result.thumb);
    }

    candidates.push({
      provider: "discogs",
      id: String(result.id),
      artist: parsed.artist,
      album: parsed.album,
      imageUrls,
    });
  }

  return dedupeCandidates(candidates);
}

async function fetchDiscogsRelease(
  releaseId: number,
): Promise<DiscogsRelease | null> {
  return discogsThrottle.schedule(async () => {
    try {
      const response = await requestDiscogs(
        `https://api.discogs.com/releases/${releaseId}`,
        true,
      );

      if (!response.ok) {
        return null;
      }

      return (await response.json()) as DiscogsRelease;
    } catch (error) {
      console.warn(`Discogs release lookup failed for ${releaseId}:`, error);
      return null;
    }
  });
}

/**
 * Discogs search titles are formatted as "Artist - Album".
 * @param title The raw search result title.
 * @returns The parsed artist/album pair.
 */
function parseDiscogsTitle(title: string): { artist: string; album: string } {
  const separatorIndex = title.indexOf(" - ");

  if (separatorIndex === -1) {
    return { artist: "", album: title };
  }

  return {
    artist: title.slice(0, separatorIndex),
    album: title.slice(separatorIndex + 3),
  };
}
