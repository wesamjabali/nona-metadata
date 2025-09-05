import { createErrorResponse, createJsonResponse } from "../middleware/cors.js";
import { CacheManager } from "../services/cache.js";
import type {
  CacheCleanupRequest,
  DeleteCacheEntriesRequest,
  DeleteJobEntriesRequest,
} from "../types/metadata.js";

/**
 * Handle GET /cache/stats - get cache statistics
 */
export async function handleCacheStats(cache: CacheManager): Promise<Response> {
  try {
    const stats = cache.getStats();

    return createJsonResponse({
      success: true,
      stats: stats,
      message: "Cache statistics retrieved successfully",
    });
  } catch (error) {
    console.error("Failed to get cache stats:", error);
    return createErrorResponse(
      "Failed to get cache statistics",
      (error as Error).message
    );
  }
}

/**
 * Handle GET /cache/entries - get paginated cache entries
 */
export async function handleGetCacheEntries(
  request: Request,
  cache: CacheManager
): Promise<Response> {
  try {
    const url = new URL(request.url);
    const page = parseInt(url.searchParams.get("page") || "1");
    const limit = parseInt(url.searchParams.get("limit") || "20");
    const search = url.searchParams.get("search") || undefined;

    const result = cache.getCacheEntries(page, limit, search);

    return createJsonResponse({
      success: true,
      ...result,
      message: "Cache entries retrieved successfully",
    });
  } catch (error) {
    console.error("Failed to get cache entries:", error);
    return createErrorResponse(
      "Failed to get cache entries",
      (error as Error).message
    );
  }
}

/**
 * Handle GET /cache/jobs - get paginated job entries
 */
export async function handleGetJobEntries(
  request: Request,
  cache: CacheManager
): Promise<Response> {
  try {
    const url = new URL(request.url);
    const page = parseInt(url.searchParams.get("page") || "1");
    const limit = parseInt(url.searchParams.get("limit") || "20");
    const status = url.searchParams.get("status") || undefined;

    const result = cache.getJobEntries(page, limit, status);

    return createJsonResponse({
      success: true,
      ...result,
      message: "Job entries retrieved successfully",
    });
  } catch (error) {
    console.error("Failed to get job entries:", error);
    return createErrorResponse(
      "Failed to get job entries",
      (error as Error).message
    );
  }
}

/**
 * Handle DELETE /cache/entries - delete selected cache entries
 */
export async function handleDeleteCacheEntries(
  request: Request,
  cache: CacheManager
): Promise<Response> {
  try {
    const requestBody = (await request.json()) as DeleteCacheEntriesRequest;
    const { ids } = requestBody;

    if (!Array.isArray(ids) || ids.length === 0) {
      return createErrorResponse("No entry IDs provided", undefined, 400);
    }

    const deletedCount = cache.deleteCacheEntries(ids);

    return createJsonResponse({
      success: true,
      deletedCount,
      message: `Successfully deleted ${deletedCount} cache entries`,
    });
  } catch (error) {
    console.error("Failed to delete cache entries:", error);
    return createErrorResponse(
      "Failed to delete cache entries",
      (error as Error).message
    );
  }
}

/**
 * Handle DELETE /cache/jobs - delete selected job entries
 */
export async function handleDeleteJobEntries(
  request: Request,
  cache: CacheManager
): Promise<Response> {
  try {
    const requestBody = (await request.json()) as DeleteJobEntriesRequest;
    const { ids } = requestBody;

    if (!Array.isArray(ids) || ids.length === 0) {
      return createErrorResponse("No job IDs provided", undefined, 400);
    }

    const deletedCount = cache.deleteJobEntries(ids);

    return createJsonResponse({
      success: true,
      deletedCount,
      message: `Successfully deleted ${deletedCount} job entries`,
    });
  } catch (error) {
    console.error("Failed to delete job entries:", error);
    return createErrorResponse(
      "Failed to delete job entries",
      (error as Error).message
    );
  }
}

/**
 * Handle POST /cache/cleanup - cleanup old cache entries
 */
export async function handleCacheCleanup(
  request: Request,
  cache: CacheManager
): Promise<Response> {
  try {
    const requestBody = (await request.json()) as CacheCleanupRequest;
    const { daysOld } = requestBody;

    const days = daysOld ?? 0;
    cache.cleanup(days);

    const stats = cache.getStats();

    return createJsonResponse({
      success: true,
      message: `Cache cleanup completed for entries older than ${days} days`,
      stats: stats,
    });
  } catch (error) {
    console.error("Failed to cleanup cache:", error);
    return createErrorResponse(
      "Failed to cleanup cache",
      (error as Error).message
    );
  }
}
