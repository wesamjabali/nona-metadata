import { promises as fs } from "fs";
import { join, resolve, sep } from "path";
import { baseDirectory } from "../config/constants.js";
import {
  corsHeaders,
  createErrorResponse,
  createJsonResponse,
} from "../middleware/cors.js";
import { fetchLyricsForExistingFiles } from "../scripts/fetchLyricsForExisting.js";
import { JobTracker } from "../services/jobTracker.js";
import { getCaseMatchedOrganizedPath } from "../utils/caseInsensitiveMatching.js";
import { getLyricsFilePath } from "../utils/file.js";

/**
 * Handle POST /fetch-lyrics - Fetch lyrics for every existing music file that
 * is missing an `.lrc` sidecar.
 */
export async function handleFetchLyrics(
  request: Request,
  jobTracker: JobTracker,
): Promise<Response> {
  try {
    console.log("🎤 Starting lyrics fetch process for existing files...");

    const jobId = jobTracker.createJob("lyrics");

    fetchLyricsForExistingFiles(jobTracker, jobId)
      .then((results) => {
        jobTracker.completeJob(jobId, results);
        console.log("✅ Lyrics fetch process completed successfully");
      })
      .catch((error) => {
        console.error("❌ Lyrics fetch process failed:", error);
        jobTracker.failJob(jobId, [error.message]);
      });

    return createJsonResponse({
      message: "Started fetching lyrics for existing files",
      status: "processing",
      jobId: jobId,
      statusUrl: `/jobs/${jobId}`,
      note: "Use the statusUrl to check processing progress",
    });
  } catch (error) {
    console.error("Failed to start lyrics fetch process:", error);
    return createErrorResponse(
      "Failed to start lyrics fetch process",
      (error as Error).message,
    );
  }
}

/**
 * Handle GET /lyrics - serve the `.lrc` sidecar for a track as plain text.
 *
 * The track can be addressed either by its stored file path
 * (`?file=Artist/Album/Song.m4a`) or by its identity
 * (`?artist=...&title=...&album=...`), which is resolved with the same
 * case-insensitive matching used by the rest of the app.
 */
export async function handleServeLyrics(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    const filePath = url.searchParams.get("file");
    const artist = url.searchParams.get("artist");
    const title = url.searchParams.get("title");
    const album = url.searchParams.get("album");

    let absoluteAudioPath: string;

    if (filePath) {
      absoluteAudioPath = resolve(join(baseDirectory, filePath));
    } else if (artist && title) {
      const matched = await getCaseMatchedOrganizedPath(
        artist,
        album || "Unknown Album",
        title,
      );
      absoluteAudioPath = matched.filePath;
    } else {
      return createErrorResponse(
        "Missing track identifier. Usage: /lyrics?file=path/to/file.m4a or /lyrics?artist=...&title=...&album=...",
        undefined,
        400,
      );
    }

    const lyricsPath = absoluteAudioPath.toLowerCase().endsWith(".lrc")
      ? absoluteAudioPath
      : getLyricsFilePath(absoluteAudioPath);

    // Keep requests confined to the music library.
    const resolvedBase = resolve(baseDirectory);
    if (!lyricsPath.startsWith(resolvedBase + sep)) {
      return createErrorResponse("Invalid file path", undefined, 400);
    }

    let content: string;
    try {
      content = await fs.readFile(lyricsPath, "utf8");
    } catch {
      return createErrorResponse(
        "Lyrics not found",
        `No lyrics file found for "${title || filePath}"`,
        404,
      );
    }

    return new Response(content, {
      status: 200,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "public, max-age=3600",
        ...corsHeaders,
      },
    });
  } catch (error) {
    console.error("Error serving lyrics:", error);
    return createErrorResponse(
      "Failed to serve lyrics",
      (error as Error).message,
    );
  }
}
