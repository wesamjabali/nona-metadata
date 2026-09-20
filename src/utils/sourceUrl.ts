import { getFileMetadata } from "../services/metadata.js";

/**
 * Extracts the source URL from a file's metadata comment field.
 * Supports any URL (YouTube, SoundCloud, Bandcamp, direct media, etc.).
 * @param filePath The path to the audio file
 * @returns The source URL if found, null otherwise
 */
export async function extractSourceUrl(
  filePath: string,
): Promise<string | null> {
  try {
    const metadata = await getFileMetadata(filePath);
    return extractSourceUrlFromTags(metadata?.format?.tags);
  } catch (error) {
    console.warn(`Failed to extract source URL from ${filePath}:`, error);
    return null;
  }
}

/**
 * Extracts the source URL from ffprobe tags.
 *
 * Callers that already probed the file (the backfill scripts do, for the
 * artist/album tags) can use this instead of {@link extractSourceUrl} to avoid
 * running ffprobe twice per track.
 * @param tags The ffprobe `format.tags` object, if any.
 * @returns The source URL if found, null otherwise
 */
export function extractSourceUrlFromTags(
  tags: Record<string, unknown> | null | undefined,
): string | null {
  const comment = tags?.comment ?? tags?.COMMENT ?? tags?.Comment;
  return extractSourceUrlFromComment(
    typeof comment === "string" ? comment : null,
  );
}

/**
 * Extracts the source URL from a comment tag value.
 *
 * Processed tracks store `comment=Source: <url>`, but files tagged by hand or
 * by other tools often carry a bare URL, so both shapes are accepted.
 * @param comment The comment tag value, if any.
 * @returns The source URL if found, null otherwise
 */
export function extractSourceUrlFromComment(
  comment: string | null | undefined,
): string | null {
  if (!comment || typeof comment !== "string") {
    return null;
  }

  // Look for "Source: " prefix followed by a URL
  const sourceMatch = comment.match(/Source:\s*(https?:\/\/\S+)/i);
  if (sourceMatch?.[1]) {
    return cleanUrl(sourceMatch[1]);
  }

  // Also check for standalone URLs in comments
  const urlMatch = comment.match(/(https?:\/\/\S+)/i);
  return urlMatch?.[1] ? cleanUrl(urlMatch[1]) : null;
}

/**
 * Trims trailing punctuation that may have been captured along with a URL.
 * @param url The URL to clean.
 * @returns The cleaned URL.
 */
function cleanUrl(url: string): string {
  return url.replace(/[),.;\]}]+$/, "");
}

/**
 * Checks if a comment field contains a source URL pattern
 * @param comment The comment string to check
 * @returns True if it contains a source URL pattern
 */
export function hasSourceUrlPattern(comment: string): boolean {
  if (!comment || typeof comment !== "string") {
    return false;
  }

  return /Source:\s*https?:\/\/\S+/i.test(comment);
}
