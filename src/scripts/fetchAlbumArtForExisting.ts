#!/usr/bin/env bun

import { join } from "path";
import { baseDirectory } from "../config/constants.js";
import { fetchAlbumArt, saveAlbumArt } from "../services/albumArt.js";
import { JobTracker } from "../services/jobTracker.js";
import { getFileMetadata } from "../services/metadata.js";
import { listFilesRecursively } from "../utils/directory.js";
import { findExistingAlbumArt, getAlbumArtPath } from "../utils/file.js";

/**
 * Processes all existing music files and fetches album art for those missing it
 */
async function fetchAlbumArtForExistingFiles(
  jobTracker?: JobTracker,
  jobId?: string
): Promise<{
  processed: number;
  fetched: number;
  existed: number;
  errors: number;
}> {
  console.log("🎵 Starting album art fetch for existing files...");

  try {
    const allFiles = await listFilesRecursively(baseDirectory, baseDirectory);
    const musicFiles = allFiles.filter(
      (file) =>
        file.endsWith(".m4a") ||
        file.endsWith(".mp3") ||
        file.endsWith(".flac") ||
        file.endsWith(".wav")
    );

    console.log(`📁 Found ${musicFiles.length} music files`);

    let processed = 0;
    let albumArtFetched = 0;
    let albumArtExists = 0;
    let errors = 0;

    if (jobTracker && jobId) {
      jobTracker.updateProgress(jobId, {
        total: musicFiles.length,
        completed: 0,
        failed: 0,
      });
    }

    for (const relativeFilePath of musicFiles) {
      const fullFilePath = relativeFilePath.startsWith(baseDirectory)
        ? relativeFilePath
        : join(baseDirectory, relativeFilePath);
      console.log(`\n🎵 Processing: ${relativeFilePath}`);
      console.log(`🔍 Base directory: ${baseDirectory}`);
      console.log(`🔍 Full file path: ${fullFilePath}`);

      try {
        const metadata = await getFileMetadata(fullFilePath);
        const format = metadata.format;
        const tags = format.tags || {};

        const artist =
          tags.artist || tags.ARTIST || tags.albumartist || tags.ALBUMARTIST;
        const album = tags.album || tags.ALBUM;

        if (!artist) {
          console.log(`⚠️  No artist found in metadata, skipping...`);
          processed++;
          continue;
        }

        if (!album || album === 'Unknown Album') {
          console.log(`⚠️  No album found in metadata or album is 'Unknown Album', skipping...`);
          processed++;
          continue;
        }

        console.log(`🎤 Artist: ${artist}`);
        console.log(`💿 Album: ${album}`);

        const albumArtPath = getAlbumArtPath(artist, album);
        if (!albumArtPath) {
          console.log(`⚠️  Could not determine album art path, skipping...`);
          processed++;
          continue;
        }

        const existingAlbumArt = await findExistingAlbumArt(albumArtPath);
        if (existingAlbumArt) {
          console.log(`✅ Album art already exists: ${existingAlbumArt}`);
          processed++;
          continue;
        }

        console.log(`🔍 Fetching album art for "${album}" by "${artist}"...`);
        const albumArtResult = await fetchAlbumArt(artist, album);

        if (albumArtResult) {
          const savedPath = await saveAlbumArt(
            albumArtResult.data,
            albumArtResult.contentType,
            albumArtPath
          );
          if (savedPath) {
            console.log(`✅ Successfully saved album art to: ${savedPath}`);
            albumArtFetched++;
          } else {
            console.log(`❌ Failed to save album art`);
            errors++;
          }
        } else {
          console.log(`❌ No album art found for "${album}" by "${artist}"`);
          errors++;
        }

        processed++;
      } catch (error) {
        console.error(`❌ Error processing ${relativeFilePath}:`, error);
        errors++;
        processed++;
      }

      if (jobTracker && jobId) {
        jobTracker.updateProgress(jobId, {
          total: musicFiles.length,
          completed: processed,
          failed: errors,
        });
      }
    }

    const results = {
      processed,
      fetched: albumArtFetched,
      existed: albumArtExists,
      errors,
    };

    console.log(`\n📊 Summary:`);
    console.log(`   Processed: ${processed}/${musicFiles.length} files`);
    console.log(`   Album art fetched: ${albumArtFetched}`);
    console.log(`   Album art already existed: ${albumArtExists}`);
    console.log(`   Errors: ${errors}`);
    console.log(`\n✨ Done!`);

    return results;
  } catch (error) {
    console.error("❌ Failed to process existing files:", error);
    if (import.meta.main) {
      process.exit(1);
    }
    throw error;
  }
}

// Run the script if called directly
if (import.meta.main) {
  await fetchAlbumArtForExistingFiles();
}

export { fetchAlbumArtForExistingFiles };
