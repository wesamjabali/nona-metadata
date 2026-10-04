#!/usr/bin/env bun

/**
 * Reports the album-art state of every folder in the library, and optionally
 * shows what the fetch chain *would* produce for the folders that have none.
 *
 * Read-only: nothing is downloaded into the library and nothing is written, so
 * this is the safe way to answer "would the next backfill actually fix these?"
 * before running it — and the way to check afterwards that it did.
 *
 *   bun run src/scripts/auditAlbumArt.ts            # state of every folder
 *   bun run src/scripts/auditAlbumArt.ts --resolve  # + what each missing one would get
 *   bun run src/scripts/auditAlbumArt.ts --json     # machine-readable output
 */

import type { AlbumArtSource } from "../services/albumArt.js";
import { fetchAlbumArt } from "../services/albumArt.js";
import { isGeneratedCover } from "../services/albumArtPlaceholder.js";
import { resolveSourceContext } from "../services/sourceContext.js";
import {
  groupMusicFilesByAlbumFolder,
  readFolderTags,
  resolveAlbumName,
} from "../utils/albumFolders.js";
import { findExistingAlbumArt, getAlbumArtPath } from "../utils/file.js";

/** How an album folder's artwork looks right now. */
type ArtState = "real" | "generated" | "missing" | "no-artist" | "no-path";

/** One folder's audit row. */
interface AuditRow {
  folder: string;
  artist?: string;
  album: string;
  tracks: number;
  state: ArtState;
  /** What the chain would use, when `--resolve` was given. */
  wouldUse?: string;
  /** Which step the resolved artwork would come from. */
  wouldUseSource?: AlbumArtSource | "none";
}

/**
 * Classifies one album folder.
 * @param folder The folder to inspect.
 * @param resolve When true, run the fetch chain (without saving) to see what
 * the folder would get.
 * @returns The audit row for the folder.
 */
async function auditFolder(
  folder: Awaited<ReturnType<typeof groupMusicFilesByAlbumFolder>>[number],
  resolve: boolean,
): Promise<AuditRow> {
  const tags = await readFolderTags(folder);
  const album = resolveAlbumName(tags);
  const artist = tags.artist?.trim();
  const base: Omit<AuditRow, "state"> = {
    folder: folder.relativePath,
    artist,
    album,
    tracks: folder.tracks.length,
  };

  if (!artist) {
    return { ...base, state: "no-artist" };
  }

  const albumArtPath = await getAlbumArtPath(artist, album);
  if (!albumArtPath) {
    return { ...base, state: "no-path" };
  }

  const existing = await findExistingAlbumArt(albumArtPath);
  if (existing && !(await isGeneratedCover(folder.relativePath))) {
    return { ...base, state: "real" };
  }

  const state: ArtState = existing ? "generated" : "missing";
  if (!resolve) {
    return { ...base, state };
  }

  const singleTrackTitle = folder.titles.length === 1 ? folder.titles[0] : null;
  const result = await fetchAlbumArt(artist, album, {
    trackTitle: singleTrackTitle ?? undefined,
    placeholderLabel:
      album === "Unknown Album" ? (singleTrackTitle ?? "Singles") : album,
    allowGeneratedArt: true,
    // Same context the real pass resolves, so the report matches the outcome.
    resolveSourceContext: () => resolveSourceContext(tags.sourceUrl),
  });

  return {
    ...base,
    state,
    wouldUse: result?.description ?? "nothing",
    wouldUseSource: result?.source ?? "none",
  };
}

/**
 * Audits the whole library.
 * @param options.resolve Also resolve what missing folders would get.
 * @returns One row per album folder.
 */
async function auditAlbumArt(options: {
  resolve: boolean;
}): Promise<AuditRow[]> {
  const folders = await groupMusicFilesByAlbumFolder();
  const rows: AuditRow[] = [];

  for (const folder of folders) {
    rows.push(await auditFolder(folder, options.resolve));
  }

  return rows;
}

/**
 * Formats a state for the human-readable report.
 * @param state The folder's art state.
 * @returns A short label.
 */
function stateLabel(state: ArtState): string {
  switch (state) {
    case "real":
      return "ok       ";
    case "generated":
      return "GENERATED";
    case "missing":
      return "MISSING  ";
    case "no-artist":
      return "NO ARTIST";
    case "no-path":
      return "NO PATH  ";
  }
}

if (import.meta.main) {
  const args = new Set(process.argv.slice(2));
  const resolve = args.has("--resolve");
  const asJson = args.has("--json");

  if (asJson) {
    // Bun's console.log writes to stdout, and this pass logs plenty while it
    // works. With --json, the JSON is the only thing stdout must carry.
    console.log = console.error;
  }

  const rows = await auditAlbumArt({ resolve });

  if (asJson) {
    console.log(JSON.stringify(rows, null, 2));
  } else {
    for (const row of rows) {
      const suffix = row.wouldUse
        ? ` -> ${row.wouldUseSource}: ${row.wouldUse}`
        : "";
      console.log(
        `[${stateLabel(row.state)}] ${row.artist ?? "?"} / ${row.album}` +
          ` (${row.tracks} track${row.tracks === 1 ? "" : "s"})${suffix}`,
      );
    }
  }

  const counts = rows.reduce<Record<string, number>>((totals, row) => {
    totals[row.state] = (totals[row.state] ?? 0) + 1;
    return totals;
  }, {});

  const sources = rows.reduce<Record<string, number>>((totals, row) => {
    if (row.wouldUseSource) {
      totals[row.wouldUseSource] = (totals[row.wouldUseSource] ?? 0) + 1;
    }
    return totals;
  }, {});

  if (!asJson) {
    console.log("\nTotals:");
    for (const [state, count] of Object.entries(counts).sort()) {
      console.log(`  ${state}: ${count}`);
    }
    if (resolve) {
      console.log("Would use:");
      for (const [source, count] of Object.entries(sources).sort()) {
        console.log(`  ${source}: ${count}`);
      }
    }
  }
}

export { auditAlbumArt };
