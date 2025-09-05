import { promises as fs } from "fs";
import { join } from "path";
import { baseDirectory } from "../config/constants.js";
import { sanitizeFileName } from "./file.js";

/**
 * Finds an existing artist folder that matches case-insensitively.
 * @param artist The artist name to search for.
 * @returns The actual folder name if found, or the sanitized artist name if not found.
 */
export async function findExistingArtistFolder(
  artist: string
): Promise<string> {
  const sanitizedArtist = sanitizeFileName(artist) || "Unknown Artist";

  try {
    const entries = await fs.readdir(baseDirectory, { withFileTypes: true });
    const folders = entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);

    // First try exact match
    const exactMatch = folders.find((folder) => folder === sanitizedArtist);
    if (exactMatch) {
      return exactMatch;
    }

    // Then try case-insensitive match
    const caseInsensitiveMatch = folders.find(
      (folder) => folder.toLowerCase() === sanitizedArtist.toLowerCase()
    );

    if (caseInsensitiveMatch) {
      console.log(
        `Case-insensitive artist match: "${sanitizedArtist}" -> "${caseInsensitiveMatch}"`
      );
      return caseInsensitiveMatch;
    }

    // No match found, return sanitized artist name for new folder
    return sanitizedArtist;
  } catch (error) {
    console.warn(`Error reading base directory for artist matching:`, error);
    return sanitizedArtist;
  }
}

/**
 * Finds an existing album folder that matches case-insensitively within an artist folder.
 * @param existingArtistFolder The actual artist folder name.
 * @param album The album name to search for.
 * @returns The actual album folder name if found, or the sanitized album name if not found.
 */
export async function findExistingAlbumFolder(
  existingArtistFolder: string,
  album: string | null
): Promise<string> {
  if (!album) {
    return "Unknown Album";
  }

  const sanitizedAlbum = sanitizeFileName(album);
  const artistPath = join(baseDirectory, existingArtistFolder);

  try {
    const entries = await fs.readdir(artistPath, { withFileTypes: true });
    const folders = entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);

    // First try exact match
    const exactMatch = folders.find((folder) => folder === sanitizedAlbum);
    if (exactMatch) {
      return exactMatch;
    }

    // Then try case-insensitive match
    const caseInsensitiveMatch = folders.find(
      (folder) => folder.toLowerCase() === sanitizedAlbum.toLowerCase()
    );

    if (caseInsensitiveMatch) {
      console.log(
        `Case-insensitive album match: "${sanitizedAlbum}" -> "${caseInsensitiveMatch}"`
      );
      return caseInsensitiveMatch;
    }

    // No match found, return sanitized album name for new folder
    return sanitizedAlbum;
  } catch (error) {
    // Artist folder doesn't exist yet, return sanitized album name
    return sanitizedAlbum;
  }
}

/**
 * Gets the case-matched organized file path for a song, using existing folders when available.
 * @param artist The artist name.
 * @param album The album name (or null).
 * @param title The song title.
 * @returns An object with the file path and the actual artist/album names used.
 */
export async function getCaseMatchedOrganizedPath(
  artist: string,
  album: string | null,
  title: string
): Promise<{
  filePath: string;
  actualArtist: string;
  actualAlbum: string;
}> {
  const sanitizedTitle = sanitizeFileName(title) || "Unknown Title";

  const actualArtist = await findExistingArtistFolder(artist);
  const actualAlbum = await findExistingAlbumFolder(actualArtist, album);

  const filePath = join(
    baseDirectory,
    actualArtist,
    actualAlbum,
    `${sanitizedTitle}.m4a`
  );

  return {
    filePath,
    actualArtist,
    actualAlbum,
  };
}
