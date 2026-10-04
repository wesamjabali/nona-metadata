#!/usr/bin/env bun

import type { AlbumArtSource } from "../services/albumArt.js";
import { fetchAlbumArt, saveAlbumArt } from "../services/albumArt.js";
import {
  forgetGeneratedCover,
  isGeneratedCover,
  markGeneratedCover,
} from "../services/albumArtPlaceholder.js";
import { JobTracker } from "../services/jobTracker.js";
import { resolveSourceContext } from "../services/sourceContext.js";
import {
  type AlbumFolder,
  groupMusicFilesByAlbumFolder,
  readFolderTags,
  resolveAlbumName,
} from "../utils/albumFolders.js";
import { findExistingAlbumArt, getAlbumArtPath } from "../utils/file.js";

/** What happened to one album folder during a backfill pass. */
type FolderOutcome =
  /** Art was already there and is not a generated placeholder. */
  | "existed"
  /** A cover was written in this pass. */
  | "fetched"
  /** A generated placeholder was replaced by real artwork. */
  | "upgraded"
  /** No artist tag (or no album folder) to work with. */
  | "skipped"
  /** Nothing could be produced. */
  | "failed";

export interface AlbumArtBackfillSummary {
  /** Album folders considered. */
  processed: number;
  /** Folders whose cover was written in this pass. */
  fetched: number;
  /** Placeholders replaced by real artwork in this pass. */
  upgraded: number;
  /** Folders that already had (real) artwork. */
  existed: number;
  /** Folders with nothing to search with. */
  skipped: number;
  /** Folders where nothing could be produced. */
  failed: number;
  /** How many covers each step of the chain produced. */
  bySource: Record<string, number>;
}

/**
 * Fetches the cover for one album folder.
 * @param folder The folder to work on.
 * @returns What happened, and which step produced the artwork.
 */
async function fetchAlbumArtForFolder(
  folder: AlbumFolder,
): Promise<{ outcome: FolderOutcome; source?: AlbumArtSource }> {
  const tags = await readFolderTags(folder);

  const artist = tags.artist?.trim();
  if (!artist) {
    console.log("⚠️  No artist found in metadata, skipping...");
    return { outcome: "skipped" };
  }

  // "Unknown Album" is not a reason to skip — those folders need covers most of
  // all, and their artwork comes from the track instead of the album.
  const album = resolveAlbumName(tags);

  const albumArtPath = await getAlbumArtPath(artist, album);
  if (!albumArtPath) {
    console.log("⚠️  Could not determine album art path, skipping...");
    return { outcome: "skipped" };
  }

  const singleTrackTitle = folder.titles.length === 1 ? folder.titles[0] : null;
  // Never label a cover "Unknown Album": a single-track folder is named after
  // its track, a multi-track one is simply "Singles".
  const label =
    album === "Unknown Album" ? (singleTrackTitle ?? "Singles") : album;

  const existingArt = await findExistingAlbumArt(albumArtPath);
  const generatedArt = await isGeneratedCover(folder.relativePath);
  if (existingArt && !generatedArt) {
    console.log(`✅ Album art already exists: ${existingArt}`);
    return { outcome: "existed" };
  }

  console.log(
    `${
      generatedArt ? "♻️  Retrying" : "🔍 Fetching"
    } album art for "${label}" (${artist})${
      singleTrackTitle
        ? ` [track: ${singleTrackTitle}]`
        : ` [${folder.titles.length} tracks]`
    }...`,
  );

  const albumArtResult = await fetchAlbumArt(artist, album, {
    // A single-track folder searches its title directly. A multi-track folder
    // under an unusable album name searches every title and only takes artwork
    // when a majority of them agree on one release; a folder with a real album
    // name relies on the album itself, because one track's single says nothing
    // about the album the folder is named after.
    trackTitle:
      album === "Unknown Album" && folder.titles.length === 1
        ? folder.titles[0]
        : undefined,
    trackTitles: album === "Unknown Album" ? folder.titles : undefined,
    placeholderLabel: label,
    allowGeneratedArt: true,
    // Resolved lazily: only pays for the yt-dlp source lookup when the fast
    // providers (iTunes/Deezer) fail to find a confident match. The YouTube
    // thumbnail fallback itself needs no network lookup.
    resolveSourceContext: () => resolveSourceContext(tags.sourceUrl),
  });

  if (!albumArtResult) {
    console.log(`❌ No album art found for "${label}" by "${artist}"`);
    return { outcome: "failed" };
  }

  const savedPath = await saveAlbumArt(
    albumArtResult.data,
    albumArtResult.contentType,
    albumArtPath,
  );

  if (!savedPath) {
    console.log("❌ Failed to save album art");
    return { outcome: "failed" };
  }

  if (albumArtResult.source === "generated") {
    await markGeneratedCover(folder.relativePath, label);
  } else {
    await forgetGeneratedCover(folder.relativePath);
  }

  console.log(
    `✅ Saved album art (${albumArtResult.description}) to: ${savedPath}`,
  );

  // "Upgraded" means a placeholder was replaced by real artwork — not a
  // placeholder that was merely redrawn, which is why the source is checked.
  const replacedPlaceholder =
    generatedArt && albumArtResult.source !== "generated";

  return {
    outcome: replacedPlaceholder ? "upgraded" : "fetched",
    source: albumArtResult.source,
  };
}

