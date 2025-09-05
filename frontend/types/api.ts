// Re-export shared types
// Import for use in local types
import type { ProcessingJob } from "../../shared/types.js";

export type {
  CacheCleanupRequest,
  CacheCleanupResponse,
  CacheEntriesResponse,
  CacheEntry,
  CacheStats,
  DeleteCacheEntriesRequest,
  DeleteEntriesResponse,
  DeleteJobEntriesRequest,
  FileListResponse,
  JobCacheEntry,
  JobEntriesResponse,
  JobsResponse,
  MetaData,
  MetadataRequest,
  MetadataResponse,
  PaginationInfo,
  ProcessingJob,
  ProcessVideoRequest,
  ProcessVideoResponse,
} from "../../shared/types.js";

// Frontend-specific types for computed progress values
export interface ProcessingJobWithProgress
  extends Omit<ProcessingJob, "progress"> {
  progress?: number;
  originalProgress?: {
    total: number;
    completed: number;
    failed: number;
  };
}
