/**
 * YouTube URL helpers.
 *
 * A video's thumbnail lives at a fully deterministic URL built from its
 * 11-character video ID, so artwork can be offered *without* asking yt-dlp.
 * That matters because yt-dlp is the fragile part of the pipeline: it fails on
 * removed/private/age-restricted videos, when the extractor breaks, and when
 * YouTube rate-limits the host.
 */

/** YouTube video IDs are always 11 URL-safe base64 characters. */
const VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;

/** Hosts (after stripping `www.`/`m.`) that serve YouTube videos. */
const YOUTUBE_HOSTS = new Set([
  "youtube.com",
  "music.youtube.com",
  "youtube-nocookie.com",
  "youtu.be",
]);

/** Path prefixes followed by the video ID (`youtu.be/<id>` has no prefix). */
const ID_PATH_PREFIXES = new Set(["shorts", "embed", "live", "v"]);

/**
 * 11-character strings that follow a path prefix but are not video IDs.
 * `/embed/videoseries?list=...` embeds a whole playlist.
 */
const NON_VIDEO_IDS = new Set(["videoseries"]);

/**
 * Extracts the video ID from a YouTube URL.
 *
 * Handles every shape yt-dlp accepts: `watch?v=<id>`, `youtu.be/<id>`,
 * `/shorts/<id>`, `/embed/<id>`, `/live/<id>`, `/v/<id>` and YouTube Music.
 * Extra query parameters (`list`, `index`, `start_radio`, ...) are ignored, so
 * a stored `Source:` comment like
 * `https://www.youtube.com/watch?v=YzLEbVnywh0&index=30` resolves correctly.
 * @param url The URL to inspect.
 * @returns The video ID, or null when the URL is not a YouTube video URL.
 */
export function extractYouTubeVideoId(
  url: string | null | undefined,
): string | null {
  if (!url || typeof url !== "string") {
    return null;
  }

  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return null;
  }

  const host = parsed.hostname.toLowerCase().replace(/^(?:www|m)\./, "");
  if (!YOUTUBE_HOSTS.has(host)) {
    return null;
  }

  const fromQuery = parsed.searchParams.get("v");
  if (fromQuery && VIDEO_ID_PATTERN.test(fromQuery)) {
    return fromQuery;
  }

  const segments = parsed.pathname.split("/").filter(Boolean);

  // Short links are `youtu.be/<id>`; every other host puts the ID behind a
  // known path prefix (e.g. `/shorts/<id>`). `/embed/videoseries?list=...`
  // carries no ID, and is rejected by the ID pattern below.
  const candidate =
    host === "youtu.be"
      ? segments[0]
      : segments[0] && ID_PATH_PREFIXES.has(segments[0])
        ? segments[1]
        : undefined;

  return candidate &&
    VIDEO_ID_PATTERN.test(candidate) &&
    !NON_VIDEO_IDS.has(candidate)
    ? candidate
    : null;
}

/**
 * Thumbnail variants for a video ID, highest resolution first.
 * `maxresdefault` is not published for every upload and `sddefault` is missing
 * on some older ones, so callers must be ready to try the next variant.
 */
const THUMBNAIL_VARIANTS = ["maxresdefault", "sddefault", "hqdefault"] as const;

/**
 * Builds the candidate thumbnail URLs for a YouTube video ID.
 * @param videoId The video ID (usually from {@link extractYouTubeVideoId}).
 * @returns Thumbnail URLs, highest resolution first, or an empty array when the
 * ID is missing/malformed.
 */
export function buildYouTubeThumbnailUrls(
  videoId: string | null | undefined,
): string[] {
  if (!videoId || !VIDEO_ID_PATTERN.test(videoId)) {
    return [];
  }

  return THUMBNAIL_VARIANTS.map(
    (variant) => `https://i.ytimg.com/vi/${videoId}/${variant}.jpg`,
  );
}

/**
 * Builds thumbnail candidates straight from a stored source URL.
 * @param sourceUrl The track's source URL, if any.
 * @returns Thumbnail URLs, or an empty array when the source is not YouTube.
 */
export function buildYouTubeThumbnailUrlsFromSourceUrl(
  sourceUrl: string | null | undefined,
): string[] {
  return buildYouTubeThumbnailUrls(extractYouTubeVideoId(sourceUrl));
}
