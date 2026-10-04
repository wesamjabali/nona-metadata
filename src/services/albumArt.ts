/**
 * Album art orchestration.
 *
 * Lookup order (best precision first):
 *  1. iTunes + Deezer — key-less, high-resolution artwork and the best
 *     coverage for both English and Arabic/MENA releases. Both are queried in
 *     parallel with "artist album".
 *  2. The same two providers asked for the *track* instead ("artist track",
 *     iTunes `entity=song` / Deezer `/search/track`). A track result carries the
 *     album it belongs to, which is the only way to get art when the stored
 *     album name is missing or wrong — a folder called "Unknown Album" has
 *     nothing else to match on.
 *  3. The same two providers widened with hints derived from the source media
 *     (e.g. the YouTube video title / uploader), which rescues albums and tracks
 *     whose stored name differs from the provider's edition name.
 *  4. The same two providers asked for the *artist* alone, scored against the
 *     release title with a higher artist floor. A release can be credited under a
 *     spelling no title search will guess (Deezer's "Ya Talaaen El Jabal" vs the
 *     folder's "Ya Tal'een Al Jabal"), and the artist name is the one term known
 *     to be right.
 *  5. MusicBrainz / Cover Art Archive + Discogs — free community databases,
 *     weaker on Arabic material, only used when the above fail.
 *  6. The caller-supplied fallback image(s) — typically the source video's
 *     thumbnail, including the deterministic YouTube variants — so a folder at
 *     least gets *some* artwork.
 *  7. A generated placeholder cover (gradient + artist/album text), when the
 *     caller asks for one. This is what guarantees a folder is never blank: a
 *     real cover always wins, but "no artwork at all" stops being an outcome.
 *     Generated covers are marked on disk so a later run can still replace them
 *     with the real thing.
 *
 * Every provider candidate is scored against the requested artist/album by
 * `utils/musicMatching.ts` before its image is downloaded. Being wrong is worse
 * than being empty: a rejected candidate falls through to the next provider or
 * to the thumbnail fallback.
 */

import { removeFileExtension } from "../utils/file.js";
import {
  MIN_ALBUM_MATCH_SCORE,
  MIN_ARTIST_MATCH_SCORE,
  MIN_ARTIST_ONLY_MATCH_SCORE,
} from "../utils/musicMatching.js";
import type {
  AlbumArtCandidate,
  AlbumArtProvider,
  AlbumArtQuery,
  ScoredAlbumArtCandidate,
  TrackArtQuery,
} from "./albumArtProviders.js";
import {
  dedupeCandidates,
  rankCandidates,
  rankTrackCandidates,
  searchDeezerCandidates,
  searchDeezerTrackCandidates,
  searchDiscogsCandidates,
  searchItunesCandidates,
  searchItunesTrackCandidates,
  searchMusicBrainzCandidates,
} from "./albumArtProviders.js";
import { generatePlaceholderArt } from "./albumArtPlaceholder.js";

const USER_AGENT =
  "nona-metadata/1.0.0 (https://github.com/nona-metadata/nona-metadata)";

/**
 * Smallest acceptable fallback image, in bytes.
 *
 * YouTube answers a deleted/unavailable video's `hqdefault.jpg` with a 120x90
 * grey placeholder (~1.3 KB) instead of a 404. Saving that as `cover.jpg` is
 * worse than leaving the album without artwork, so tiny images are rejected.
 */
const MIN_FALLBACK_IMAGE_BYTES = 2048;

/** Extra context about the source media, used to widen provider searches. */
export interface AlbumArtHints {
  /** Title of the source media (e.g. the YouTube video title). */
  title?: string;
  /** Uploader/channel of the source media. */
  uploader?: string;
  /** Source URL; logged only. */
  sourceUrl?: string;
}

/** Optional inputs for {@link fetchAlbumArt}. */
export interface AlbumArtSourceContext {
  /** Image URL to use when no provider has a trustworthy match. */
  fallbackImageUrl?: string;
  /**
   * Further fallback images, tried in order after {@link fallbackImageUrl}.
   * YouTube thumbnail variants belong here: the highest resolution is not
   * published for every upload, so the next variant has to be attempted.
   */
  fallbackImageUrls?: string[];
  /** Extra search context (video title/uploader) to widen provider queries. */
  hints?: AlbumArtHints;
}

