/**
 * Shared types between frontend and backend
 * This file serves as the single source of truth for all shared interfaces
 */

export interface ProcessingJob {
  id: string;
  url?: string;
  type: "single" | "playlist" | "album-art";
  status: "processing" | "completed" | "failed" | "stopped";
  startTime: Date | string;
  endTime?: Date | string;
  progress?: {
    total: number;
    completed: number;
    failed: number;
  };
  results?: MetaData[];
  errors?: string[];
  playlistTitle?: string;
  albumArtResults?: {
    processed: number;
    fetched: number;
    existed: number;
    errors: number;
  };
}

export interface MetaData {
  title: string;
  artist: string;
  album: string | null;
  trackNumber: number | null;
  discNumber: number | null;
  bpm: number | null;
  mood: string | null;
  duration?: number | null;
  genre: string | null;
  tags: string[] | null;
  language: string | null;
  albumArtPath?: string | null;
}

export interface CacheStats {
  totalEntries: number;
  oldestEntry: string;
  newestEntry: string;
  totalJobs: number;
  processingJobs: number;
  completedJobs: number;
  failedJobs: number;
  stoppedJobs: number;
}

export interface ProcessVideoRequest {
  prompt: string;
}

export interface ProcessVideoResponse {
  type: "single" | "playlist";
  jobId?: string;
  [key: string]: any;
}

export interface FileListResponse {
  baseDirectory: string;
  totalFiles: number;
  files: string[];
}

export interface MetadataRequest {
  file: string;
  tags: Record<string, string>;
}

export interface MetadataResponse {
  success: boolean;
  filePath: string;
  fullPath: string;
  updatedTags: Record<string, string>;
  message: string;
}

export interface CacheCleanupRequest {
  daysOld?: number;
}

export interface CacheCleanupResponse {
  success: boolean;
  message: string;
  stats: CacheStats;
}

export interface JobsResponse {
  jobs: ProcessingJob[];
}

// Cache entry types
export interface CacheEntry {
  id: number;
  url: string;
  created_at: string;
  last_accessed: string;
}

export interface JobCacheEntry {
  id: string;
  url: string | null;
  type: string;
  status: string;
  start_time: string;
  end_time: string | null;
  playlist_title: string | null;
  created_at: string;
  last_accessed: string;
}

export interface PaginationInfo {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
}

export interface CacheEntriesResponse {
  entries: CacheEntry[];
  pagination: PaginationInfo;
}

export interface JobEntriesResponse {
  entries: JobCacheEntry[];
  pagination: PaginationInfo;
}

export interface DeleteCacheEntriesRequest {
  ids: number[];
}

export interface DeleteJobEntriesRequest {
  ids: string[];
}

export interface DeleteEntriesResponse {
  success: boolean;
  message: string;
  deletedCount: number;
}

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
