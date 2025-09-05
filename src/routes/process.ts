import { createErrorResponse, createJsonResponse } from "../middleware/cors.js";
import { CacheManager } from "../services/cache.js";
import { JobTracker } from "../services/jobTracker.js";
import { processVideo } from "../services/videoProcessor.js";
import { getPlaylistInfo } from "../services/youtube.js";
import type { MetaData, ProcessVideoRequest } from "../types/metadata.js";
import { isPlaylistUrl } from "../utils/file.js";

/**
 * Handle GET /playlist-info - get playlist information without processing
 */
export async function handlePlaylistInfo(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    const playlistUrl = url.searchParams.get("url");

    if (!playlistUrl) {
      return createErrorResponse("URL parameter is required.", undefined, 400);
    }

    const sanitizedUrl = playlistUrl
      .replace("&start_radio=1", "")
      .replace("?start_radio=1", "");

    if (!isPlaylistUrl(sanitizedUrl)) {
      return createJsonResponse({
        isPlaylist: false,
        videoCount: 0,
        message: "URL is not a playlist",
      });
    }

    console.log("Getting playlist info for:", sanitizedUrl);

    try {
      const playlistData = await getPlaylistInfo(sanitizedUrl);
      const entries = playlistData.entries || [];

      return createJsonResponse({
        isPlaylist: true,
        videoCount: entries.length,
        title: playlistData.title || "Unknown Playlist",
        message: `Playlist contains ${entries.length} videos`,
      });
    } catch (playlistError) {
      const errorMessage = (playlistError as Error).message;

      if (errorMessage.includes("timed out")) {
        return createJsonResponse({
          isPlaylist: true,
          videoCount: null,
          title: "Unknown Playlist (Large)",
          message:
            "Playlist info request timed out - this may be a very large playlist",
          warning: "Unable to determine exact size due to timeout",
        });
      }

      return createJsonResponse({
        isPlaylist: true,
        videoCount: null,
        title: "Unknown Playlist",
        message: "Unable to determine playlist size",
        error: errorMessage,
      });
    }
  } catch (error) {
    console.error("Error getting playlist info:", error);
    return createErrorResponse(
      "Failed to get playlist information",
      (error as Error).message,
      500
    );
  }
}

/**
 * Classify error type for better debugging
 */
function getErrorType(errorMessage: string): string {
  const msg = errorMessage.toLowerCase();

  if (
    msg.includes("socket connection was closed") ||
    msg.includes("handshake operation timed out")
  ) {
    return "NETWORK_TIMEOUT";
  }
  if (msg.includes("download failed") || msg.includes("yt-dlp")) {
    return "DOWNLOAD_ERROR";
  }
  if (
    msg.includes("api did not return valid json") ||
    msg.includes("googleGenerativeAI")
  ) {
    return "AI_API_ERROR";
  }
  if (msg.includes("ffmpeg")) {
    return "FFMPEG_ERROR";
  }
  if (msg.includes("failed to get video info")) {
    return "VIDEO_INFO_ERROR";
  }

  return "UNKNOWN_ERROR";
}

/**
 * Process videos in the background
 */
