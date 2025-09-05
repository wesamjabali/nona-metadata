import { getFileMetadata } from "../services/metadata.js";
import { findExistingAlbumFiles } from "./file.js";

/**
 * Extracts the genre from existing files in the same album.
 * @param artist The artist name.
 * @param album The album name.
 * @returns A Promise that resolves with the genre if found, null otherwise.
 */
export async function getExistingAlbumGenre(
  artist: string,
  album: string | null
): Promise<string | null> {
  if (!album) {
    return null;
  }

  try {
    const existingFiles = await findExistingAlbumFiles(artist, album);

    if (existingFiles.length === 0) {
      console.log(
        `Genre check: No existing files found for album "${album}" by "${artist}"`
      );
      return null;
    }

    console.log(
      `Genre check: Found ${existingFiles.length} existing files in album "${album}" by "${artist}"`
    );

    for (const filePath of existingFiles) {
      try {
        const metadata = await getFileMetadata(filePath);
        const tags = metadata?.format?.tags || {};

        const genre = tags.genre || tags.GENRE || tags.Genre;

        if (genre && genre.trim() !== "") {
          console.log(
            `Genre check: Found existing genre "${genre}" in file: ${filePath}`
          );
          return genre.trim();
        }
      } catch (error) {
        console.warn(
          `Genre check: Failed to read metadata from ${filePath}:`,
          error
        );
        continue;
      }
    }

    console.log(
      `Genre check: No genre found in existing files for album "${album}" by "${artist}"`
    );
    return null;
  } catch (error) {
    console.warn(
      `Genre check: Error finding existing album genre for "${album}" by "${artist}":`,
      error
    );
    return null;
  }
}