export interface FetchAlbumArtOptions extends AlbumArtSourceContext {
  /**
   * Lazily resolves the source-media context. Only invoked when the fast
   * providers miss, so expensive lookups (e.g. yt-dlp against the stored
   * source URL) are not paid for albums that already matched.
   */
  resolveSourceContext?: () => Promise<AlbumArtSourceContext>;
  /**
   * Track title, which enables the track-level rescue described above. Pass it
   * only when the folder holds that single track: attributing one track's
   * cover to a multi-track folder would be a guess, not a match.
   */
  trackTitle?: string;
  /**
   * Draw a placeholder cover when neither a provider nor a thumbnail produced
   * anything. Off by default, so a caller that would rather have no art than
   * invented art can say so.
   */
  allowGeneratedArt?: boolean;
  /**
   * Text drawn on the generated cover. Defaults to the album name, then the
   * track title, then "Singles" — never the literal "Unknown Album".
   */
  placeholderLabel?: string;
}

/** A downloaded image with its MIME type. */
export interface DownloadedImage {
  data: ArrayBuffer;
  contentType: string;
}

/** Where a cover came from, which is how callers recognise generated art. */
export type AlbumArtSource = AlbumArtProvider | "thumbnail" | "generated";

/** A downloaded cover plus its provenance. */
export interface AlbumArtResult extends DownloadedImage {
  /** Which step of the chain produced this image. */
  source: AlbumArtSource;
  /** Human-readable provenance, for logs and job results. */
  description: string;
}

/**
 * Determines the file extension based on content type.
 * @param contentType The MIME content type.
 * @returns The appropriate file extension.
 */
function getExtensionFromContentType(contentType: string): string {
  const lowerContentType = contentType.toLowerCase();

  if (lowerContentType.includes("image/png")) {
    return ".png";
  } else if (lowerContentType.includes("image/gif")) {
    return ".gif";
  } else if (lowerContentType.includes("image/webp")) {
    return ".webp";
  } else if (lowerContentType.includes("image/bmp")) {
    return ".bmp";
  } else if (lowerContentType.includes("image/svg")) {
    return ".svg";
  } else {
    return ".jpg";
  }
}

/**
 * Downloads an image from an arbitrary URL.
 * @param url The image URL to download.
 * @param options Optional download guards.
 * @param options.minBytes Reject images smaller than this, in bytes. Used for
 * fallback images so placeholder art is never saved as a cover.
 * @returns The image data + content type, or null when it is not an image.
 */
export async function fetchImageFromUrl(
  url: string,
  options: { minBytes?: number } = {},
): Promise<DownloadedImage | null> {
  const minBytes = options.minBytes ?? 0;

  try {
    const response = await fetch(url, {
      headers: { "User-Agent": USER_AGENT },
      redirect: "follow",
    });

    if (!response.ok) {
      console.warn(
        `Failed to download image (${response.status} ${response.statusText}): ${url}`,
      );
      return null;
    }

    const contentType = response.headers.get("content-type") || "image/jpeg";
    if (!contentType.toLowerCase().startsWith("image/")) {
      console.warn(`URL is not an image (${contentType}): ${url}`);
      return null;
    }

    const data = await response.arrayBuffer();
    if (data.byteLength === 0) {
      console.warn(`Downloaded an empty image: ${url}`);
      return null;
    }

    if (data.byteLength < minBytes) {
      console.warn(
        `Downloaded an image that is too small to be artwork (${data.byteLength} < ${minBytes} bytes): ${url}`,
      );
      return null;
    }

    return { data, contentType };
  } catch (error) {
    console.error("An error occurred while downloading an image:", error);
    return null;
  }
}

/**
 * Strips release-format noise from a media title so it can be used as a
 * provider search term (e.g. "Time (Official Audio)" -> "Time").
 * @param title The raw media title.
 * @returns The cleaned title, or null when nothing useful remains.
 */
function cleanMediaTitle(title: string): string | null {
  const cleaned = title
    .replace(
      /\((?:[^)]*(?:official|lyrics?|audio|video|visuali[sz]er)[^)]*)\)/gi,
      " ",
    )
    .replace(
      /\[(?:[^\]]*(?:official|lyrics?|audio|video|visuali[sz]er)[^\]]*)\]/gi,
      " ",
    )
    .replace(
      /\b(?:official\s+)?(?:music\s+)?(?:video|audio|lyric\s+video|visualizer)\b/gi,
      " ",
    )
    .replace(/\s+/g, " ")
    .trim();

  return cleaned.length > 2 ? cleaned : null;
}

/**
 * Builds alternative free-text search terms from the source-media hints.
 * @param query The album being searched for.
 * @param hints Source-media context, when available.
 * @returns Up to two extra search terms.
 */
