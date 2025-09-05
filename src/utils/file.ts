import { promises as fs } from "fs";
import { mkdir } from "fs/promises";
import { join } from "path";
import { baseDirectory, pathNormalization } from "../config/constants.js";
import {
  findExistingAlbumFolder,
  findExistingArtistFolder,
} from "./caseInsensitiveMatching.js";

/**
 * Clean up orphaned temporary files on startup
 */
export async function cleanupOrphanedTempFiles(): Promise<void> {
  try {
    const files = await fs.readdir(baseDirectory);
    const tempFiles = files.filter(
      (file) =>
        file.startsWith("temp_") &&
        (file.endsWith(".m4a") || file.includes("_ffmpeg_temp"))
    );

    if (tempFiles.length > 0) {
      console.log(
        `Found ${tempFiles.length} orphaned temporary files, cleaning up...`
      );

      for (const tempFile of tempFiles) {
        try {
          await fs.unlink(join(baseDirectory, tempFile));
          console.log(`Cleaned up orphaned file: ${tempFile}`);
        } catch (error) {
          console.warn(`Failed to cleanup orphaned file ${tempFile}:`, error);
        }
      }

      console.log(
        `✅ Cleanup complete: removed ${tempFiles.length} orphaned temporary files`
      );
    }
  } catch (error) {
    if ((error as any).code !== "ENOENT") {
      console.warn("Failed to cleanup orphaned temporary files:", error);
    }
  }
}

/**
 * Sanitizes a string to be safe for use as a directory/file name.
 * @param name The string to sanitize.
 * @returns A sanitized string safe for filesystem use.
 */
export function sanitizeFileName(name: string): string {
  return name
    .replace(pathNormalization.unsafeCharsRegex, "")
    .replace(pathNormalization.whitespaceRegex, " ")
    .trim()
    .slice(0, pathNormalization.maxFilenameLength);
}

/**
 * Safely removes file extension from a path, only if the path actually ends with an extension.
 * @param path The file path to process.
 * @returns The path without extension if it had one, otherwise the original path.
 */
export function removeFileExtension(path: string): string {
  const pathParts = path.split("/");
  const fileName = pathParts[pathParts.length - 1] || "";
  const hasExtension = pathNormalization.fileExtensionRegex.test(fileName);

  return hasExtension
    ? path.replace(pathNormalization.removeExtensionRegex, "")
    : path;
}

/**
 * Normalizes a title for fuzzy matching by removing non-word characters and extra whitespace.
 * @param title The title to normalize.
 * @returns A normalized title for comparison.
 */
export function normalizeForMatching(title: string): string {
  return title
    .toLowerCase()
    .replace(pathNormalization.nonWordCharsRegex, " ")
    .replace(pathNormalization.whitespaceRegex, " ")
    .trim();
}

/**
 * Ensures a directory exists, creating it if necessary.
 * @param dirPath The directory path to ensure exists.
 * @returns A Promise that resolves when the directory exists.
 */
export async function ensureDirectory(dirPath: string): Promise<void> {
  try {
    await mkdir(dirPath, { recursive: true });
  } catch (error) {
    if ((error as any).code !== "EEXIST") {
      throw error;
    }
  }
}

/**
 * Generates the organized file path for a song.
 * @param artist The artist name.
 * @param album The album name (or null).
 * @param title The song title.
 * @returns The full file path where the song should be stored.
 */
export function getOrganizedFilePath(
  artist: string,
  album: string | null,
  title: string
): string {
  const sanitizedArtist = sanitizeFileName(artist) || "Unknown Artist";
  const sanitizedTitle = sanitizeFileName(title) || "Unknown Title";
  const sanitizedAlbum = album ? sanitizeFileName(album) : "Unknown Album";

  return join(
    baseDirectory,
    sanitizedArtist,
    sanitizedAlbum,
    `${sanitizedTitle}.m4a`
  );
}

/**
 * Generates the album art file path for an artist/album combination using case-insensitive matching.
 * @param artist The artist name.
 * @param album The album name (or null).
 * @returns The base file path where the album art should be stored (without extension), or null if no album.
 */
export async function getAlbumArtPath(
  artist: string,
  album: string | null
): Promise<string | null> {
  if (album === null || album === "" || album === "Unknown Album") {
    return null;
  }

  const actualArtist = await findExistingArtistFolder(artist);
  const actualAlbum = await findExistingAlbumFolder(actualArtist, album);

  const basePath = join(baseDirectory, actualArtist, actualAlbum, "cover");

  console.log(`Album art base path: ${basePath}`);

  return basePath;
}

/**
 * Checks if album art exists for a given base path and returns the actual file path.
 * @param basePath The base path without extension.
 * @returns The actual file path if found, null otherwise.
 */
export async function findExistingAlbumArt(
  basePath: string
): Promise<string | null> {
  const possibleExtensions = [".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp"];

  for (const ext of possibleExtensions) {
    const testPath = basePath + ext;
    try {
      await fs.access(testPath);
      return testPath;
    } catch {
      continue;
    }
  }

  return null;
}

/**
 * Checks if a URL is a playlist URL.
 * @param url The URL to check.
 * @returns True if the URL contains playlist indicators.
 */
export function isPlaylistUrl(url: string): boolean {
  return url.includes("list=") || url.includes("playlist");
}

/**
 * Gets the album directory path for an artist and album combination using case-insensitive matching.
 * @param artist The artist name.
 * @param album The album name.
 * @returns The directory path where the album's files should be stored.
 */
export async function getAlbumDirectoryPath(
  artist: string,
  album: string
): Promise<string> {
  const actualArtist = await findExistingArtistFolder(artist);
  const actualAlbum = await findExistingAlbumFolder(actualArtist, album);

  return join(baseDirectory, actualArtist, actualAlbum);
}

/**
 * Finds existing music files in the same album directory using case-insensitive matching.
 * @param artist The artist name.
 * @param album The album name.
 * @returns A Promise that resolves with an array of existing music file paths in the album directory.
 */
export async function findExistingAlbumFiles(
  artist: string,
  album: string | null
): Promise<string[]> {
  if (!album) {
    return [];
  }

  const albumDir = await getAlbumDirectoryPath(artist, album);

  try {
    const entries = await fs.readdir(albumDir);

    const musicFiles = entries.filter(
      (file) =>
        file.endsWith(".m4a") ||
        file.endsWith(".mp3") ||
        file.endsWith(".flac") ||
        file.endsWith(".wav")
    );

    return musicFiles.map((file) => join(albumDir, file));
  } catch (error) {
    return [];
  }
}
