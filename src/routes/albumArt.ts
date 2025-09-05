import { createErrorResponse, createJsonResponse } from "../middleware/cors.js";
import { fetchAlbumArtForExistingFiles } from "../scripts/fetchAlbumArtForExisting.js";
import { JobTracker } from "../services/jobTracker.js";

/**
 * Handle POST /fetch-album-art - Process all existing files to fetch missing album art
 */
export async function handleFetchAlbumArt(
  request: Request,
  jobTracker: JobTracker
): Promise<Response> {
  try {
    console.log("🎵 Starting album art fetch process for existing files...");

    const jobId = jobTracker.createJob("album-art");

    fetchAlbumArtForExistingFiles(jobTracker, jobId)
      .then((results) => {
        jobTracker.completeJob(jobId, results);
        console.log("✅ Album art fetch process completed successfully");
      })
      .catch((error) => {
        console.error("❌ Album art fetch process failed:", error);
        jobTracker.failJob(jobId, [error.message]);
      });

    return createJsonResponse({
      message: "Started fetching album art for existing files",
      status: "processing",
      jobId: jobId,
      statusUrl: `/jobs/${jobId}`,
      note: "Use the statusUrl to check processing progress",
    });
  } catch (error) {
    console.error("Failed to start album art fetch process:", error);
    return createErrorResponse(
      "Failed to start album art fetch process",
      (error as Error).message
    );
  }
}