function buildExtraSearchTerms(
  query: AlbumArtQuery,
  hints?: AlbumArtHints,
): string[] {
  if (!hints) {
    return [];
  }

  const terms: string[] = [];

  const title = hints.title ? cleanMediaTitle(hints.title) : null;
  if (title) {
    terms.push(title);
  }

  const uploader = hints.uploader?.trim();
  if (uploader && uploader.length > 2) {
    terms.push(`${uploader} ${query.album}`);
  }

  return [...new Set(terms)].slice(0, 2);
}

/**
 * Runs provider searches in parallel, tolerating individual failures.
 * @param searches The provider search promises.
 * @returns The de-duplicated union of all successful results.
 */
async function gatherCandidates(
  searches: Promise<AlbumArtCandidate[]>[],
): Promise<AlbumArtCandidate[]> {
  const settled = await Promise.all(
    searches.map((search) => search.catch(() => [] as AlbumArtCandidate[])),
  );

  return dedupeCandidates(settled.flat());
}

/**
 * Downloads the best of the already-ranked candidates.
 *
 * Each candidate's image URLs are tried in order (a high-resolution URL may 404
 * even when a smaller one exists), so one dead image does not lose the match.
 * @param ranked Trusted candidates, best first.
 * @returns The downloaded image and its provenance, or null when every image
 * failed to download.
 */
async function downloadRankedCandidates(
  ranked: ScoredAlbumArtCandidate[],
): Promise<AlbumArtResult | null> {
  for (const { candidate, score } of ranked) {
    for (const url of candidate.imageUrls) {
      const image = await fetchImageFromUrl(url);

      if (image) {
        const matched = candidate.track
          ? `${candidate.track} (album "${candidate.album}")`
          : `"${candidate.album}"`;

        console.log(
          `Album art: matched via ${candidate.provider} — ${matched} by "${candidate.artist}" (score ${score.combined.toFixed(
            2,
          )}, artist ${score.artist.toFixed(2)}, title ${score.album.toFixed(2)})`,
        );

        return {
          ...image,
          source: candidate.provider,
          description: `${candidate.provider}: ${matched} by ${candidate.artist}`,
        };
      }
    }

    console.warn(
      `Album art: ${candidate.provider} candidate "${
        candidate.track ?? candidate.album
      }" had no downloadable image, trying next...`,
    );
  }

  return null;
}

/**
 * Ranks album-level candidates and downloads the best one.
 * @param candidates The raw provider candidates.
 * @param query The album being searched for.
 * @param minArtistScore Artist floor to apply (higher for artist-driven searches).
 * @returns The downloaded image and its provenance, or null.
 */
async function downloadAlbumCover(
  candidates: AlbumArtCandidate[],
  query: AlbumArtQuery,
  minArtistScore: number = MIN_ARTIST_MATCH_SCORE,
): Promise<AlbumArtResult | null> {
  return downloadRankedCandidates(
    rankCandidates(candidates, query, MIN_ALBUM_MATCH_SCORE, minArtistScore),
  );
}

/**
 * Ranks track-level candidates and downloads the best one.
 * @param candidates The raw provider candidates.
 * @param query The track being searched for.
 * @param minArtistScore Artist floor to apply (higher for artist-driven searches).
 * @returns The downloaded image and its provenance, or null.
 */
async function downloadTrackCover(
  candidates: AlbumArtCandidate[],
  query: TrackArtQuery,
  minArtistScore: number = MIN_ARTIST_MATCH_SCORE,
): Promise<AlbumArtResult | null> {
  return downloadRankedCandidates(
    rankTrackCandidates(candidates, query, MIN_ALBUM_MATCH_SCORE, minArtistScore),
  );
}

/**
 * Flattens a source context into the ordered, de-duplicated fallback URL list.
 * @param context The resolved source-media context.
 * @returns Fallback image URLs, most preferred first.
 */
function collectFallbackImageUrls(context: AlbumArtSourceContext): string[] {
  const urls = [context.fallbackImageUrl, ...(context.fallbackImageUrls ?? [])];

  return [
    ...new Set(urls.filter((url): url is string => Boolean(url?.trim()))),
  ];
}

/**
 * Fetches album art for a given artist and album.
 * @param artist The artist's name.
 * @param album The album's title. May be empty or the placeholder name
 * "Unknown Album" — the track-level step covers those cases.
 * @param options Source-media hints, track title, fallback image URLs, and the
 * switch that allows a generated cover as the final fallback.
 * @returns The image data, its content type and where it came from, or null if
 * nothing suitable was found.
 */
