import { createErrorResponse, createJsonResponse } from "../middleware/cors.js";
import { JobTracker } from "../services/jobTracker.js";

/**
 * Handle GET /jobs/:id - get job status
 */
export async function handleGetJobStatus(
  request: Request,
  jobTracker: JobTracker
): Promise<Response> {
  try {
    const url = new URL(request.url);
    const pathParts = url.pathname.split("/");
    const jobId = pathParts[2];

    if (!jobId) {
      return createErrorResponse("Job ID is required", undefined, 400);
    }

    const job = jobTracker.getJob(jobId);
    if (!job) {
      return createErrorResponse("Job not found", undefined, 404);
    }

    return createJsonResponse(job);
  } catch (error) {
    console.error("Error getting job status:", error);
    return createErrorResponse("Failed to get job status");
  }
}

/**
 * Handle GET /jobs - get all jobs (for debugging)
 */
export async function handleGetAllJobs(
  request: Request,
  jobTracker: JobTracker
): Promise<Response> {
  try {
    const jobs = jobTracker.getAllJobs();
    return createJsonResponse({ jobs });
  } catch (error) {
    console.error("Error getting all jobs:", error);
    return createErrorResponse("Failed to get jobs");
  }
}
