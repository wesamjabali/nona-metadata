import { Database } from "bun:sqlite";
import { existsSync, mkdirSync } from "fs";
import { dirname } from "path";
import { cacheDbPath } from "../config/constants.js";
import type { CacheStats, MetaData, ProcessingJob } from "../types/metadata.js";

/**
 * SQLite cache manager for storing YouTube URL to AI metadata responses
 */
export class CacheManager {
  private db: Database;
  private insertQuery: any;
  private selectQuery: any;
  private updateAccessQuery: any;
  private jobInsertQuery: any;
  private jobSelectQuery: any;
  private jobSelectAllQuery: any;
  private jobUpdateQuery: any;
  private jobDeleteQuery: any;

  constructor(dbPath: string = cacheDbPath) {
    const cacheDir = dirname(dbPath);
    if (!existsSync(cacheDir)) {
      mkdirSync(cacheDir, { recursive: true });
      console.log(`📁 Created cache directory: ${cacheDir}`);
    }

    this.db = new Database(dbPath);

    this.db.exec("PRAGMA journal_mode = WAL;");

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS url_cache (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        url TEXT UNIQUE NOT NULL,
        metadata_json TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        last_accessed DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_url_cache_url ON url_cache(url)
    `);

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS jobs_cache (
        id TEXT PRIMARY KEY,
        url TEXT,
        type TEXT NOT NULL,
        status TEXT NOT NULL,
        start_time DATETIME NOT NULL,
        end_time DATETIME,
        progress_json TEXT,
        results_json TEXT,
        errors_json TEXT,
        playlist_title TEXT,
        album_art_results_json TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        last_accessed DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_jobs_cache_id ON jobs_cache(id)
    `);

    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_jobs_cache_status ON jobs_cache(status)
    `);

    this.insertQuery = this.db.prepare(`
      INSERT OR REPLACE INTO url_cache (url, metadata_json, last_accessed) 
      VALUES (?, ?, CURRENT_TIMESTAMP)
    `);

    this.selectQuery = this.db.prepare(`
      SELECT metadata_json FROM url_cache WHERE url = ?
    `);

    this.updateAccessQuery = this.db.prepare(`
      UPDATE url_cache SET last_accessed = CURRENT_TIMESTAMP WHERE url = ?
    `);

    this.jobInsertQuery = this.db.prepare(`
      INSERT OR REPLACE INTO jobs_cache (
        id, url, type, status, start_time, end_time, 
        progress_json, results_json, errors_json, 
        playlist_title, album_art_results_json, last_accessed
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `);

    this.jobSelectQuery = this.db.prepare(`
      SELECT * FROM jobs_cache WHERE id = ?
    `);

    this.jobSelectAllQuery = this.db.prepare(`
      SELECT * FROM jobs_cache ORDER BY start_time DESC
    `);

    this.jobUpdateQuery = this.db.prepare(`
      UPDATE jobs_cache SET 
        status = ?, end_time = ?, progress_json = ?, 
        results_json = ?, errors_json = ?, playlist_title = ?, 
        album_art_results_json = ?, last_accessed = CURRENT_TIMESTAMP
      WHERE id = ?
    `);

    this.jobDeleteQuery = this.db.prepare(`
      DELETE FROM jobs_cache WHERE id = ?
    `);

    console.log("✅ Cache database initialized");
  }

  /**
   * Get cached metadata for a URL
   * @param url The YouTube URL to look up
   * @returns The cached MetaData object or null if not found
   */
  get(url: string): MetaData | null {
    try {
      const result = this.selectQuery.get(url) as
        | { metadata_json: string }
        | undefined;
      if (result) {
        this.updateAccessQuery.run(url);

        const metadata = JSON.parse(result.metadata_json);
        console.log(`📦 Cache hit for URL: ${url}`);
        return metadata;
      }
      console.log(`❌ Cache miss for URL: ${url}`);
      return null;
    } catch (error) {
      console.warn(`Failed to retrieve from cache for URL ${url}:`, error);
      return null;
    }
  }

  /**
   * Store metadata in cache for a URL
   * @param url The YouTube URL
   * @param metadata The metadata to cache
   */
  set(url: string, metadata: MetaData): void {
    try {
      const metadataJson = JSON.stringify(metadata);
      this.insertQuery.run(url, metadataJson);
      console.log(`💾 Cached metadata for URL: ${url}`);
    } catch (error) {
      console.warn(`Failed to cache metadata for URL ${url}:`, error);
    }
  }

  /**
   * Remove cached metadata for a specific URL
   * @param url The YouTube URL to remove from cache
   * @returns True if an entry was removed, false if not found
   */
  remove(url: string): boolean {
    try {
      const deleteQuery = this.db.prepare(`
        DELETE FROM url_cache WHERE url = ?
      `);
      const result = deleteQuery.run(url);

      if (result.changes > 0) {
        console.log(`🗑️ Removed cached metadata for URL: ${url}`);
        return true;
      } else {
        console.log(`❌ No cache entry found for URL: ${url}`);
        return false;
      }
    } catch (error) {
      console.warn(`Failed to remove cache entry for URL ${url}:`, error);
      return false;
    }
  }

  /**
   * Clean up old cache entries (optional maintenance function)
   * @param daysOld Number of days old entries to remove (default: 0)
   */
  cleanup(daysOld = 0): void {
    try {
      const cleanupQuery = this.db.prepare(`
        DELETE FROM url_cache 
        WHERE last_accessed < datetime('now', '-${daysOld} days')
      `);
      const result = cleanupQuery.run();

      const jobCleanupQuery = this.db.prepare(`
        DELETE FROM jobs_cache 
        WHERE last_accessed < datetime('now', '-${daysOld} days')
      `);
      const jobResult = jobCleanupQuery.run();

      console.log(
        `🧹 Cleaned up ${result.changes} old cache entries and ${jobResult.changes} old jobs`
      );
    } catch (error) {
      console.warn(`Failed to cleanup cache:`, error);
    }
  }

  /**
   * Save a job to persistent storage
   * @param job The job to save
   */
  saveJob(job: ProcessingJob): void {
    try {
      const progressJson = job.progress ? JSON.stringify(job.progress) : null;
      const resultsJson = job.results ? JSON.stringify(job.results) : null;
      const errorsJson = job.errors ? JSON.stringify(job.errors) : null;
      const albumArtResultsJson = job.albumArtResults
        ? JSON.stringify(job.albumArtResults)
        : null;

      this.jobInsertQuery.run(
        job.id,
        job.url || null,
        job.type,
        job.status,
        job.startTime instanceof Date
          ? job.startTime.toISOString()
          : job.startTime,
        job.endTime
          ? job.endTime instanceof Date
            ? job.endTime.toISOString()
            : job.endTime
          : null,
        progressJson,
        resultsJson,
        errorsJson,
        job.playlistTitle || null,
        albumArtResultsJson
      );

      console.log(`💾 Saved job ${job.id} to cache`);
    } catch (error) {
      console.warn(`Failed to save job ${job.id} to cache:`, error);
    }
  }

  /**
   * Load a job from persistent storage
   * @param jobId The job ID to load
   * @returns The job or null if not found
   */
  loadJob(jobId: string): ProcessingJob | null {
    try {
      const result = this.jobSelectQuery.get(jobId) as any;
      if (result) {
        this.db
          .prepare(
            `
          UPDATE jobs_cache SET last_accessed = CURRENT_TIMESTAMP WHERE id = ?
        `
          )
          .run(jobId);

        return this.parseJobFromDb(result);
      }
      return null;
    } catch (error) {
      console.warn(`Failed to load job ${jobId} from cache:`, error);
      return null;
    }
  }

  /**
   * Load all jobs from persistent storage
   * @returns Array of all jobs
   */
  loadAllJobs(): ProcessingJob[] {
    try {
      const results = this.jobSelectAllQuery.all() as any[];
      return results.map((result) => this.parseJobFromDb(result));
    } catch (error) {
      console.warn(`Failed to load jobs from cache:`, error);
      return [];
    }
  }

  /**
   * Update an existing job in persistent storage
   * @param job The job to update
   */
  updateJob(job: ProcessingJob): void {
    try {
      const progressJson = job.progress ? JSON.stringify(job.progress) : null;
      const resultsJson = job.results ? JSON.stringify(job.results) : null;
      const errorsJson = job.errors ? JSON.stringify(job.errors) : null;
      const albumArtResultsJson = job.albumArtResults
        ? JSON.stringify(job.albumArtResults)
        : null;

      this.jobUpdateQuery.run(
        job.status,
        job.endTime
          ? job.endTime instanceof Date
            ? job.endTime.toISOString()
            : job.endTime
          : null,
        progressJson,
        resultsJson,
        errorsJson,
        job.playlistTitle || null,
        albumArtResultsJson,
        job.id
      );

      console.log(`🔄 Updated job ${job.id} in cache`);
    } catch (error) {
      console.warn(`Failed to update job ${job.id} in cache:`, error);
    }
  }

  /**
   * Delete a job from persistent storage
   * @param jobId The job ID to delete
   */
  deleteJob(jobId: string): void {
    try {
      this.jobDeleteQuery.run(jobId);
      console.log(`🗑️ Deleted job ${jobId} from cache`);
    } catch (error) {
      console.warn(`Failed to delete job ${jobId} from cache:`, error);
    }
  }

  /**
   * Parse a job object from database result
   * @param dbResult The database result row
   * @returns Parsed ProcessingJob object
   */
  private parseJobFromDb(dbResult: any): ProcessingJob {
    const job: ProcessingJob = {
      id: dbResult.id,
      url: dbResult.url || undefined,
      type: dbResult.type,
      status: dbResult.status,
      startTime: new Date(dbResult.start_time),
      endTime: dbResult.end_time ? new Date(dbResult.end_time) : undefined,
    };

    if (dbResult.progress_json) {
      job.progress = JSON.parse(dbResult.progress_json);
    }

    if (dbResult.results_json) {
      job.results = JSON.parse(dbResult.results_json);
    }

    if (dbResult.errors_json) {
      job.errors = JSON.parse(dbResult.errors_json);
    }

    if (dbResult.playlist_title) {
      job.playlistTitle = dbResult.playlist_title;
    }

    if (dbResult.album_art_results_json) {
      job.albumArtResults = JSON.parse(dbResult.album_art_results_json);
    }

    return job;
  }

  /**
   * Get cache statistics
   */
  getStats(): CacheStats {
    try {
      const statsQuery = this.db.prepare(`
        SELECT 
          COUNT(*) as total,
          MIN(created_at) as oldest,
          MAX(created_at) as newest
        FROM url_cache
      `);
      const stats = statsQuery.get() as
        | { total: number; oldest: string; newest: string }
        | undefined;

      const jobStatsQuery = this.db.prepare(`
        SELECT 
          COUNT(*) as total,
          COUNT(CASE WHEN status = 'processing' THEN 1 END) as processing,
          COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed,
          COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed,
          COUNT(CASE WHEN status = 'stopped' THEN 1 END) as stopped
        FROM jobs_cache
      `);
      const jobStats = jobStatsQuery.get() as any;

      return {
        totalEntries: stats?.total || 0,
        oldestEntry: stats?.oldest || "N/A",
        newestEntry: stats?.newest || "N/A",
        totalJobs: jobStats?.total || 0,
        processingJobs: jobStats?.processing || 0,
        completedJobs: jobStats?.completed || 0,
        failedJobs: jobStats?.failed || 0,
        stoppedJobs: jobStats?.stopped || 0,
      };
    } catch (error) {
      console.warn(`Failed to get cache stats:`, error);
      return {
        totalEntries: 0,
        oldestEntry: "N/A",
        newestEntry: "N/A",
        totalJobs: 0,
        processingJobs: 0,
        completedJobs: 0,
        failedJobs: 0,
        stoppedJobs: 0,
      };
    }
  }

  /**
   * Get paginated cache entries
   * @param page Page number (1-based)
   * @param limit Number of entries per page
   * @param searchTerm Optional search term to filter URLs
   * @returns Paginated cache entries
   */
  getCacheEntries(page: number = 1, limit: number = 20, searchTerm?: string) {
    try {
      const offset = (page - 1) * limit;

      let whereClause = "";
      let countWhereClause = "";
      const params: any[] = [];
      const countParams: any[] = [];

      if (searchTerm) {
        whereClause = "WHERE url LIKE ?";
        countWhereClause = "WHERE url LIKE ?";
        params.push(`%${searchTerm}%`);
        countParams.push(`%${searchTerm}%`);
      }

      const entriesQuery = this.db.prepare(`
        SELECT 
          id,
          url,
          created_at,
          last_accessed
        FROM url_cache 
        ${whereClause}
        ORDER BY last_accessed DESC 
        LIMIT ? OFFSET ?
      `);

      const countQuery = this.db.prepare(`
        SELECT COUNT(*) as total FROM url_cache ${countWhereClause}
      `);

      const entries = entriesQuery.all(...params, limit, offset);
      const { total } = countQuery.get(...countParams) as { total: number };

      return {
        entries,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
          hasNext: page * limit < total,
          hasPrev: page > 1,
        },
      };
    } catch (error) {
      console.warn(`Failed to get cache entries:`, error);
      return {
        entries: [],
        pagination: {
          page: 1,
          limit,
          total: 0,
          totalPages: 0,
          hasNext: false,
          hasPrev: false,
        },
      };
    }
  }

  /**
   * Get paginated job entries
   * @param page Page number (1-based)
   * @param limit Number of entries per page
   * @param statusFilter Optional status filter
   * @returns Paginated job entries
   */
  getJobEntries(page: number = 1, limit: number = 20, statusFilter?: string) {
    try {
      const offset = (page - 1) * limit;

      let whereClause = "";
      let countWhereClause = "";
      const params: any[] = [];
      const countParams: any[] = [];

      if (statusFilter) {
        whereClause = "WHERE status = ?";
        countWhereClause = "WHERE status = ?";
        params.push(statusFilter);
        countParams.push(statusFilter);
      }

      const entriesQuery = this.db.prepare(`
        SELECT 
          id,
          url,
          type,
          status,
          start_time,
          end_time,
          playlist_title,
          created_at,
          last_accessed
        FROM jobs_cache 
        ${whereClause}
        ORDER BY start_time DESC 
        LIMIT ? OFFSET ?
      `);

      const countQuery = this.db.prepare(`
        SELECT COUNT(*) as total FROM jobs_cache ${countWhereClause}
      `);

      const entries = entriesQuery.all(...params, limit, offset);
      const { total } = countQuery.get(...countParams) as { total: number };

      return {
        entries,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
          hasNext: page * limit < total,
          hasPrev: page > 1,
        },
      };
    } catch (error) {
      console.warn(`Failed to get job entries:`, error);
      return {
        entries: [],
        pagination: {
          page: 1,
          limit,
          total: 0,
          totalPages: 0,
          hasNext: false,
          hasPrev: false,
        },
      };
    }
  }

  /**
   * Delete multiple cache entries by IDs
   * @param ids Array of entry IDs to delete
   * @returns Number of deleted entries
   */
  deleteCacheEntries(ids: number[]): number {
    try {
      if (ids.length === 0) return 0;

      const placeholders = ids.map(() => "?").join(",");
      const deleteQuery = this.db.prepare(`
        DELETE FROM url_cache WHERE id IN (${placeholders})
      `);

      const result = deleteQuery.run(...ids);
      console.log(`🗑️ Deleted ${result.changes} cache entries`);
      return result.changes;
    } catch (error) {
      console.warn(`Failed to delete cache entries:`, error);
      return 0;
    }
  }

  /**
   * Delete multiple job entries by IDs
   * @param ids Array of job IDs to delete
   * @returns Number of deleted entries
   */
  deleteJobEntries(ids: string[]): number {
    try {
      if (ids.length === 0) return 0;

      const placeholders = ids.map(() => "?").join(",");
      const deleteQuery = this.db.prepare(`
        DELETE FROM jobs_cache WHERE id IN (${placeholders})
      `);

      const result = deleteQuery.run(...ids);
      console.log(`🗑️ Deleted ${result.changes} job entries`);
      return result.changes;
    } catch (error) {
      console.warn(`Failed to delete job entries:`, error);
      return 0;
    }
  }

  /**
   * Update all processing jobs to stopped status on server startup
   */
  stopAllProcessingJobs(): number {
    try {
      const updateQuery = this.db.prepare(`
        UPDATE jobs_cache 
        SET status = 'stopped', end_time = CURRENT_TIMESTAMP 
        WHERE status = 'processing'
      `);

      const result = updateQuery.run();
      const changedCount = result.changes;

      if (changedCount > 0) {
        console.log(`🛑 Stopped ${changedCount} processing jobs on startup`);
      } else {
        console.log(`✅ No processing jobs found to stop`);
      }

      return changedCount;
    } catch (error) {
      console.warn(`Failed to stop processing jobs:`, error);
      return 0;
    }
  }

  /**
   * Close the database connection
   */
  close(): void {
    this.db.close();
  }
}
