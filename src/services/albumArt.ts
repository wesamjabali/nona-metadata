/**
 * Album art orchestration.
 *
 * Lookup order (best precision first):
 *  1. iTunes + Deezer — key-less, high-resolution artwork and the best
 *     coverage for both English and Arabic/MENA releases. Both are queried in
 *     parallel with "artist album".
 *  2. The same two providers widened with hints derived from the source media
 *     (e.g. the YouTube video title / uploader), which rescues albums whose
 *     stored name differs from the provider's edition name.
 *  3. MusicBrainz / Cover Art Archive + Discogs — free community databases,
 *     weaker on Arabic material, only used when the above fail.
 *  4. The caller-supplied fallback image (typically the source video's
 *     thumbnail) so a folder at least gets *some* artwork.
 *
 * Every provider candidate is scored against the requested artist/album by
 * `utils/musicMatching.ts` before its image is downloaded. Being wrong is worse
 * than being empty: a rejected candidate falls through to the next provider or
 * to the thumbnail fallback.
 */

import { removeFileExtension } from "../utils/file.js";
import type { AlbumArtCandidate, AlbumArtQuery } from "./albumArtProviders.js";
import {
  dedupeCandidates,
  rankCandidates,
  searchDeezerCandidates,
  searchDiscogsCandidates,
  searchItunesCandidates,
  searchMusicBrainzCandidates,
} from "./albumArtProviders.js";

const USER_AGENT =
  "nona-metadata/1.0.0 (https://github.com/nona-metadata/nona-metadata)";

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
}

/** A downloaded image with its MIME type. */
export interface DownloadedImage {
  data: ArrayBuffer;
  contentType: string;
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
 * @returns The image data + content type, or null when it is not an image.
 */
export async function fetchImageFromUrl(
  url: string,
): Promise<DownloadedImage | null> {
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
 * Downloads the highest-scoring trustworthy candidate.
 *
 * Candidates are ranked by match score, then each of their image URLs is tried
 * in order (a high-resolution URL may 404 even when a smaller one exists).
 * @param candidates The raw provider candidates.
 * @param query The album being searched for.
 * @returns The downloaded image, or null when nothing scored/downloaded.
 */
async function downloadBestCandidate(
  candidates: AlbumArtCandidate[],
  query: AlbumArtQuery,
): Promise<DownloadedImage | null> {
  const ranked = rankCandidates(candidates, query);

  for (const { candidate, score } of ranked) {
    for (const url of candidate.imageUrls) {
      const image = await fetchImageFromUrl(url);

      if (image) {
        console.log(
          `Album art: matched via ${candidate.provider} — "${candidate.album}" by "${candidate.artist}" (score ${score.combined.toFixed(
            2,
          )}, artist ${score.artist.toFixed(2)}, album ${score.album.toFixed(2)})`,
        );
        return image;
      }
    }

    console.warn(
      `Album art: ${candidate.provider} candidate "${candidate.album}" had no downloadable image, trying next...`,
    );
  }

  return null;
}

/**
 * Fetches album art for a given artist and album.
 * @param artist The artist's name.
 * @param album The album's title.
 * @param options Optional source-media hints and a fallback image URL.
 * @returns The image data + content type, or null if nothing suitable was found.
 */
export async function fetchAlbumArt(
  artist: string,
  album: string,
  options: FetchAlbumArtOptions = {},
): Promise<DownloadedImage | null> {
  const query: AlbumArtQuery = { artist: artist.trim(), album: album.trim() };

  if (!query.artist || !query.album) {
    return null;
  }

  console.log(
    `Album art: searching for "${query.album}" by "${query.artist}"...`,
  );

  // Phase 1: key-less providers with the strongest English + Arabic catalogues.
  const primaryCandidates = await gatherCandidates([
    searchItunesCandidates(query),
    searchDeezerCandidates(query),
  ]);

  const primaryImage = await downloadBestCandidate(primaryCandidates, query);
  if (primaryImage) {
    return primaryImage;
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
        hints: options.hints,
      };
    }

    return resolvedContext;
  };

  const sourceContext = await loadSourceContext();

  // Phase 2: retry with terms taken from the source media. This helps when the
  // stored album name differs from the provider's edition name, and gives
  // Arabic releases an alternative spelling to match on.
  const extraTerms = buildExtraSearchTerms(query, sourceContext.hints);
  if (extraTerms.length > 0) {
    console.log(
      `Album art: no confident match, widening search with: ${extraTerms.join(
        " | ",
      )}`,
    );

    const widenedCandidates = await gatherCandidates([
      searchItunesCandidates(query, extraTerms),
      searchDeezerCandidates(query, extraTerms),
    ]);

    const widenedImage = await downloadBestCandidate(widenedCandidates, query);
    if (widenedImage) {
      return widenedImage;
    }
  }

  // Phase 3: community databases. Lower coverage (especially for Arabic
  // releases) but occasionally the only source, so still verified by score.
  const secondaryCandidates = await gatherCandidates([
    searchMusicBrainzCandidates(query),
    searchDiscogsCandidates(query),
  ]);

  const secondaryImage = await downloadBestCandidate(
    secondaryCandidates,
    query,
  );
  if (secondaryImage) {
    return secondaryImage;
  }

  // Phase 4: the source video's thumbnail, when the caller provided one.
  if (sourceContext.fallbackImageUrl) {
    console.log(
      `Album art: no provider match, using fallback image: ${sourceContext.fallbackImageUrl}`,
    );
    return await fetchImageFromUrl(sourceContext.fallbackImageUrl);
  }

  console.log(
    `Album art: no artwork found for "${query.album}" by "${query.artist}"`,
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
