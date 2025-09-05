import { serve } from "bun";
import { baseDirectory, serverConfig } from "./config/constants.js";
import { Router } from "./router.js";
import { CacheManager } from "./services/cache.js";
import { JobTracker } from "./services/jobTracker.js";
import { cleanupOrphanedTempFiles, ensureDirectory } from "./utils/file.js";

console.log("Model initialized. Bun server starting...");

// Initialize cache manager
const cache = new CacheManager();

// Stop any processing jobs from previous server runs
cache.stopAllProcessingJobs();

// Initialize job tracker with cache manager for persistence
const jobTracker = new JobTracker(cache);

// Initialize router
const router = new Router(cache, jobTracker);

// Ensure base directory exists and cleanup orphaned temp files at startup
(async () => {
  try {
    await ensureDirectory(baseDirectory);
    console.log(`Base directory initialized: ${baseDirectory}`);

    await cleanupOrphanedTempFiles();
  } catch (error) {
    console.error(
      `Failed to initialize base directory or cleanup temp files: ${error}`
    );
  }
})();

// Start the server
serve({
  async fetch(request: Request) {
    return router.handle(request);
  },
  port: serverConfig.port,
  hostname: serverConfig.hostname,
});

console.log(
  `✅ Bun server listening on http://localhost:${serverConfig.port} (serving both API and frontend)`
);
