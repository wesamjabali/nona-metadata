#!/usr/bin/env bun

import { join } from "path";
import { baseDirectory, musicFileExtensions } from "../config/constants.js";
import { JobTracker } from "../services/jobTracker.js";
import { fetchLyrics, saveLyrics } from "../services/lyrics.js";
import { getFileMetadata } from "../services/metadata.js";
import type { LyricsJobResults } from "../types/metadata.js";
import { listFilesRecursively } from "../utils/directory.js";
import { findExistingLyrics } from "../utils/file.js";

/**
 * Extracts the artist, title, album and duration from an audio file's tags.
 * Handles the case variations ffprobe returns across containers/codecs.
 */
function readTrackInfo(metadata: any): {
  artist: string | null;
  title: string | null;
  album: string | null;
  duration: number | null;
} {
  const format = metadata?.format ?? {};
  const tags = format.tags ?? {};

  const artist =
    tags.artist || tags.ARTIST || tags.albumartist || tags.ALBUMARTIST || null;
  const title = tags.title || tags.TITLE || null;
  const album = tags.album || tags.ALBUM || null;

  const parsedDuration = Number.parseFloat(format.duration);
  const duration = Number.isFinite(parsedDuration) ? parsedDuration : null;

  return { artist, title, album, duration };
}

/**
 * Processes all existing music files and fetches the lyrics they are missing.
 * Lyrics are written as `.lrc` sidecar files next to each audio file, so this
 * is safe to re-run: files that already have a non-empty `.lrc` are skipped.
 *
 * Works for any language LRCLIB covers, including English and Arabic, since
 * titles/artists are passed through in their original script.
 */
async function fetchLyricsForExistingFiles(
  jobTracker?: JobTracker,
  jobId?: string,
): Promise<LyricsJobResults> {
  console.log("🎤 Starting lyrics fetch for existing files...");

  try {
    const allFiles = await listFilesRecursively(baseDirectory, baseDirectory);
    const musicFiles = allFiles.filter((file) =>
      musicFileExtensions.some((extension) => file.endsWith(extension)),
    );

    console.log(`📁 Found ${musicFiles.length} music files`);

    let processed = 0;
    let lyricsFetched = 0;
    let lyricsExisted = 0;
    let lyricsNotFound = 0;
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

      try {
        const metadata = await getFileMetadata(fullFilePath);
        const { artist, title, album, duration } = readTrackInfo(metadata);

        if (!artist || !title) {
          console.log(
            `⚠️  Missing artist/title tags, skipping: ${relativeFilePath}`,
          );
          processed++;
          continue;
        }

        const existingLyrics = await findExistingLyrics(fullFilePath);
        if (existingLyrics) {
          lyricsExisted++;
          processed++;
          continue;
        }

        console.log(`🔍 Fetching lyrics for "${title}" by "${artist}"...`);
        const lyrics = await fetchLyrics(artist, title, album, duration);

        if (!lyrics) {
          console.log(`➖ No lyrics found for "${title}" by "${artist}"`);
          lyricsNotFound++;
          processed++;
          continue;
        }

        const savedPath = await saveLyrics(lyrics, fullFilePath, {
          artist,
          title,
          album,
          duration,
        });

        if (savedPath) {
          lyricsFetched++;
        } else {
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

    const results: LyricsJobResults = {
      processed,
      fetched: lyricsFetched,
      existed: lyricsExisted,
      notFound: lyricsNotFound,
      errors,
    };

    console.log(`\n📊 Summary:`);
    console.log(`   Processed: ${processed}/${musicFiles.length} files`);
    console.log(`   Lyrics fetched: ${lyricsFetched}`);
    console.log(`   Lyrics already existed: ${lyricsExisted}`);
    console.log(`   No lyrics found: ${lyricsNotFound}`);
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
  await fetchLyricsForExistingFiles();
}

export { fetchLyricsForExistingFiles };