/**
 * Walks the whole library and gives every album folder a cover: real artwork
 * when a provider, the source thumbnail or the source media can supply it, and a
 * generated cover otherwise.
 * @param jobTracker Optional job tracker to report progress to.
 * @param jobId Optional job id to report progress for.
 * @returns Counts per outcome and per artwork source.
 */
async function fetchAlbumArtForExistingFiles(
  jobTracker?: JobTracker,
  jobId?: string,
): Promise<AlbumArtBackfillSummary> {
  console.log("🎵 Starting album art fetch for existing files...");

  const folders = await groupMusicFilesByAlbumFolder();

  console.log(
    `📁 Found ${folders.length} album folders (${folders.reduce(
      (total, folder) => total + folder.tracks.length,
      0,
    )} tracks)`,
  );

  const summary: AlbumArtBackfillSummary = {
    processed: 0,
    fetched: 0,
    upgraded: 0,
    existed: 0,
    skipped: 0,
    failed: 0,
    bySource: {},
  };

  if (jobTracker && jobId) {
    jobTracker.updateProgress(jobId, {
      total: folders.length,
      completed: 0,
      failed: 0,
    });
  }

  for (const folder of folders) {
    console.log(`\n🎵 Processing: ${folder.relativePath}`);

    try {
      const { outcome, source } = await fetchAlbumArtForFolder(folder);

      switch (outcome) {
        case "fetched":
          summary.fetched++;
          break;
        case "upgraded":
          summary.upgraded++;
          break;
        case "existed":
          summary.existed++;
          break;
        case "skipped":
          summary.skipped++;
          break;
        case "failed":
          summary.failed++;
          break;
      }

      if (source) {
        summary.bySource[source] = (summary.bySource[source] ?? 0) + 1;
      }
    } catch (error) {
      console.error(`❌ Error processing ${folder.relativePath}:`, error);
      summary.failed++;
    }

    summary.processed++;

    if (jobTracker && jobId) {
      jobTracker.updateProgress(jobId, {
        total: folders.length,
        completed: summary.processed,
        failed: summary.failed,
      });
    }
  }

  const sources = Object.entries(summary.bySource)
    .map(([source, count]) => `${source}: ${count}`)
    .join(", ");

  console.log("\n📊 Summary:");
  console.log(
    `   Album folders processed: ${summary.processed}/${folders.length}`,
  );
  console.log(`   Covers written: ${summary.fetched}`);
  console.log(`   Placeholders upgraded to real art: ${summary.upgraded}`);
  console.log(`   Already had artwork: ${summary.existed}`);
  console.log(`   Skipped (nothing to search with): ${summary.skipped}`);
  console.log(`   No artwork produced: ${summary.failed}`);
  console.log(`   Sources: ${sources || "none"}`);
  console.log("\n✨ Done!");

  return summary;
}

// Run the script if called directly
if (import.meta.main) {
  await fetchAlbumArtForExistingFiles();
}

export { fetchAlbumArtForExistingFiles };
