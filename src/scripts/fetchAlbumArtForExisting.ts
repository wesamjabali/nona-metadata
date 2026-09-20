#!/usr/bin/env bun

import { join } from "path";
import { baseDirectory } from "../config/constants.js";
import type { AlbumArtHints } from "../services/albumArt.js";
import { fetchAlbumArt, saveAlbumArt } from "../services/albumArt.js";
import { JobTracker } from "../services/jobTracker.js";
import { getFileMetadata } from "../services/metadata.js";
import { getVideoInfo } from "../services/youtube.js";
import { listFilesRecursively } from "../utils/directory.js";
import { findExistingAlbumArt, getAlbumArtPath } from "../utils/file.js";
import { extractSourceUrl } from "../utils/sourceUrl.js";
import { buildSearchHints, pickThumbnailUrl } from "../utils/thumbnail.js";

/**
 * Resolves the album art context for a track from its stored source URL.
 *
 * Every processed track records `Source: <url>` in its comment tag, which lets
 * us (a) widen provider searches with the source video's title/uploader and
 * (b) fall back to the video thumbnail. Files processed before that tag was
 * introduced have no URL — that is expected, so a missing URL is not an error.
 * @param filePath The audio file to inspect.
 * @returns Source-media hints and/or a fallback image URL.
 */
async function resolveSourceContext(filePath: string): Promise<{
  fallbackImageUrl?: string;
  hints?: AlbumArtHints;
}> {
  const sourceUrl = await extractSourceUrl(filePath);

  if (!sourceUrl) {
    console.log("ℹ️  No source URL stored in metadata (legacy file)");
    return {};
  }

  try {
    const videoInfo = await getVideoInfo(sourceUrl);
    const fallbackImageUrl = pickThumbnailUrl(videoInfo);
    const hints = buildSearchHints(videoInfo, sourceUrl);

    return {
      ...(fallbackImageUrl ? { fallbackImageUrl } : {}),
      ...(hints ? { hints } : {}),
    };
  } catch (error) {
    console.warn(
      `⚠️  Could not fetch info for source URL ${sourceUrl}:`,
      (error as Error).message,
    );
    return {};
  }
}

/**
 * Processes all existing music files and fetches album art for those missing it
 */
async function fetchAlbumArtForExistingFiles(
  jobTracker?: JobTracker,
  jobId?: string,
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
        file.endsWith(".wav"),
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

        if (!album || album === "Unknown Album") {
          console.log(
            `⚠️  No album found in metadata or album is 'Unknown Album', skipping...`,
          );
          processed++;
          continue;
        }

        console.log(`🎤 Artist: ${artist}`);
        console.log(`💿 Album: ${album}`);

        const albumArtPath = await getAlbumArtPath(artist, album);
        if (!albumArtPath) {
          console.log(`⚠️  Could not determine album art path, skipping...`);
          processed++;
          continue;
        }

        const existingAlbumArt = await findExistingAlbumArt(albumArtPath);
        if (existingAlbumArt) {
          console.log(`✅ Album art already exists: ${existingAlbumArt}`);
          albumArtExists++;
          processed++;
          continue;
        }

        console.log(`🔍 Fetching album art for "${album}" by "${artist}"...`);
        const albumArtResult = await fetchAlbumArt(artist, album, {
          // Resolved lazily: only pays for the yt-dlp source lookup when the
          // fast providers (iTunes/Deezer) fail to find a confident match.
          resolveSourceContext: () => resolveSourceContext(fullFilePath),
        });

        if (albumArtResult) {
          const savedPath = await saveAlbumArt(
            albumArtResult.data,
            albumArtResult.contentType,
            albumArtPath,
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
