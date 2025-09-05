import { stat } from "fs/promises";
import { basename, extname, join, resolve } from "path";
import { baseDirectory } from "../config/constants.js";
import { createErrorResponse, createJsonResponse } from "../middleware/cors.js";
import { getFileMetadata, updateFileMetadata } from "../services/metadata.js";
import type { MetadataRequest } from "../types/metadata.js";
import { moveFileToNewStructure } from "../utils/directory.js";

/**
 * Handle GET /metadata - get metadata for a specific file
 */
export async function handleGetMetadata(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const filePath = url.searchParams.get("file");

  if (!filePath) {
    return createErrorResponse(
      "Missing 'file' query parameter. Usage: /metadata?file=path/to/file.m4a",
      undefined,
      400
    );
  }

  const absoluteFilePath = resolve(join(baseDirectory, filePath));

  try {
    console.log("Getting metadata for file:", absoluteFilePath);

    try {
      await stat(absoluteFilePath);
    } catch (statError) {
      return createErrorResponse("File not found", undefined, 404);
    }

    const metadata = await getFileMetadata(absoluteFilePath);
    const tags = metadata?.format?.tags || {};

    return createJsonResponse({
      filePath: filePath,
      tags,
    });
  } catch (error) {
    console.error("Failed to get file metadata:", error);
    return createErrorResponse(
      "Failed to get file metadata",
      (error as Error).message
    );
  }
}

/**
 * Handle PATCH /metadata - update metadata for a specific file
 */
export async function handleUpdateMetadata(
  request: Request
): Promise<Response> {
  try {
    const requestBody = (await request.json()) as MetadataRequest;
    const { file: filePath, tags } = requestBody;

    if (!filePath) {
      return createErrorResponse(
        "Missing 'file' field in request body. Usage: PATCH /metadata with body { file: 'path/to/file.m4a', tags: { ... } }",
        undefined,
        400
      );
    }

    if (!tags || typeof tags !== "object") {
      return createErrorResponse(
        "Missing or invalid 'tags' field in request body. Tags should be an object with key-value pairs.",
        undefined,
        400
      );
    }

    const absoluteFilePath = resolve(join(baseDirectory, filePath));

    console.log("Updating metadata for file:", absoluteFilePath);
    console.log("New tags:", tags);

    try {
      await stat(absoluteFilePath);
    } catch (statError) {
      return createErrorResponse("File not found", undefined, 404);
    }

    const currentMetadata = await getFileMetadata(absoluteFilePath);
    const currentTags = currentMetadata?.format?.tags || {};

    const currentArtist = currentTags.artist || currentTags.ARTIST;
    const currentAlbum = currentTags.album || currentTags.ALBUM;
    const currentTitle = currentTags.title || currentTags.TITLE;

    const newArtist = tags.artist || tags.ARTIST;
    const newAlbum = tags.album || tags.ALBUM;
    const newTitle = tags.title || tags.TITLE;

    await updateFileMetadata(absoluteFilePath, tags);

    let finalAbsoluteFilePath = absoluteFilePath;

    if (
      (newArtist !== undefined && newArtist !== currentArtist) ||
      (newAlbum !== undefined && newAlbum !== currentAlbum) ||
      (newTitle !== undefined && newTitle !== currentTitle)
    ) {
      const currentExtension = extname(absoluteFilePath);
      const currentBasename = basename(absoluteFilePath, currentExtension);

      let newFilename: string;
      if (newTitle !== undefined) {
        const sanitizedTitle =
          newTitle && newTitle.trim()
            ? newTitle.replace(/[<>:"/\\|?*]/g, "").trim()
            : "Unknown Title";
        newFilename = `${sanitizedTitle}${currentExtension}`;
      } else {
        newFilename = basename(absoluteFilePath);
      }

      const artistToUse =
        newArtist !== currentArtist ? newArtist : currentArtist;
      const albumToUse = newAlbum !== currentAlbum ? newAlbum : currentAlbum;

      const finalAlbumToUse = albumToUse || "Unknown Album";

      console.log(
        `Moving file due to metadata change - Artist: ${currentArtist} -> ${artistToUse}, Album: ${currentAlbum} -> ${finalAlbumToUse}, Title: ${currentTitle} -> ${
          newTitle !== currentTitle ? newTitle : currentTitle
        }`
      );

      try {
        finalAbsoluteFilePath = await moveFileToNewStructure(
          absoluteFilePath,
          artistToUse,
          finalAlbumToUse,
          newFilename
        );
      } catch (moveError) {
        console.error("Failed to move file to new structure:", moveError);
      }
    }

    const finalRelativePath = finalAbsoluteFilePath.replace(
      baseDirectory + "/",
      ""
    );

    const updatedMetadata = await getFileMetadata(finalAbsoluteFilePath);
    const updatedTags = updatedMetadata?.format?.tags || {};

    const originalRelativePath = absoluteFilePath.replace(
      baseDirectory + "/",
      ""
    );

    return createJsonResponse({
      success: true,
      filePath: finalRelativePath,
      updatedTags: updatedTags,
      message: "File metadata updated successfully",
      ...(finalRelativePath !== filePath && {
        movedFrom: originalRelativePath,
      }),
    });
  } catch (error) {
    console.error("Failed to update file metadata:", error);
    return createErrorResponse(
      "Failed to update file metadata",
      (error as Error).message
    );
  }
}
