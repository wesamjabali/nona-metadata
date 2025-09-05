import { readdir, rename, rmdir, stat } from "fs/promises";
import { dirname, join, relative, resolve } from "path";
import { baseDirectory } from "../config/constants.js";
import { ensureDirectory } from "./file.js";

/**
 * Recursively lists all files in a directory and returns their paths.
 * @param dirPath The directory path to scan.
 * @param relativeTo Optional base path to make paths relative to.
 * @returns A Promise that resolves with an array of file paths.
 */
export async function listFilesRecursively(
  dirPath: string,
  relativeTo?: string
): Promise<string[]> {
  const files: string[] = [];

  try {
    const entries = await readdir(dirPath);

    for (const entry of entries) {
      const fullPath = join(dirPath, entry);
      const stats = await stat(fullPath);

      if (stats.isDirectory()) {
        const subFiles = await listFilesRecursively(fullPath, relativeTo);
        files.push(...subFiles);
      } else if (stats.isFile()) {
        let filePath: string;
        if (relativeTo) {
          const resolvedFullPath = resolve(fullPath);
          const resolvedRelativeTo = resolve(relativeTo);
          filePath = relative(resolvedRelativeTo, resolvedFullPath);
        } else {
          filePath = fullPath;
        }
        files.push(filePath);
      }
    }
  } catch (error) {
    console.warn(`Failed to list files in ${dirPath}:`, error);
  }

  return files;
}

/**
 * Checks if a directory is empty.
 * @param dirPath The directory path to check.
 * @returns A Promise that resolves with true if the directory is empty.
 */
export async function isDirectoryEmpty(dirPath: string): Promise<boolean> {
  try {
    const entries = await readdir(dirPath);
    return entries.length === 0;
  } catch (error) {
    return false;
  }
}

/**
 * Removes an empty directory and recursively removes empty parent directories up to the base directory.
 * @param dirPath The directory path to remove.
 * @returns A Promise that resolves when the cleanup is complete.
 */
export async function cleanupEmptyDirectories(dirPath: string): Promise<void> {
  try {
    if (dirPath === baseDirectory) {
      return;
    }

    const isEmpty = await isDirectoryEmpty(dirPath);
    if (!isEmpty) {
      return;
    }

    await rmdir(dirPath);
    console.log(`Removed empty directory: ${dirPath}`);

    const parentDir = dirname(dirPath);
    if (parentDir !== baseDirectory && parentDir !== dirPath) {
      await cleanupEmptyDirectories(parentDir);
    }
  } catch (error) {
    console.warn(`Failed to cleanup directory ${dirPath}:`, error);
  }
}

/**
 * Moves a file to a new directory structure based on artist and album metadata.
 * @param currentPath The current file path.
 * @param newArtist The new artist name.
 * @param newAlbum The new album name (or null/empty).
 * @param filename The filename to preserve.
 * @returns A Promise that resolves with the new file path.
 */
export async function moveFileToNewStructure(
  currentPath: string,
  newArtist: string | null | undefined,
  newAlbum: string | null | undefined,
  filename: string
): Promise<string> {
  const sanitizedArtist =
    newArtist && newArtist.trim()
      ? newArtist.replace(/[<>:"/\\|?*]/g, "").trim()
      : "Unknown Artist";

  const sanitizedAlbum =
    newAlbum && newAlbum.trim()
      ? newAlbum.replace(/[<>:"/\\|?*]/g, "").trim()
      : "Unknown Album";

  let newDir: string;
  newDir = join(baseDirectory, sanitizedArtist, sanitizedAlbum);

  const newPath = join(newDir, filename);

  if (currentPath === newPath) {
    return currentPath;
  }

  await ensureDirectory(newDir);

  await rename(currentPath, newPath);
  console.log(`Moved file from ${currentPath} to ${newPath}`);

  const oldDir = dirname(currentPath);
  await cleanupEmptyDirectories(oldDir);

  return newPath;
}
