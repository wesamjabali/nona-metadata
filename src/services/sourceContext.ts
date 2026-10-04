/**
 * Source-media context for album-art lookups.
 *
 * Every processed track records `Source: <url>` in its comment tag. That URL is
 * worth two things when no provider has a cover: search hints (the source
 * video's title and uploader) and a fallback image (the video's own thumbnail).
 *
 * This lives on its own so the backfill and the audit resolve a folder's context
 * the same way — an audit that skipped it would report far more "no artwork"
 * than the real pass produces.
 */

import type { AlbumArtSourceContext } from "./albumArt.js";
import { getVideoInfo } from "./youtube.js";
import { buildSearchHints, pickThumbnailUrls } from "../utils/thumbnail.js";
import { buildYouTubeThumbnailUrlsFromSourceUrl } from "../utils/youtubeUrl.js";

/**
 * Resolves the album art context for a track from its stored source URL.
 *
 * For a YouTube source the thumbnail URLs are derived straight from the video ID
 * in the comment, so artwork is still available when yt-dlp cannot reach the
 * video (removed/private uploads, rate limiting, a broken extractor). yt-dlp is
 * used to *enrich* that: it supplies real search hints and, where available, its
 * own highest-resolution still.
 *
 * A file processed before the comment tag existed has no URL — expected, and not
 * an error.
 * @param sourceUrl The source URL read from the file's comment tag, if any.
 * @returns Fallback image URLs (best first) and optional search hints.
 */
export async function resolveSourceContext(
  sourceUrl: string | null,
): Promise<AlbumArtSourceContext> {
  if (!sourceUrl) {
    console.log("ℹ️  No source URL stored in metadata (legacy file)");
    return {};
  }

  console.log(`🔗 Source URL: ${sourceUrl}`);

  try {
    const videoInfo = await getVideoInfo(sourceUrl);

    return {
      fallbackImageUrls: pickThumbnailUrls(videoInfo, sourceUrl),
      hints: buildSearchHints(videoInfo, sourceUrl),
    };
  } catch (error) {
    console.warn(
      `⚠️  Could not fetch info for source URL ${sourceUrl}:`,
      (error as Error).message,
    );

    const youtubeThumbnailUrls =
      buildYouTubeThumbnailUrlsFromSourceUrl(sourceUrl);

    if (youtubeThumbnailUrls.length > 0) {
      console.log(
        "↩️  Falling back to the YouTube thumbnail URLs built from the video id",
      );
      return { fallbackImageUrls: youtubeThumbnailUrls };
    }

    return {};
  }
}
