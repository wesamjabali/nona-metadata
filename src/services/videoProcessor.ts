import { execFile } from "child_process";
import { promises as fs } from "fs";
import { join } from "path";
import { baseDirectory, bufferSizes } from "../config/constants.js";
import type { MetaData } from "../types/metadata.js";
import { executeCommand } from "../utils/command.js";
import {
  ensureDirectory,
  findExistingAlbumArt,
  getAlbumArtPath,
  getOrganizedFilePath,
  sanitizeFileName,
} from "../utils/file.js";
import { getExistingAlbumGenre } from "../utils/genreUtils.js";
import { generateContentWithRetry } from "./ai.js";
import { fetchAlbumArt, saveAlbumArt } from "./albumArt.js";
import { CacheManager } from "./cache.js";
import { downloadVideo, getVideoInfo } from "./youtube.js";

/**
 * Clean up temporary files
 */
async function cleanupTempFiles(filePaths: string[]): Promise<void> {
  for (const filePath of filePaths) {
    try {
      await fs.unlink(filePath);
      console.log(`Cleaned up temporary file: ${filePath}`);
    } catch (error) {
      if ((error as any).code !== "ENOENT") {
        console.warn(`Failed to cleanup temporary file ${filePath}:`, error);
      }
    }
  }
}

// Global album art request queue to ensure proper rate limiting
class AlbumArtQueue {
  private queue: Array<() => Promise<void>> = [];
  private isProcessing: boolean = false;

  async add<T>(task: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      this.queue.push(async () => {
        try {
          const result = await task();
          resolve(result);
        } catch (error) {
          reject(error);
        }
      });

      console.log(
        `Album art queue: Added request. Queue length: ${this.queue.length}`
      );

      if (!this.isProcessing) {
        this.processQueue();
      }
    });
  }

  private async processQueue(): Promise<void> {
    this.isProcessing = true;
    console.log(
      `Album art queue: Starting to process ${this.queue.length} requests`
    );

    while (this.queue.length > 0) {
      const task = this.queue.shift();
      if (task) {
        console.log(
          `Album art queue: Processing request. Remaining: ${this.queue.length}`
        );
        await task();

        if (this.queue.length > 0) {
          console.log(`Album art queue: Waiting 100ms before next request...`);
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
      }
    }

    console.log(`Album art queue: Finished processing all requests`);
    this.isProcessing = false;
  }
}

// Global album art queue instance
const albumArtQueue = new AlbumArtQueue();

/**
 * Fetches and saves album art if it doesn't already exist
 * @param artist The artist name
 * @param album The album name
 * @returns The path to the album art file, or null if not found/saved
 */
async function handleAlbumArt(
  artist: string,
  album: string | null
): Promise<string | null> {
  if (!album || album === "Unknown Album") {
    console.log(
      `Album art: Skipping (no album specified or unknown album) for "${artist}"`
    );
    return null;
  }

  const albumArtPath = getAlbumArtPath(artist, album);
  if (!albumArtPath) {
    console.log(`Album art: Unable to get path for "${album}" by "${artist}"`);
    return null;
  }

  try {
    const existingAlbumArt = await findExistingAlbumArt(albumArtPath);
    if (existingAlbumArt) {
      console.log(`Album art: Already exists: ${existingAlbumArt}`);
      return existingAlbumArt;
    }
  } catch {
    console.log(`Album art: Need to fetch for "${album}" by "${artist}"`);
  }

  return await albumArtQueue.add(async () => {
    try {
      const existingAlbumArt = await findExistingAlbumArt(albumArtPath);
      if (existingAlbumArt) {
        console.log(
          `Album art: Already exists (created during queue wait): ${existingAlbumArt}`
        );
        return existingAlbumArt;
      }

      console.log(`Album art: Fetching for "${album}" by "${artist}"...`);
      const albumArtResult = await fetchAlbumArt(artist, album);

      if (albumArtResult) {
        const savedPath = await saveAlbumArt(
          albumArtResult.data,
          albumArtResult.contentType,
          albumArtPath
        );
        if (savedPath) {
          console.log(`Album art: Successfully saved: ${savedPath}`);
          return savedPath;
        }
      }

      console.log(
        `Album art: Failed to fetch/save for "${album}" by "${artist}"`
      );
    } catch (error) {
      console.warn(
        `Album art: Error fetching for "${album}" by "${artist}":`,
        error
      );
    }

    return null;
  });
}

/**
 * Processes a single video: gets metadata, downloads, and applies metadata.
 * @param videoUrl The URL of the video to process.
 * @param index Optional index for playlist videos.
 * @param cache Cache manager instance
 * @returns A Promise that resolves with the processed metadata.
 */
