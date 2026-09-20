/**
 * Helpers for turning yt-dlp video payloads into usable artwork/hints.
 *
 * yt-dlp exposes a `thumbnail` plus a `thumbnails` list that mixes real stills
 * with storyboard sprite sheets (which carry `rows`/`columns`). Storyboards are
 * tiled grids of tiny frames, so they must never be used as artwork.
 */

import { buildYouTubeThumbnailUrlsFromSourceUrl } from "./youtubeUrl.js";

/** Search hints derived from a source media's metadata. */
export interface MediaSearchHints {
  /** Title of the source media (e.g. the YouTube video title). */
  title?: string;
  /** Uploader/channel of the source media. */
  uploader?: string;
  /** The source URL the hints came from. */
  sourceUrl?: string;
}

/**
 * Builds the ordered list of thumbnail URLs to use as album art fallbacks.
 *
 * The yt-dlp payload is tried first (it knows the real stills for every
 * extractor, not just YouTube), then — when the source is a YouTube URL — the
 * deterministic `i.ytimg.com` variants for the video ID. Those extra URLs cost
 * nothing and cover the cases where yt-dlp reports no thumbnail, reports a
 * stale one, or fails entirely.
 * @param videoInfo The yt-dlp video metadata.
 * @param sourceUrl The source URL the payload came from, if known.
 * @returns Thumbnail URLs, best first (possibly empty).
 */
export function pickThumbnailUrls(
  videoInfo: any,
  sourceUrl?: string,
): string[] {
  const urls: string[] = [];

  const fromPayload = pickThumbnailUrl(videoInfo);
  if (fromPayload) {
    urls.push(fromPayload);
  }

  const webpageUrl =
    sourceUrl ??
    (typeof videoInfo?.webpage_url === "string"
      ? videoInfo.webpage_url
      : undefined) ??
    (typeof videoInfo?.original_url === "string"
      ? videoInfo.original_url
      : undefined);

  for (const url of buildYouTubeThumbnailUrlsFromSourceUrl(webpageUrl)) {
    if (!urls.includes(url)) {
      urls.push(url);
    }
  }

  return urls;
}

/**
 * Picks the most useful thumbnail URL from a yt-dlp video payload, if any.
 * @param videoInfo The yt-dlp video metadata.
 * @returns The best thumbnail URL, or undefined when none is available.
 */
export function pickThumbnailUrl(videoInfo: any): string | undefined {
  const thumbnails = Array.isArray(videoInfo?.thumbnails)
    ? videoInfo.thumbnails.filter(
        (thumbnail: any) =>
          typeof thumbnail?.url === "string" &&
          thumbnail?.rows === undefined &&
          thumbnail?.columns === undefined,
      )
    : [];

  const largest = thumbnails.sort(
    (a: any, b: any) =>
      (b.width ?? 0) * (b.height ?? 0) - (a.width ?? 0) * (a.height ?? 0),
  )[0];

  return largest?.url ?? videoInfo?.thumbnail;
}

/**
 * Builds album art search hints from a yt-dlp video payload.
 * @param videoInfo The yt-dlp video metadata.
 * @param sourceUrl Optional source URL to attach for logging.
 * @returns Hints, or undefined when the payload carries nothing useful.
 */
export function buildSearchHints(
  videoInfo: any,
  sourceUrl?: string,
): MediaSearchHints | undefined {
  const title =
    typeof videoInfo?.title === "string" ? videoInfo.title : undefined;
  const uploader =
    typeof videoInfo?.uploader === "string"
      ? videoInfo.uploader
      : typeof videoInfo?.channel === "string"
        ? videoInfo.channel
        : undefined;

  if (!title && !uploader) {
    return undefined;
  }

  const hints: MediaSearchHints = {};
  if (title) {
    hints.title = title;
  }
  if (uploader) {
    hints.uploader = uploader;
  }
  if (sourceUrl) {
    hints.sourceUrl = sourceUrl;
  }

  return hints;
}