export async function fetchAlbumArt(
  artist: string,
  album: string,
  options: FetchAlbumArtOptions = {},
): Promise<AlbumArtResult | null> {
  const artistName = (artist ?? "").trim();
  const albumName = (album ?? "").trim();
  const trackTitle = options.trackTitle?.trim() || null;

  if (!artistName) {
    return null;
  }

  // "Unknown Album" is a real folder with a useless name: it cannot match
  // anything at a provider, so it is skipped rather than searched for.
  const hasSearchableAlbum =
    albumName.length > 0 && albumName !== "Unknown Album";

  if (hasSearchableAlbum) {
    const albumQuery: AlbumArtQuery = { artist: artistName, album: albumName };

    console.log(
      `Album art: searching for "${albumName}" by "${artistName}"...`,
    );

    // Phase 1: key-less providers with the strongest English + Arabic catalogues.
    const primaryCandidates = await gatherCandidates([
      searchItunesCandidates(albumQuery),
      searchDeezerCandidates(albumQuery),
    ]);

    const primaryImage = await downloadAlbumCover(
      primaryCandidates,
      albumQuery,
    );
    if (primaryImage) {
      return primaryImage;
    }
  }

  /**
   * Phase 2 (and its widened repeat in phase 3): search for the track itself and
   * use the artwork of the release it belongs to.
   * @param terms Search terms to use instead of the default "artist track".
   * @returns The downloaded cover, or null when there is no track title or no
   * trustworthy match.
   */
  const resolveTrackCover = async (
    terms?: string[],
  ): Promise<AlbumArtResult | null> => {
    if (!trackTitle) {
      return null;
    }

    const trackQuery: TrackArtQuery = { artist: artistName, track: trackTitle };
    const candidates = await gatherCandidates([
      searchItunesTrackCandidates(trackQuery, terms),
      searchDeezerTrackCandidates(trackQuery, terms),
    ]);

    return downloadTrackCover(candidates, trackQuery);
  };

  const trackImage = await resolveTrackCover();
  if (trackImage) {
    return trackImage;
  }

  // Resolve source-media context only now that the fast providers have missed,
  // so callers can hand us an expensive lazy lookup (yt-dlp on the source URL).
  let resolvedContext: AlbumArtSourceContext | null = null;
  const loadSourceContext = async (): Promise<AlbumArtSourceContext> => {
    if (resolvedContext) {
      return resolvedContext;
    }

    if (options.resolveSourceContext) {
      try {
        resolvedContext = await options.resolveSourceContext();
      } catch (error) {
        console.warn(
          "Album art: failed to resolve source context:",
          (error as Error).message,
        );
        resolvedContext = {};
      }
    } else {
      resolvedContext = {
        fallbackImageUrl: options.fallbackImageUrl,
        fallbackImageUrls: options.fallbackImageUrls,
        hints: options.hints,
      };
    }

    return resolvedContext;
  };

  const sourceContext = await loadSourceContext();
  const extraTerms = buildExtraSearchTerms(
    { artist: artistName, album: albumName || trackTitle || "" },
    sourceContext.hints,
  );

  // Phase 3: widen both searches with terms taken from the source media. This
  // helps when the stored name differs from the provider's edition name, and
  // gives Arabic releases an alternative spelling to match on.
  if (extraTerms.length > 0) {
    console.log(
      `Album art: no confident match, widening search with: ${extraTerms.join(
        " | ",
      )}`,
    );

    const widenedTrackImage = await resolveTrackCover(extraTerms);
    if (widenedTrackImage) {
      return widenedTrackImage;
    }

    if (hasSearchableAlbum) {
      const albumQuery: AlbumArtQuery = { artist: artistName, album: albumName };
      const widenedCandidates = await gatherCandidates([
        searchItunesCandidates(albumQuery, extraTerms),
        searchDeezerCandidates(albumQuery, extraTerms),
      ]);

      const widenedImage = await downloadAlbumCover(
        widenedCandidates,
        albumQuery,
      );
      if (widenedImage) {
        return widenedImage;
      }
    }
  }

  // Phase 4: ask the providers for the artist's own catalogue. This is the last
  // provider step and exists because a release can be credited under a spelling
  // no title search will guess — Deezer has Rim Banna's "Ya Talaaen El Jabal",
  // while the folder says "Ya Tal'een Al Jabal" and no query built from the title
  // finds it. The artist name is the one term known to be right, and the higher
  // artist floor compensates for the looser query.
  if (trackTitle) {
    const artistOnlyTrackQuery: TrackArtQuery = {
      artist: artistName,
      track: trackTitle,
    };

    const artistOnlyTrack = await downloadTrackCover(
      await gatherCandidates([
        searchItunesTrackCandidates(artistOnlyTrackQuery, [artistName]),
        searchDeezerTrackCandidates(artistOnlyTrackQuery, [artistName]),
      ]),
      artistOnlyTrackQuery,
      MIN_ARTIST_ONLY_MATCH_SCORE,
    );

    if (artistOnlyTrack) {
      return artistOnlyTrack;
    }
  }

  if (trackTitle) {
    const titleOnlyQuery: TrackArtQuery = {
      artist: artistName,
      track: trackTitle,
    };

    // Title alone. A combined "artist title" query returns nothing when the
    // provider files the two fields under different spellings or scripts —
    // Deezer answers "دعسوقة فرنصا" with zero results, but "فرنصا" alone returns
    // the track credited to "Do3souqa". The ordinary artist floor still applies,
    // so the other artists who recorded the same song stay out.
    const titleOnlyTrack = await downloadTrackCover(
      await gatherCandidates([
        searchItunesTrackCandidates(titleOnlyQuery, [trackTitle]),
        searchDeezerTrackCandidates(titleOnlyQuery, [trackTitle]),
      ]),
      titleOnlyQuery,
    );

    if (titleOnlyTrack) {
      return titleOnlyTrack;
    }
  }

  if (hasSearchableAlbum) {
    const artistOnlyAlbumQuery: AlbumArtQuery = {
      artist: artistName,
      album: albumName,
    };

    const artistOnlyAlbum = await downloadAlbumCover(
      await gatherCandidates([
        searchItunesCandidates(artistOnlyAlbumQuery, [artistName]),
        searchDeezerCandidates(artistOnlyAlbumQuery, [artistName]),
      ]),
      artistOnlyAlbumQuery,
      MIN_ARTIST_ONLY_MATCH_SCORE,
    );

    if (artistOnlyAlbum) {
      return artistOnlyAlbum;
    }
  }

  // Phase 5: community databases. Lower coverage (especially for Arabic
  // releases) but occasionally the only source, so still verified by score.
  if (hasSearchableAlbum) {
    const albumQuery: AlbumArtQuery = { artist: artistName, album: albumName };
    const secondaryCandidates = await gatherCandidates([
      searchMusicBrainzCandidates(albumQuery),
      searchDiscogsCandidates(albumQuery),
    ]);

    const secondaryImage = await downloadAlbumCover(
      secondaryCandidates,
      albumQuery,
    );
    if (secondaryImage) {
      return secondaryImage;
    }
  }

  // Phase 6: the source video's thumbnail. Several URLs may be offered (e.g.
  // YouTube's maxres/sd/hq variants) because the highest resolution is not
  // published for every video — the first one that downloads wins.
  const fallbackUrls = collectFallbackImageUrls(sourceContext);
  if (fallbackUrls.length > 0) {
    console.log(
      `Album art: no provider match, trying ${fallbackUrls.length} fallback image(s)...`,
    );

    for (const url of fallbackUrls) {
      const image = await fetchImageFromUrl(url, {
        minBytes: MIN_FALLBACK_IMAGE_BYTES,
      });

      if (image) {
        console.log(`Album art: using fallback image: ${url}`);
        return {
          ...image,
          source: "thumbnail",
          description: `source thumbnail: ${url}`,
        };
      }

      console.warn(
        `Album art: fallback image unavailable, trying the next one: ${url}`,
      );
    }
  }

  // Phase 7: draw one, so a folder is never left blank.
  if (options.allowGeneratedArt) {
    const label =
      options.placeholderLabel?.trim() ||
      (hasSearchableAlbum ? albumName : trackTitle) ||
      "Singles";

    const generated = await generatePlaceholderArt(artistName, label);
    if (generated) {
      return {
        ...generated,
        source: "generated",
        description: `generated cover: ${artistName} — ${label}`,
      };
    }
  }

  console.log(
    `Album art: no artwork found for "${albumName || trackTitle}" by "${artistName}"`,
  );
  return null;
}

/**
 * Saves album art to a file with the correct extension based on content type.
 * @param imageData The image data as ArrayBuffer.
 * @param contentType The MIME content type of the image.
 * @param basePath The base path without extension where to save the image.
 * @returns The actual file path where the image was saved, or null if failed.
 */
export async function saveAlbumArt(
  imageData: ArrayBuffer,
  contentType: string,
  basePath: string,
): Promise<string | null> {
  try {
    const extension = getExtensionFromContentType(contentType);
    const filePath = removeFileExtension(basePath) + extension;

    await Bun.write(filePath, new Uint8Array(imageData));
    console.log(`Successfully saved album cover to ${filePath}`);
    return filePath;
  } catch (error) {
    console.error("Failed to write image file:", error);
    return null;
  }
}
