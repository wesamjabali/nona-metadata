import { getFileMetadata } from "../services/metadata.js";

/**
 * Extracts the source YouTube URL from a file's metadata comment field
 * @param filePath The path to the audio file
 * @returns The source URL if found, null otherwise
 */
export async function extractSourceUrl(
  filePath: string
): Promise<string | null> {
  try {
    const metadata = await getFileMetadata(filePath);
    const tags = metadata?.format?.tags || {};

    // Check common comment fields for the source URL
    const comment = tags.comment || tags.COMMENT || tags.Comment;

    if (comment && typeof comment === "string") {
      // Look for "Source: " prefix followed by a YouTube URL
      const sourceMatch = comment.match(
        /Source:\s*(https?:\/\/(?:www\.)?youtube\.com\/watch\?v=[\w-]+)/i
      );
      if (sourceMatch && sourceMatch[1]) {
        return sourceMatch[1];
      }

      // Also check for standalone YouTube URLs in comments
      const urlMatch = comment.match(
        /(https?:\/\/(?:www\.)?youtube\.com\/watch\?v=[\w-]+)/i
      );
      if (urlMatch && urlMatch[1]) {
        return urlMatch[1];
      }
    }

    return null;
  } catch (error) {
    console.warn(`Failed to extract source URL from ${filePath}:`, error);
    return null;
  }
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

  return /Source:\s*https?:\/\/(?:www\.)?youtube\.com\/watch\?v=[\w-]+/i.test(
    comment
  );
}
