import { createErrorResponse, createJsonResponse } from "../middleware/cors.js";
import { CacheManager } from "../services/cache.js";
import type { CacheCleanupRequest } from "../types/metadata.js";

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
