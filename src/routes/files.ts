import { baseDirectory } from "../config/constants.js";
import { createErrorResponse, createJsonResponse } from "../middleware/cors.js";
import { listFilesRecursively } from "../utils/directory.js";

/**
 * Handle GET /files - list all files in the base directory
 */
export async function handleFilesList(_request: Request): Promise<Response> {
  try {
    console.log("Listing files in directory:", baseDirectory);
    const files = await listFilesRecursively(baseDirectory, baseDirectory);

    const sortedFiles = files.sort((a, b) => a.localeCompare(b));

    return createJsonResponse({
      baseDirectory: baseDirectory,
      totalFiles: sortedFiles.length,
      files: sortedFiles,
    });
  } catch (error) {
    console.error("Failed to list files:", error);
    return createErrorResponse(
      "Failed to list files",
      (error as Error).message
    );
  }
}
