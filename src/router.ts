import { createErrorResponse, handleOptions } from "./middleware/cors.js";
import { handleFetchAlbumArt } from "./routes/albumArt.js";
import { handleServeAlbumArt } from "./routes/albumArtStatic.js";
import { handleCacheCleanup, handleCacheStats } from "./routes/cache.js";
import { handleFileDelete } from "./routes/delete.js";
import { handleFilesList } from "./routes/files.js";
import { handleGetAllJobs, handleGetJobStatus } from "./routes/jobs.js";
import { handleGetMetadata, handleUpdateMetadata } from "./routes/metadata.js";
import { handlePlaylistInfo, handleProcessVideo } from "./routes/process.js";
import { handleStaticFile, handleVueRoute } from "./routes/static.js";
import { CacheManager } from "./services/cache.js";
import { JobTracker } from "./services/jobTracker.js";

export class Router {
  constructor(private cache: CacheManager, private jobTracker: JobTracker) {}

  async handle(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const method = request.method;
    const pathname = url.pathname;

    if (method === "OPTIONS") {
      return handleOptions();
    }

    try {
      if (method === "GET" && pathname === "/") {
        return handleVueRoute(request);
      }

      if (
        method === "GET" &&
        pathname.startsWith("/jobs/") &&
        pathname.split("/").length === 3
      ) {
        return handleGetJobStatus(request, this.jobTracker);
      }

      // API routes that should be handled before Vue routes
      if (method === "GET" && pathname === "/files") {
        return handleFilesList(request);
      }

      if (method === "DELETE" && pathname === "/files") {
        return handleFileDelete(request);
      }

      if (method === "GET" && pathname === "/cache/stats") {
        return handleCacheStats(this.cache);
      }

      if (method === "POST" && pathname === "/cache/cleanup") {
        return handleCacheCleanup(request, this.cache);
      }

      if (method === "GET" && pathname === "/metadata") {
        return handleGetMetadata(request);
      }

      if (method === "PATCH" && pathname === "/metadata") {
        return handleUpdateMetadata(request);
      }

      if (method === "GET" && pathname === "/playlist-info") {
        return handlePlaylistInfo(request);
      }

      if (method === "GET" && pathname === "/jobs") {
        // Check if this is a request for the jobs page (HTML) vs API
        const acceptHeader = request.headers.get("accept") || "";
        if (acceptHeader.includes("text/html")) {
          return handleVueRoute(request);
        }
        // Otherwise handle as API
        return handleGetAllJobs(request, this.jobTracker);
      }

      if (method === "POST" && pathname === "/fetch-album-art") {
        return handleFetchAlbumArt(request, this.jobTracker);
      }

      if (method === "GET" && pathname.startsWith("/album-art")) {
        return handleServeAlbumArt(request);
      }

      if (method === "POST" && pathname === "/") {
        return handleProcessVideo(request, this.cache, this.jobTracker);
      }

      if (
        method === "GET" &&
        (pathname.startsWith("/_nuxt/") ||
          pathname === "/favicon.ico" ||
          pathname === "/_payload.json" ||
          (pathname.startsWith("/cache/") &&
            pathname.endsWith("/_payload.json")) ||
          (pathname.startsWith("/jobs/") &&
            pathname.endsWith("/_payload.json")))
      ) {
        return handleStaticFile(request);
      }

      if (method === "GET") {
        if (!pathname.startsWith("/api/") && pathname !== "/favicon.ico") {
          return handleVueRoute(request);
        }
      }

      return createErrorResponse(
        "Supported endpoints: GET /, GET /processing-jobs, GET /files, DELETE /files, GET /cache/stats, POST /cache/cleanup, GET /metadata, PATCH /metadata, GET /playlist-info, GET /jobs, GET /jobs/:id, POST /, POST /fetch-album-art, GET /:artist/:album (album art)",
        undefined,
        405
      );
    } catch (error) {
      console.error("Router error:", error);
      return createErrorResponse(
        "An internal server error occurred.",
        (error as Error).message
      );
    }
  }
}
