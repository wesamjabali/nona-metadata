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
    const tags = metadata?.format?.tags || {};

    // Check common comment fields for the source URL
    const comment = tags.comment || tags.COMMENT || tags.Comment;

    if (comment && typeof comment === "string") {
      // Look for "Source: " prefix followed by a URL
      const sourceMatch = comment.match(/Source:\s*(https?:\/\/\S+)/i);
      if (sourceMatch && sourceMatch[1]) {
        return cleanUrl(sourceMatch[1]);
      }

      // Also check for standalone URLs in comments
      const urlMatch = comment.match(/(https?:\/\/\S+)/i);
      if (urlMatch && urlMatch[1]) {
        return cleanUrl(urlMatch[1]);
      }
    }

    return null;
  } catch (error) {
    console.warn(`Failed to extract source URL from ${filePath}:`, error);
    return null;
  }
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