export async function processVideo(
  videoUrl: string,
  cache: CacheManager,
  index?: number
): Promise<MetaData> {
  const cleanUrl = videoUrl
    .replace("&start_radio=1", "")
    .replace("?start_radio=1", "");

  const cachedMetadata = cache.get(cleanUrl);
  if (cachedMetadata) {
    let initialTempFileName = "";
    let ffmpegTempFileName = "";

    const finalFilePath = getOrganizedFilePath(
      cachedMetadata.artist,
      cachedMetadata.album || "Unknown Album",
      cachedMetadata.title
    );
    if (await fs.exists(finalFilePath)) {
      console.log(`Video is already processed (cached): ${finalFilePath}`);
      return cachedMetadata;
    }

    try {
      const videoInfo = await getVideoInfo(videoUrl);

      let aiVideoData = { ...cachedMetadata };
      aiVideoData.duration = videoInfo.duration;

      if (!aiVideoData.album) {
        aiVideoData.album = "Unknown Album";
      }

      if (index !== undefined) {
        aiVideoData.trackNumber = index + 1;
      }

      if (aiVideoData.album) {
        const existingGenre = await getExistingAlbumGenre(
          aiVideoData.artist,
          aiVideoData.album
        );
        if (existingGenre) {
          console.log(
            `Genre consistency (cached): Using existing album genre "${existingGenre}" instead of cached "${aiVideoData.genre}" for "${aiVideoData.title}"`
          );
          aiVideoData.genre = existingGenre;
        } else {
          console.log(
            `Genre consistency (cached): No existing genre found for album "${aiVideoData.album}", using cached genre "${aiVideoData.genre}"`
          );
        }
      }

      const albumArtPath = await handleAlbumArt(
        aiVideoData.artist,
        aiVideoData.album
      );
      aiVideoData.albumArtPath = albumArtPath;

      initialTempFileName = join(
        baseDirectory,
        `temp_${Date.now()}_${sanitizeFileName(videoInfo.title)}.m4a`
      );

      await ensureDirectory(baseDirectory);
      await downloadVideo(videoUrl, initialTempFileName);

      const organizedFilePath = getOrganizedFilePath(
        aiVideoData.artist,
        aiVideoData.album,
        aiVideoData.title
      );

      const targetDir = join(organizedFilePath, "..");
      await ensureDirectory(targetDir);

      ffmpegTempFileName = organizedFilePath.replace(
        ".m4a",
        "_ffmpeg_temp.m4a"
      );
      const ffmpegArgs = [
        "-y",
        "-i",
        initialTempFileName,
        "-c",
        "copy",
        "-metadata",
        `title=${aiVideoData.title}`,
        "-metadata",
        `artist=${aiVideoData.artist}`,
      ];

      if (aiVideoData.album) {
        ffmpegArgs.push("-metadata", `album=${aiVideoData.album}`);
      }
      if (aiVideoData.trackNumber) {
        ffmpegArgs.push("-metadata", `track=${aiVideoData.trackNumber}`);
      }
      if (aiVideoData.genre) {
        ffmpegArgs.push("-metadata", `genre=${aiVideoData.genre}`);
      }
      if (aiVideoData.language) {
        ffmpegArgs.push("-metadata", `language=${aiVideoData.language}`);
      }
      if (aiVideoData.discNumber) {
        ffmpegArgs.push("-metadata", `disc=${aiVideoData.discNumber}`);
      } else {
        ffmpegArgs.push("-metadata", `disc=1`);
      }
      if (aiVideoData.bpm) {
        ffmpegArgs.push("-metadata", `bpm=${aiVideoData.bpm}`);
      }
      if (aiVideoData.mood) {
        ffmpegArgs.push("-metadata", `mood=${aiVideoData.mood}`);
      }

      ffmpegArgs.push(ffmpegTempFileName);

      await new Promise<void>((resolve, reject) => {
        execFile(
          "ffmpeg",
          ffmpegArgs,
          { maxBuffer: bufferSizes.ffmpeg },
          (error, _stdout, stderr) => {
            if (error) {
              return reject(
                new Error(
                  `Command 'ffmpeg' failed: ${error.message}\n${stderr}`
                )
              );
            }
            if (stderr) {
              console.warn(`Command 'ffmpeg' output: ${stderr}`);
            }
            resolve();
          }
        );
      });

      await executeCommand("mv", [ffmpegTempFileName, organizedFilePath]);
      await executeCommand("rm", [initialTempFileName]);

      console.log(
        `Video processed successfully (from cache): ${aiVideoData.title} -> ${organizedFilePath}`
      );
      return aiVideoData;
    } catch (error) {
      const tempFiles = [initialTempFileName, ffmpegTempFileName].filter(
        Boolean
      );
      await cleanupTempFiles(tempFiles);
      throw error;
    }
  }

  let initialTempFileName = "";
  let ffmpegTempFileName = "";

  try {
    const videoInfo = await getVideoInfo(videoUrl);

    initialTempFileName = join(
      baseDirectory,
      `temp_${Date.now()}_${sanitizeFileName(videoInfo.title)}.m4a`
    );

    await ensureDirectory(baseDirectory);

    const promises = [
      generateContentWithRetry(`
Youtube URL: ${videoUrl}
Information attached to the video that might help you find it:
Title: ${videoInfo.title || "N/A"}
Track: ${videoInfo.track || "N/A"}
Channel: ${videoInfo.uploader || "N/A"}
Artist: ${videoInfo.artist || "N/A"}
Description (first 200 characters): ${
        (videoInfo.description as string | null)?.slice(0, 200) || "N/A"
      }
Tags: ${videoInfo.tags?.join(", ") || "N/A"}
Release Year: ${videoInfo.release_year || "N/A"}
`),
      downloadVideo(videoUrl, initialTempFileName),
    ];

    const [result] = await Promise.all(promises);

    let responseText = result?.response.text() || "";
    responseText = responseText.replaceAll("```", "").replaceAll("json", "");
    let aiVideoData: MetaData;

    try {
      aiVideoData = JSON.parse(responseText) as MetaData;
    } catch (e) {
      throw new Error(`API did not return valid JSON: ${responseText}`);
    }

    try {
      const cacheableMetadata = { ...aiVideoData };
      delete cacheableMetadata.duration;
      delete cacheableMetadata.albumArtPath;
      cache.set(cleanUrl, cacheableMetadata);
    } catch (cacheError) {
      console.warn(`Failed to cache metadata for ${cleanUrl}:`, cacheError);
    }

    aiVideoData.duration = videoInfo.duration;

    if (!aiVideoData.album) {
      aiVideoData.album = "Unknown Album";
    }

    if (index !== undefined) {
      aiVideoData.trackNumber = index + 1;
    }

    if (aiVideoData.album) {
      const existingGenre = await getExistingAlbumGenre(
        aiVideoData.artist,
        aiVideoData.album
      );
      if (existingGenre) {
        console.log(
          `Genre consistency: Using existing album genre "${existingGenre}" instead of AI-generated "${aiVideoData.genre}" for "${aiVideoData.title}"`
        );
        aiVideoData.genre = existingGenre;
      } else {
        console.log(
          `Genre consistency: No existing genre found for album "${aiVideoData.album}", using AI-generated genre "${aiVideoData.genre}"`
        );
      }
    }

    const albumArtPath = await handleAlbumArt(
      aiVideoData.artist,
      aiVideoData.album
    );
    aiVideoData.albumArtPath = albumArtPath;

    const organizedFilePath = getOrganizedFilePath(
      aiVideoData.artist,
      aiVideoData.album,
      aiVideoData.title
    );

    const targetDir = join(organizedFilePath, "..");
    await ensureDirectory(targetDir);

    ffmpegTempFileName = organizedFilePath.replace(".m4a", "_ffmpeg_temp.m4a");
    const ffmpegArgs = [
      "-y",
      "-i",
      initialTempFileName,
      "-c",
      "copy",
      "-metadata",
      `title=${aiVideoData.title}`,
      "-metadata",
      `artist=${aiVideoData.artist}`,
    ];

    if (aiVideoData.album) {
      ffmpegArgs.push("-metadata", `album=${aiVideoData.album}`);
    }
    if (aiVideoData.trackNumber) {
      ffmpegArgs.push("-metadata", `track=${aiVideoData.trackNumber}`);
    }
    if (aiVideoData.genre) {
      ffmpegArgs.push("-metadata", `genre=${aiVideoData.genre}`);
    }
    if (aiVideoData.language) {
      ffmpegArgs.push("-metadata", `language=${aiVideoData.language}`);
    }
    if (aiVideoData.discNumber) {
      ffmpegArgs.push("-metadata", `disc=${aiVideoData.discNumber}`);
    } else {
      ffmpegArgs.push("-metadata", `disc=1`);
    }
    if (aiVideoData.bpm) {
      ffmpegArgs.push("-metadata", `bpm=${aiVideoData.bpm}`);
    }
    if (aiVideoData.mood) {
      ffmpegArgs.push("-metadata", `mood=${aiVideoData.mood}`);
    }

    ffmpegArgs.push(ffmpegTempFileName);

    await new Promise<void>((resolve, reject) => {
      execFile(
        "ffmpeg",
        ffmpegArgs,
        { maxBuffer: bufferSizes.ffmpeg },
        (error, _stdout, stderr) => {
          if (error) {
            return reject(
              new Error(`Command 'ffmpeg' failed: ${error.message}\n${stderr}`)
            );
          }
          if (stderr) {
            console.warn(`Command 'ffmpeg' output: ${stderr}`);
          }
          resolve();
        }
      );
    });

    await executeCommand("mv", [ffmpegTempFileName, organizedFilePath]);

    await executeCommand("rm", [initialTempFileName]);

    console.log(
      `Video processed successfully: ${aiVideoData.title} -> ${organizedFilePath}`
    );
    return aiVideoData;
  } catch (error) {
    const tempFiles = [initialTempFileName, ffmpegTempFileName].filter(Boolean);
    await cleanupTempFiles(tempFiles);
    throw error;
  }
}
