import { promises as fs } from "fs";
import { extname, join } from "path";
import { baseDirectory } from "../config/constants.js";
import { corsHeaders, createErrorResponse } from "../middleware/cors.js";
import { sanitizeFileName } from "../utils/file.js";

/**
 * Get MIME type based on file extension
 */
function getMimeType(filePath: string): string {
  const ext = extname(filePath).toLowerCase();
  switch (ext) {
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".png":
      return "image/png";
    case ".gif":
      return "image/gif";
    case ".webp":
      return "image/webp";
    case ".bmp":
      return "image/bmp";
    case ".svg":
      return "image/svg+xml";
    default:
      return "image/jpeg";
  }
}

/**
 * Handle GET /:artist/:album - serve album art file
 */
export async function handleServeAlbumArt(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    const pathParts = url.pathname.split("/").filter((part) => part !== "");

    const [_path, artistParam, albumParam, filenameParam] = pathParts;

    if (!artistParam || !albumParam) {
      return createErrorResponse(
        "Both artist and album must be provided in the URL path",
        undefined,
        400
      );
    }

    const artist = decodeURIComponent(artistParam);
    const album = decodeURIComponent(albumParam);
    const filename = decodeURIComponent(filenameParam || "cover");

    console.log(`Serving album art for: ${artist} - ${album}`);
    if (!artist || !album) {
      return createErrorResponse(
        "Both artist and album must be provided",
        undefined,
        400
      );
    }

    const sanitizedArtist = sanitizeFileName(artist) || "Unknown Artist";
    const sanitizedAlbum = sanitizeFileName(album);
    let sanitizedFilename = sanitizeFileName(filename);

    const possibleExtensions = [
      ".jpg",
      ".jpeg",
      ".png",
      ".gif",
      ".webp",
      ".bmp",
    ];
    let foundFile = false;
    let finalFilename = sanitizedFilename;

    if (sanitizedFilename === "cover") {
      for (const ext of possibleExtensions) {
        const albumArtPath = join(
          baseDirectory,
          sanitizedArtist,
          sanitizedAlbum,
          `cover${ext}`
        );
        if (
          await fs
            .access(albumArtPath)
            .then(() => true)
            .catch(() => false)
        ) {
          foundFile = true;
          finalFilename = `cover${ext}`;
          sanitizedFilename = sanitizeFileName(finalFilename);
          break;
        }
      }
    }

    const albumArtPath = join(
      baseDirectory,
      sanitizedArtist,
      sanitizedAlbum,
      sanitizedFilename
    );

    if (!albumArtPath) {
      return createErrorResponse(
        "Album art not found",
        `No album art found for "${album}" by "${artist}"`,
        404
      );
    }

    console.log(`Attempting to serve album art from: ${albumArtPath}`);

    try {
      const file = Bun.file(albumArtPath);

      if (!(await file.exists())) {
        return createErrorResponse(
          "Album art not found",
          `No album art found for "${album}" by "${artist}"`,
          404
        );
      }

      const stats = await fs.stat(albumArtPath);
      const mimeType = getMimeType(albumArtPath);

      console.log(
        `Serving album art: ${albumArtPath} with MIME type: ${mimeType}`
      );
      console.log(`File size: ${stats.size} bytes`);
      console.log(`File last modified: ${stats.mtime.toUTCString()}`);

      const responseHeaders = {
        "Content-Type": mimeType,
        "Content-Length": stats.size.toString(),
        "Cache-Control": "public, max-age=86400",
        "Last-Modified": stats.mtime.toUTCString(),
        "Accept-Ranges": "bytes",
        ...corsHeaders,
      };

      console.log(
        "Response headers:",
        JSON.stringify(responseHeaders, null, 2)
      );

      return new Response(file, {
        status: 200,
        headers: responseHeaders,
      });
    } catch (fileError) {
      console.error(
        `Failed to read album art file: ${albumArtPath}`,
        fileError
      );
      return createErrorResponse(
        "Album art not found",
        `No album art found for "${album}" by "${artist}"`,
        404
      );
    }
  } catch (error) {
    console.error("Error serving album art:", error);
    return createErrorResponse(
      "Failed to serve album art",
      (error as Error).message
    );
  }
}
