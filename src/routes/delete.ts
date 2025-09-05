import { readdir, rmdir, unlink } from "fs/promises";
import { dirname, join, resolve } from "path";
import { baseDirectory } from "../config/constants.js";
import { createErrorResponse, createJsonResponse } from "../middleware/cors.js";

/**
 * Check if a directory is empty
 * @param dirPath The directory path to check
 * @returns True if the directory is empty, false otherwise
 */
async function isDirectoryEmpty(dirPath: string): Promise<boolean> {
  try {
    const entries = await readdir(dirPath);
    return entries.length === 0;
  } catch (error) {
    return false;
  }
}

/**
 * Delete empty directories recursively up to the base directory
 * @param dirPath The directory path to start checking from
 * @param baseDir The base directory to stop at (won't delete this)
 */
async function deleteEmptyDirectoriesRecursively(
  dirPath: string,
  baseDir: string
): Promise<void> {
  const resolvedDirPath = resolve(dirPath);
  const resolvedBaseDir = resolve(baseDir);

  if (
    resolvedDirPath === resolvedBaseDir ||
    !resolvedDirPath.startsWith(resolvedBaseDir)
  ) {
    return;
  }

  try {
    const isEmpty = await isDirectoryEmpty(resolvedDirPath);
    if (isEmpty) {
      console.log(`Deleting empty directory: ${resolvedDirPath}`);
      await rmdir(resolvedDirPath);

      const parentDir = dirname(resolvedDirPath);
      await deleteEmptyDirectoriesRecursively(parentDir, baseDir);
    }
  } catch (error) {
    console.warn(`Failed to delete directory ${resolvedDirPath}:`, error);
  }
}

/**
 * Handle DELETE /files - delete a file and clean up empty directories
 */
export async function handleFileDelete(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    const filePath = url.searchParams.get("file");

    if (!filePath) {
      return createErrorResponse(
        "Missing required parameter: file",
        "The 'file' query parameter is required"
      );
    }

    const absoluteFilePath = resolve(join(baseDirectory, filePath));
    const resolvedBaseDir = resolve(baseDirectory);

    if (!absoluteFilePath.startsWith(resolvedBaseDir)) {
      return createErrorResponse(
        "Invalid file path",
        "File path must be within the base directory",
        403
      );
    }

    try {
      console.log(`Deleting file: ${absoluteFilePath}`);
      await unlink(absoluteFilePath);

      const fileDirectory = dirname(absoluteFilePath);

      await deleteEmptyDirectoriesRecursively(fileDirectory, resolvedBaseDir);

      return createJsonResponse({
        success: true,
        message: "File deleted successfully",
        deletedFile: filePath,
      });
    } catch (error) {
      if ((error as any).code === "ENOENT") {
        return createErrorResponse(
          "File not found",
          `The file '${filePath}' does not exist`,
          404
        );
      }
      throw error;
    }
  } catch (error) {
    console.error("Failed to delete file:", error);
    return createErrorResponse(
      "Failed to delete file",
      (error as Error).message
    );
  }
}
