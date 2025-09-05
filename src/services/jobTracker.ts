import type { MetaData, ProcessingJob } from "../types/metadata.js";
import type { CacheManager } from "./cache.js";

/**
 * Job tracker to manage background processing jobs
 */
export class JobTracker {
  private jobs = new Map<string, ProcessingJob>();
  private readonly maxJobs = 100;
  private cacheManager: CacheManager;

  constructor(cacheManager: CacheManager) {
    this.cacheManager = cacheManager;
    this.loadJobsFromCache();
  }

  /**
   * Load existing jobs from cache on startup
   */
  private loadJobsFromCache(): void {
    try {
      const cachedJobs = this.cacheManager.loadAllJobs();
      for (const job of cachedJobs) {
        this.jobs.set(job.id, job);
      }
      console.log(`📦 Loaded ${cachedJobs.length} jobs from cache`);
    } catch (error) {
      console.warn("Failed to load jobs from cache:", error);
    }
  }

  /**
   * Create a new job
   */
  createJob(url: string, type: "single" | "playlist"): string;
  createJob(type: "album-art"): string;
  createJob(urlOrType: string, type?: "single" | "playlist"): string {
    const id = this.generateJobId();

    let job: ProcessingJob;
    if (type) {
      job = {
        id,
        url: urlOrType,
        type,
        status: "processing",
        startTime: new Date(),
      };
    } else {
      job = {
        id,
        type: urlOrType as "album-art",
        status: "processing",
        startTime: new Date(),
      };
    }

    this.jobs.set(id, job);
    this.cacheManager.saveJob(job);
    this.cleanupOldJobs();

    console.log(
      `Created job ${id} for ${job.type}${job.url ? `: ${job.url}` : ""}`
    );
    return id;
  }

  /**
   * Update job progress
   */
  updateProgress(
    id: string,
    progress: { total: number; completed: number; failed: number }
  ): void {
    const job = this.jobs.get(id);
    if (job) {
      job.progress = progress;
      this.jobs.set(id, job);
      this.cacheManager.updateJob(job);
    }
  }

  /**
   * Set playlist title immediately after getting playlist info
   */
  setPlaylistTitle(id: string, playlistTitle: string): void {
    const job = this.jobs.get(id);
    if (job) {
      job.playlistTitle = playlistTitle;
      this.jobs.set(id, job);
      this.cacheManager.updateJob(job);
      console.log(`Job ${id} playlist title set to: "${playlistTitle}"`);
    }
  }

  /**
   * Complete a job successfully
   */
  completeJob(id: string, results: MetaData[], playlistTitle?: string): void;
  completeJob(
    id: string,
    albumArtResults: {
      processed: number;
      fetched: number;
      existed: number;
      errors: number;
    }
  ): void;
  completeJob(
    id: string,
    resultsOrAlbumArt:
      | MetaData[]
      | { processed: number; fetched: number; existed: number; errors: number },
    playlistTitle?: string
  ): void {
    const job = this.jobs.get(id);
    if (job) {
      job.status = "completed";
      job.endTime = new Date();

      if (Array.isArray(resultsOrAlbumArt)) {
        job.results = resultsOrAlbumArt;
        job.playlistTitle = playlistTitle;
        console.log(
          `Job ${id} completed successfully with ${resultsOrAlbumArt.length} results`
        );
      } else {
        job.albumArtResults = resultsOrAlbumArt;
        console.log(
          `Job ${id} completed successfully: ${resultsOrAlbumArt.fetched} album arts fetched, ${resultsOrAlbumArt.existed} already existed`
        );
      }

      this.jobs.set(id, job);
      this.cacheManager.updateJob(job);
    }
  }

  /**
   * Mark a job as failed
   */
  failJob(id: string, errors: string[]): void {
    const job = this.jobs.get(id);
    if (job) {
      job.status = "failed";
      job.endTime = new Date();
      job.errors = errors;
      this.jobs.set(id, job);
      this.cacheManager.updateJob(job);

      console.log(`Job ${id} failed with ${errors.length} errors`);
    }
  }

  /**
   * Get job status
   */
  getJob(id: string): ProcessingJob | undefined {
    return this.jobs.get(id);
  }

  /**
   * Get all jobs (for admin/debugging)
   */
  getAllJobs(): ProcessingJob[] {
    return Array.from(this.jobs.values()).sort((a, b) => {
      const aTime =
        a.startTime instanceof Date ? a.startTime : new Date(a.startTime);
      const bTime =
        b.startTime instanceof Date ? b.startTime : new Date(b.startTime);
      return bTime.getTime() - aTime.getTime();
    });
  }

  /**
   * Generate unique job ID
   */
  private generateJobId(): string {
    return `job_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Clean up old jobs to prevent memory leaks
   */
  private cleanupOldJobs(): void {
    if (this.jobs.size > this.maxJobs) {
      const jobsArray = this.getAllJobs();
      const jobsToRemove = jobsArray.slice(this.maxJobs);

      for (const job of jobsToRemove) {
        this.jobs.delete(job.id);
        this.cacheManager.deleteJob(job.id);
      }

      console.log(`Cleaned up ${jobsToRemove.length} old jobs`);
    }
  }
}
