/**
 * Album-folder helpers shared by the album-art scripts.
 *
 * Artwork belongs to a folder, not to a file, so both the backfill and the
 * audit pass need the same two things: the library grouped into album folders,
 * and the identity tags of each folder. Keeping that here means the two passes
 * can never disagree about what an album folder is.
 */

import { basename, dirname, extname, join } from "path";

import { baseDirectory, musicFileExtensions } from "../config/constants.js";
import { getFileMetadata } from "../services/metadata.js";
import { listFilesRecursively } from "../utils/directory.js";
import { extractSourceUrlFromTags } from "../utils/sourceUrl.js";

/** One album folder, with everything needed to fetch its cover. */
export interface AlbumFolder {
  /** Path relative to the library root, e.g. "Fairuz/Unknown Album". */
  relativePath: string;
  /** Absolute path on disk. */
  absolutePath: string;
  /** Music files in the folder, relative to the library root. */
  tracks: string[];
  /** Track titles (file basenames, i.e. the sanitized titles). */
  titles: string[];
}

/** Identity tags read from an album folder's first track. */
export interface FolderTags {
  /** Artist tag (any of the spellings the taggers write). */
  artist?: string;
  /** Album tag, as stored. */
  album?: string;
  /** The stored `Source: <url>` comment, if present. */
  sourceUrl: string | null;
}

/**
 * Groups the library's music files by album folder.
 *
 * Work is done per folder rather than per file: a cover belongs to the folder,
 * so treating each track separately would re-scan the providers for every song
 * on an album (and can only ever write the same file).
 * @returns One entry per album folder that contains music, sorted by path.
 */
export async function groupMusicFilesByAlbumFolder(): Promise<AlbumFolder[]> {
  const allFiles = await listFilesRecursively(baseDirectory, baseDirectory);
  const musicFiles = allFiles.filter((file) =>
    (musicFileExtensions as readonly string[]).some((extension) =>
      file.toLowerCase().endsWith(extension),
    ),
  );

  const folders = new Map<string, AlbumFolder>();

  for (const file of musicFiles) {
    const relativePath = dirname(file);
    if (relativePath === ".") {
      continue;
    }

    const existing = folders.get(relativePath);
    if (existing) {
      existing.tracks.push(file);
      existing.titles.push(basename(file, extname(file)));
      continue;
    }

    folders.set(relativePath, {
      relativePath,
      absolutePath: join(baseDirectory, relativePath),
      tracks: [file],
      titles: [basename(file, extname(file))],
    });
  }

  return [...folders.values()].sort((a, b) =>
    a.relativePath.localeCompare(b.relativePath),
  );
}

/**
 * Reads the identity tags from the first track of an album folder.
 *
 * One track is enough: every file in the folder shares the artist/album tags,
 * and probing each of them turns a pass over the library into thousands of
 * ffprobe calls for no extra information.
 * @param folder The album folder.
 * @returns The artist/album (if present) and the stored source URL.
 */
export async function readFolderTags(folder: AlbumFolder): Promise<FolderTags> {
  const track = folder.tracks[0];
  if (!track) {
    return { sourceUrl: null };
  }

  const metadata = await getFileMetadata(join(baseDirectory, track));
  const tags: Record<string, string> = metadata?.format?.tags ?? {};

  return {
    artist: tags.artist ?? tags.ARTIST ?? tags.albumartist ?? tags.ALBUMARTIST,
    album: tags.album ?? tags.ALBUM,
    sourceUrl: extractSourceUrlFromTags(tags),
  };
}

/**
 * The album name to file a folder's cover under: the stored album when it means
 * something, otherwise the literal folder name the library already uses.
 * @param tags The folder's tags.
 * @returns An album name that always denotes a real folder.
 */
export function resolveAlbumName(tags: FolderTags): string {
  const album = (tags.album ?? "").trim();
  return album || "Unknown Album";
}