async function processInBackground(
  jobId: string,
  sanitizedUrl: string,
  cache: CacheManager,
  jobTracker: JobTracker
): Promise<void> {
  try {
    if (isPlaylistUrl(sanitizedUrl)) {
      console.log(`[Job ${jobId}] Processing playlist:`, sanitizedUrl);

      const playlistData = await getPlaylistInfo(sanitizedUrl);
      const entries = playlistData.entries || [];

      console.log(
        `[Job ${jobId}] 🔍 DEBUGGING: Playlist data structure:`,
        JSON.stringify(playlistData, null, 2)
      );
      console.log(
        `[Job ${jobId}] 🔍 DEBUGGING: Available properties:`,
        Object.keys(playlistData)
      );
      console.log(
        `[Job ${jobId}] 🔍 DEBUGGING: Title value:`,
        playlistData.title
      );
      console.log(
        `[Job ${jobId}] 🔍 DEBUGGING: Title type:`,
        typeof playlistData.title
      );

      if (playlistData.title) {
        console.log(
          `[Job ${jobId}] ✅ Setting playlist title immediately: "${playlistData.title}"`
        );
        jobTracker.setPlaylistTitle(jobId, playlistData.title);
      } else {
        console.log(`[Job ${jobId}] ❌ No playlist title found in data`);

        console.log(`[Job ${jobId}] 🔍 Checking alternative title fields...`);
        const alternativeTitle =
          playlistData.playlist_title ||
          playlistData.name ||
          playlistData.uploader;
        if (alternativeTitle) {
          console.log(
            `[Job ${jobId}] ✅ Found alternative title: "${alternativeTitle}"`
          );
          jobTracker.setPlaylistTitle(jobId, alternativeTitle);
        }
      }

      if (entries.length === 0) {
        jobTracker.failJob(jobId, ["No videos found in playlist"]);
        return;
      }

      console.log(`[Job ${jobId}] Found ${entries.length} videos in playlist`);
      jobTracker.updateProgress(jobId, {
        total: entries.length,
        completed: 0,
        failed: 0,
      });

      const results: MetaData[] = [];
      const errors: string[] = [];
      const batchSize = 10;

      for (
        let batchStart = 0;
        batchStart < entries.length;
        batchStart += batchSize
      ) {
        const batchEnd = Math.min(batchStart + batchSize, entries.length);
        const batch = entries.slice(batchStart, batchEnd);

        console.log(
          `[Job ${jobId}] Processing batch ${
            Math.floor(batchStart / batchSize) + 1
          }/${Math.ceil(entries.length / batchSize)} (videos ${
            batchStart + 1
          }-${batchEnd})`
        );

        const batchPromises = batch.map(
          async (entry: any, batchIndex: number) => {
            const globalIndex = batchStart + batchIndex;
            const videoUrl = entry.url.startsWith("http")
              ? entry.url
              : `https://www.youtube.com/watch?v=${entry.id}`;

            try {
              console.log(
                `[Job ${jobId}] Processing video ${globalIndex + 1}/${
                  entries.length
                }: ${entry.title}`
              );
              const result = await processVideo(videoUrl, cache, globalIndex);

              if (playlistData.title && !result.album) {
                result.album = playlistData.title;
              }

              return { success: true, result, index: globalIndex };
            } catch (error) {
              const errorMessage = (error as Error).message;
              const errorType = getErrorType(errorMessage);
              const errorMsg = `Failed to process video ${globalIndex + 1} (${
                entry.title
              }) [${errorType}]: ${errorMessage}`;
              console.error(`[Job ${jobId}] ${errorMsg}`);
              return { success: false, error: errorMsg, index: globalIndex };
            }
          }
        );

        const batchResults = await Promise.all(batchPromises);

        for (const batchResult of batchResults) {
          if (batchResult.success) {
            results.push(batchResult.result);
          } else {
            errors.push(batchResult.error);
          }
        }

        jobTracker.updateProgress(jobId, {
          total: entries.length,
          completed: results.length,
          failed: errors.length,
        });

        console.log(
          `[Job ${jobId}] Batch ${
            Math.floor(batchStart / batchSize) + 1
          } complete. ${results.length} successful so far, ${
            errors.length
          } failed so far.`
        );
      }

      console.log(
        `[Job ${jobId}] Playlist processing complete. ${results.length} successful, ${errors.length} failed.`
      );

      if (results.length > 0) {
        jobTracker.completeJob(jobId, results, playlistData.title);
      } else {
        jobTracker.failJob(jobId, errors);
      }
    } else {
      console.log(`[Job ${jobId}] Processing single video:`, sanitizedUrl);

      try {
        const result = await processVideo(sanitizedUrl, cache);
        jobTracker.completeJob(jobId, [result]);
        console.log(`[Job ${jobId}] Single video processing complete`);
      } catch (error) {
        const errorMessage = (error as Error).message;
        const errorType = getErrorType(errorMessage);
        const errorMsg = `Failed to process video [${errorType}]: ${errorMessage}`;
        console.error(`[Job ${jobId}] ${errorMsg}`);
        jobTracker.failJob(jobId, [errorMsg]);
      }
    }
  } catch (error) {
    console.error(`[Job ${jobId}] Unexpected error:`, error);
    jobTracker.failJob(jobId, [
      `Unexpected error: ${(error as Error).message}`,
    ]);
  }
}

/**
 * Handle POST / - start background processing of YouTube URL(s)
 */
export async function handleProcessVideo(
  request: Request,
  cache: CacheManager,
  jobTracker: JobTracker
): Promise<Response> {
  try {
    const { prompt: url } = (await request.json()) as ProcessVideoRequest;
    if (!url) {
      return createErrorResponse(
        "A 'prompt' with the URL is required.",
        undefined,
        400
      );
    }

    const sanitizedUrl = url
      .replace("&start_radio=1", "")
      .replace("?start_radio=1", "");

    const jobType = isPlaylistUrl(sanitizedUrl) ? "playlist" : "single";

    const jobId = jobTracker.createJob(sanitizedUrl, jobType);

    processInBackground(jobId, sanitizedUrl, cache, jobTracker).catch(
      (error) => {
        console.error(`Background processing failed for job ${jobId}:`, error);
        jobTracker.failJob(jobId, [
          `Background processing error: ${error.message}`,
        ]);
      }
    );

    return createJsonResponse({
      message: "Processing started",
      jobId,
      type: jobType,
      url: sanitizedUrl,
      statusUrl: `/jobs/${jobId}`,
      note: "Use the statusUrl to check processing progress",
    });
  } catch (error) {
    console.error("Server error:", error);
    return createErrorResponse("An internal server error occurred.");
  }
}
