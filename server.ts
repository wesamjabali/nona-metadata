import { GoogleGenerativeAI } from "@google/generative-ai";
import { serve } from "bun";
import { Database } from "bun:sqlite";
import { execFile } from "child_process";
import { mkdir, readdir, stat } from "fs/promises";
import { join } from "path";

// Base directory for organizing music files
const baseDirectory = process.env.BASE_DIR || "/music";

type MetaData = {
  title: string;
  artist: string;
  album: string | null;
  trackNumber: number | null;
  discNumber: number | null;
  bpm: number | null;
  year: number | null;
  duration?: number | null;
  genre: string | null;
  tags: string[] | null;
  language: string | null;
};

/**
 * SQLite cache manager for storing YouTube URL to AI metadata responses
 */
class CacheManager {
  private db: Database;
  private insertQuery: any;
  private selectQuery: any;
  private updateAccessQuery: any;

  constructor(dbPath: string = "cache.sqlite") {
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
      console.log(`🧹 Cleaned up ${result.changes} old cache entries`);
    } catch (error) {
      console.warn(`Failed to cleanup cache:`, error);
    }
  }

  /**
   * Get cache statistics
   */
  getStats(): {
    totalEntries: number;
    oldestEntry: string;
    newestEntry: string;
  } {
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
      return {
        totalEntries: stats?.total || 0,
        oldestEntry: stats?.oldest || "N/A",
        newestEntry: stats?.newest || "N/A",
      };
    } catch (error) {
      console.warn(`Failed to get cache stats:`, error);
      return { totalEntries: 0, oldestEntry: "N/A", newestEntry: "N/A" };
    }
  }

  /**
   * Close the database connection
   */
  close(): void {
    this.db.close();
  }
}

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  throw new Error("GEMINI_API_KEY environment variable not set.");
}

const genAI = new GoogleGenerativeAI(apiKey);
const modelName = "gemini-2.5-flash";

const model = genAI.getGenerativeModel({
  model: modelName,
  systemInstruction: `You are a metadata search and extraction specialist. You only return JSON.
    When a user provides a URL, use your search tool to find its metadata.
    
    EVERY SINGLE REQUEST REQUIRES A GOOGLE SEARCH.
    NEVER ADD \`\`\` OR ANY FORMATTING HERE.

    The user might provide some more data to give you hints as to which video they are interested in, such as the title, artist, or album. 
    These will not always be accurate, and it's your job to correct it cleanly.
    Make sure you remove all extraneous information and focus on the key details.

    Title Example 1: Nasak - Lyric Video (English) => Nasak
    Example 2: Coldplay - Hymn for the Weekend (Official Video) => title: Hymn for the Weekend artist: coldplay

    For artist, only list one artist, the main one. Do not add features, additions, etc. Just list the primary artist.
    For bpm, you should google the beats per minute of a song. 
    For language, use the ISO 639-1 code.
    For album, if unknown, set to null. DO NOT make it "Unknown Album" or anything similar. DO NOT make it the same as the title or artist.

    Your response MUST be a raw JSON object and nothing else. 
    Do not use markdown, code blocks, or any explanatory text.
    The output must be immediately parsable by JSON.parse().

    
    Respond with the metadata ONLY in the following schema:
    {
      "title": "STRING",
      "artist": "STRING",
      "album": "STRING | null",
      "trackNumber": "INTEGER | null",
      "discNumber": "INTEGER | null",
      "bpm": "INTEGER | null",
      "year": "INTEGER | null",
      "genre": "STRING | null",
      "tags": "STRING[] | null",
      "language": "STRING | null"
    }
      
    Example response:
{
  "title": "Problems",
  "artist": "Lil Wayne",
  "album": "Tha Carter V",
  "trackNumber": 22,
  "discNumber": 1,
  "bpm": 140,
  "year": 2018,
  "genre": "Hip hop",
  "tags": [
    "Lil Wayne",
    "Tha Carter V",
    "Problems",
    "Hip hop"
  ],
  "language": "en"
}`,
  tools: modelName.includes("1.5")
    ? [
        {
          googleSearchRetrieval: {},
        },
      ]
    : [
        {
          googleSearch: {},
        } as any,
      ],
});

console.log("Model initialized. Bun server starting...");

// Initialize cache manager
const cache = new CacheManager();

// Ensure base directory exists at startup
(async () => {
  try {
    await ensureDirectory(baseDirectory);
    console.log(`Base directory initialized: ${baseDirectory}`);
  } catch (error) {
    console.error(`Failed to create base directory: ${error}`);
  }
})();

/**
 * Sanitizes a string to be safe for use as a directory/file name.
 * @param name The string to sanitize.
 * @returns A sanitized string safe for filesystem use.
 */
function sanitizeFileName(name: string): string {
  return name
    .replace(/[<>:"/\\|?*]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100);
}

/**
 * Ensures a directory exists, creating it if necessary.
 * @param dirPath The directory path to ensure exists.
 * @returns A Promise that resolves when the directory exists.
 */
async function ensureDirectory(dirPath: string): Promise<void> {
  try {
    await mkdir(dirPath, { recursive: true });
  } catch (error) {
    if ((error as any).code !== "EEXIST") {
      throw error;
    }
  }
}

/**
 * Generates the organized file path for a song.
 * @param artist The artist name.
 * @param album The album name (or null).
 * @param title The song title.
 * @returns The full file path where the song should be stored.
 */
function getOrganizedFilePath(
  artist: string,
  album: string | null,
  title: string
): string {
  const sanitizedArtist = sanitizeFileName(artist) || "Unknown Artist";
  const sanitizedTitle = sanitizeFileName(title) || "Unknown Title";

  if (album === null || album === "") {
    return join(baseDirectory, sanitizedArtist, `${sanitizedTitle}.mp3`);
  } else {
    const sanitizedAlbum = sanitizeFileName(album);
    return join(
      baseDirectory,
      sanitizedArtist,
      sanitizedAlbum,
      `${sanitizedTitle}.mp3`
    );
  }
}

/**
 * Executes a command with arguments and returns a Promise.
 * @param command The command to execute.
 * @param args The arguments for the command.
 * @returns A Promise that resolves on success or rejects on error.
 */
function executeCommand(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(
      command,
      args,
      { maxBuffer: 1024 * 1024 * 5 },
      (error, _stdout, stderr) => {
        if (error) {
          return reject(
            new Error(
              `Command '${command}' failed: ${error.message}\n${stderr}`
            )
          );
        }
        if (stderr) {
          console.warn(`Command '${command}' output: ${stderr}`);
        }
        resolve();
      }
    );
  });
}

/**
 * Checks if a URL is a playlist URL.
 * @param url The URL to check.
 * @returns True if the URL contains playlist indicators.
 */
function isPlaylistUrl(url: string): boolean {
  return url.includes("list=") || url.includes("playlist");
}

/**
 * Fetches playlist information from a YouTube playlist URL using yt-dlp.
 * @param playlistUrl The URL of the YouTube playlist.
 * @returns A Promise that resolves with the playlist's metadata object or rejects on error.
 */
function getPlaylistInfo(playlistUrl: string): Promise<any> {
  return new Promise((resolve, reject) => {
    execFile(
      "yt-dlp",
      ["--flat-playlist", "--dump-json", "--no-warnings", playlistUrl],
      { maxBuffer: 1024 * 1024 * 50 },
      (error, stdout) => {
        if (error) {
          return reject(
            new Error(`Failed to get playlist info: ${error.message}`)
          );
        }
        try {
          const lines = stdout
            .trim()
            .split("\n")
            .filter((line) => line.trim());
          let playlistData: any = null;
          const entries: any[] = [];

          for (const line of lines) {
            try {
              const jsonObj = JSON.parse(line);

              if (jsonObj._type === "playlist") {
                playlistData = jsonObj;
              } else if (
                jsonObj._type === "url" &&
                jsonObj.ie_key === "Youtube"
              ) {
                entries.push(jsonObj);
              }
            } catch (lineParseError) {
              console.warn(`Failed to parse line: ${line}`, lineParseError);
            }
          }

          if (playlistData) {
            if (!playlistData.entries) {
              playlistData.entries = entries;
            }
            resolve(playlistData);
          } else if (entries.length > 0) {
            resolve({
              _type: "playlist",
              title: "Unknown Playlist",
              entries: entries,
            });
          } else {
            reject(new Error("No playlist data or entries found"));
          }
        } catch (parseError) {
          reject(
            new Error(
              `Failed to parse yt-dlp JSON output: ${
                (parseError as any).message
              }\nOutput: ${stdout.slice(0, 500)}...`
            )
          );
        }
      }
    );
  });
}

/**
 * Fetches video metadata from a YouTube URL using yt-dlp.
 * @param videoUrl The URL of the YouTube video.
 * @returns A Promise that resolves with the video's metadata object or rejects on error.
 */
function getVideoInfo(videoUrl: string): Promise<any> {
  return new Promise((resolve, reject) => {
    execFile(
      "yt-dlp",
      ["--dump-json", "--no-warnings", videoUrl],
      { maxBuffer: 1024 * 1024 * 10 },
      (error, stdout) => {
        if (error) {
          return reject(
            new Error(`Failed to get video info: ${error.message}`)
          );
        }
        try {
          const videoData = JSON.parse(stdout);
          resolve(videoData);
        } catch (parseError) {
          reject(
            new Error(
              `Failed to parse yt-dlp JSON output: ${
                (parseError as any).message
              }`
            )
          );
        }
      }
    );
  });
}

/**
 * Downloads a video from a URL using yt-dlp.
 * @param videoUrl The URL of the YouTube video.
 * @param outputPath The file path where the video should be saved.
 * @returns A Promise that resolves when the download is complete or rejects on error.
 */
function downloadVideo(videoUrl: string, outputPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(
      "yt-dlp",
      ["-x", "--audio-format", "mp3", "-o", outputPath, videoUrl],
      { maxBuffer: 1024 * 1024 * 10 },
      (error, _stdout, stderr) => {
        if (error) {
          return reject(new Error(`Download failed: ${error.message}`));
        }
        if (stderr) {
          console.warn(`yt-dlp output: ${stderr}`);
        }
        resolve();
      }
    );
  });
}

/**
 * Extracts metadata from an audio file using ffprobe.
 * @param filePath The path to the audio file.
 * @returns A Promise that resolves with the file's metadata.
 */
function getFileMetadata(filePath: string): Promise<any> {
  return new Promise((resolve, reject) => {
    execFile(
      "ffprobe",
      [
        "-v",
        "quiet",
        "-print_format",
        "json",
        "-show_format",
        "-show_streams",
        filePath,
      ],
      { maxBuffer: 1024 * 1024 * 5 },
      (error, stdout, stderr) => {
        if (error) {
          return reject(
            new Error(`Failed to get file metadata: ${error.message}`)
          );
        }
        if (stderr) {
          console.warn(`ffprobe output: ${stderr}`);
        }
        try {
          const metadata = JSON.parse(stdout);
          resolve(metadata);
        } catch (parseError) {
          reject(
            new Error(
              `Failed to parse ffprobe JSON output: ${
                (parseError as any).message
              }`
            )
          );
        }
      }
    );
  });
}

/**
 * Updates metadata tags of an audio file using ffmpeg.
 * @param filePath The path to the audio file.
 * @param tags An object containing metadata tags to update.
 * @returns A Promise that resolves when the metadata update is complete.
 */
function updateFileMetadata(
  filePath: string,
  tags: Record<string, string>
): Promise<void> {
  return new Promise((resolve, reject) => {
    const tempFilePath = filePath.replace(/\.([^.]+)$/, "_temp.$1");

    const ffmpegArgs = ["-y", "-i", filePath, "-c", "copy"];

    for (const [key, value] of Object.entries(tags)) {
      ffmpegArgs.push("-metadata", `${key}=${value}`);
    }

    ffmpegArgs.push(tempFilePath);

    execFile(
      "ffmpeg",
      ffmpegArgs,
      { maxBuffer: 1024 * 1024 * 5 },
      (error, stdout, stderr) => {
        if (error) {
          return reject(
            new Error(`Failed to update file metadata: ${error.message}`)
          );
        }
        if (stderr) {
          console.warn(`ffmpeg output: ${stderr}`);
        }

        execFile(
          "mv",
          [tempFilePath, filePath],
          { maxBuffer: 1024 * 1024 },
          (mvError) => {
            if (mvError) {
              execFile(
                "rm",
                [tempFilePath],
                { maxBuffer: 1024 * 1024 },
                () => {}
              );
              return reject(
                new Error(`Failed to replace original file: ${mvError.message}`)
              );
            }
            resolve();
          }
        );
      }
    );
  });
}

/**
 * Recursively lists all files in a directory and returns their paths.
 * @param dirPath The directory path to scan.
 * @param relativeTo Optional base path to make paths relative to.
 * @returns A Promise that resolves with an array of file paths.
 */
async function listFilesRecursively(
  dirPath: string,
  relativeTo?: string
): Promise<string[]> {
  const files: string[] = [];

  try {
    const entries = await readdir(dirPath);

    for (const entry of entries) {
      const fullPath = join(dirPath, entry);
      const stats = await stat(fullPath);

      if (stats.isDirectory()) {
        const subFiles = await listFilesRecursively(fullPath, relativeTo);
        files.push(...subFiles);
      } else if (stats.isFile()) {
        const filePath = relativeTo
          ? fullPath.replace(relativeTo, "").replace(/^\//, "")
          : fullPath;
        files.push(filePath);
      }
    }
  } catch (error) {
    console.warn(`Failed to list files in ${dirPath}:`, error);
  }

  return files;
}

/**
 * Processes a single video: gets metadata, downloads, and applies metadata.
 * @param videoUrl The URL of the video to process.
 * @param index Optional index for playlist videos.
 * @returns A Promise that resolves with the processed metadata.
 */
async function processVideo(
  videoUrl: string,
  index?: number
): Promise<MetaData> {
  const cleanUrl = videoUrl
    .replace("&start_radio=1", "")
    .replace("?start_radio=1", "");

  const cachedMetadata = cache.get(cleanUrl);
  if (cachedMetadata) {
    const videoInfo = await getVideoInfo(videoUrl);

    let aiVideoData = { ...cachedMetadata };
    aiVideoData.duration = videoInfo.duration;

    if (index !== undefined) {
      aiVideoData.trackNumber = index + 1;
    }

    const initialTempFileName = join(
      baseDirectory,
      `temp_${Date.now()}_${sanitizeFileName(videoInfo.title)}.mp3`
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

    const ffmpegTempFileName = organizedFilePath.replace(
      ".mp3",
      "_ffmpeg_temp.mp3"
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
    if (aiVideoData.year) {
      ffmpegArgs.push("-metadata", `date=${aiVideoData.year}`);
    }
    if (aiVideoData.language) {
      ffmpegArgs.push("-metadata", `language=${aiVideoData.language}`);
    }
    if (aiVideoData.discNumber) {
      ffmpegArgs.push("-metadata", `disc=${aiVideoData.discNumber}`);
    }

    ffmpegArgs.push(ffmpegTempFileName);

    await new Promise<void>((resolve, reject) => {
      execFile(
        "ffmpeg",
        ffmpegArgs,
        { maxBuffer: 1024 * 1024 * 10 },
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
      `Video processed successfully (from cache): ${aiVideoData.title} -> ${organizedFilePath}`
    );
    return aiVideoData;
  }

  const videoInfo = await getVideoInfo(videoUrl);

  const initialTempFileName = join(
    baseDirectory,
    `temp_${Date.now()}_${sanitizeFileName(videoInfo.title)}.mp3`
  );

  await ensureDirectory(baseDirectory);

  const promises = [
    model.generateContent(`
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
    cache.set(cleanUrl, cacheableMetadata);
  } catch (cacheError) {
    console.warn(`Failed to cache metadata for ${cleanUrl}:`, cacheError);
  }

  aiVideoData.duration = videoInfo.duration;

  if (index !== undefined) {
    aiVideoData.trackNumber = index + 1;
  }

  const organizedFilePath = getOrganizedFilePath(
    aiVideoData.artist,
    aiVideoData.album,
    aiVideoData.title
  );

  const targetDir = join(organizedFilePath, "..");
  await ensureDirectory(targetDir);

  const ffmpegTempFileName = organizedFilePath.replace(
    ".mp3",
    "_ffmpeg_temp.mp3"
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
  if (aiVideoData.year) {
    ffmpegArgs.push("-metadata", `date=${aiVideoData.year}`);
  }
  if (aiVideoData.language) {
    ffmpegArgs.push("-metadata", `language=${aiVideoData.language}`);
  }
  if (aiVideoData.discNumber) {
    ffmpegArgs.push("-metadata", `disc=${aiVideoData.discNumber}`);
  }

  ffmpegArgs.push(ffmpegTempFileName);

  await new Promise<void>((resolve, reject) => {
    execFile(
      "ffmpeg",
      ffmpegArgs,
      { maxBuffer: 1024 * 1024 * 10 },
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
}

serve({
  async fetch(request: Request) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
        },
      });
    }

    if (request.method === "GET" && url.pathname === "/files") {
      try {
        console.log("Listing files in directory:", baseDirectory);
        const files = await listFilesRecursively(baseDirectory, baseDirectory);

        const sortedFiles = files.sort((a, b) => a.localeCompare(b));

        return new Response(
          JSON.stringify({
            baseDirectory: baseDirectory,
            totalFiles: sortedFiles.length,
            files: sortedFiles,
          }),
          {
            status: 200,
            headers: {
              "Content-Type": "application/json",
              "Access-Control-Allow-Origin": "*",
            },
          }
        );
      } catch (error) {
        console.error("Failed to list files:", error);
        return new Response(
          JSON.stringify({
            error: "Failed to list files",
            details: (error as Error).message,
          }),
          {
            status: 500,
            headers: {
              "Content-Type": "application/json",
              "Access-Control-Allow-Origin": "*",
            },
          }
        );
      }
    }

    if (request.method === "GET" && url.pathname === "/cache/stats") {
      try {
        const stats = cache.getStats();

        return new Response(
          JSON.stringify({
            success: true,
            stats: stats,
            message: "Cache statistics retrieved successfully",
          }),
          {
            status: 200,
            headers: {
              "Content-Type": "application/json",
              "Access-Control-Allow-Origin": "*",
            },
          }
        );
      } catch (error) {
        console.error("Failed to get cache stats:", error);
        return new Response(
          JSON.stringify({
            error: "Failed to get cache statistics",
            details: (error as Error).message,
          }),
          {
            status: 500,
            headers: {
              "Content-Type": "application/json",
              "Access-Control-Allow-Origin": "*",
            },
          }
        );
      }
    }

    if (request.method === "GET" && url.pathname === "/metadata") {
      const filePath = url.searchParams.get("file");

      if (!filePath) {
        return new Response(
          JSON.stringify({
            error:
              "Missing 'file' query parameter. Usage: /metadata?file=path/to/file.mp3",
          }),
          {
            status: 400,
            headers: {
              "Content-Type": "application/json",
              "Access-Control-Allow-Origin": "*",
            },
          }
        );
      }

      try {
        const fullFilePath = join(baseDirectory, filePath);

        console.log("Getting metadata for file:", fullFilePath);

        try {
          await stat(fullFilePath);
        } catch (statError) {
          return new Response(
            JSON.stringify({
              error: "File not found",
              filePath: filePath,
            }),
            {
              status: 404,
              headers: {
                "Content-Type": "application/json",
                "Access-Control-Allow-Origin": "*",
              },
            }
          );
        }

        const metadata = await getFileMetadata(fullFilePath);

        const tags = metadata?.format?.tags || {};

        return new Response(
          JSON.stringify({
            filePath: filePath,
            fullPath: fullFilePath,
            tags: tags,
          }),
          {
            status: 200,
            headers: {
              "Content-Type": "application/json",
              "Access-Control-Allow-Origin": "*",
            },
          }
        );
      } catch (error) {
        console.error("Failed to get file metadata:", error);
        return new Response(
          JSON.stringify({
            error: "Failed to get file metadata",
            filePath: filePath,
            details: (error as Error).message,
          }),
          {
            status: 500,
            headers: {
              "Content-Type": "application/json",
              "Access-Control-Allow-Origin": "*",
            },
          }
        );
      }
    }

    if (request.method === "PATCH" && url.pathname === "/metadata") {
      try {
        const requestBody = await request.json();
        const { file: filePath, tags } = requestBody as {
          file: string;
          tags: Record<string, string>;
        };

        if (!filePath) {
          return new Response(
            JSON.stringify({
              error:
                "Missing 'file' field in request body. Usage: PATCH /metadata with body { file: 'path/to/file.mp3', tags: { ... } }",
            }),
            {
              status: 400,
              headers: {
                "Content-Type": "application/json",
                "Access-Control-Allow-Origin": "*",
              },
            }
          );
        }

        if (!tags || typeof tags !== "object") {
          return new Response(
            JSON.stringify({
              error:
                "Missing or invalid 'tags' field in request body. Tags should be an object with key-value pairs.",
            }),
            {
              status: 400,
              headers: {
                "Content-Type": "application/json",
                "Access-Control-Allow-Origin": "*",
              },
            }
          );
        }

        const fullFilePath = join(baseDirectory, filePath);

        console.log("Updating metadata for file:", fullFilePath);
        console.log("New tags:", tags);

        try {
          await stat(fullFilePath);
        } catch (statError) {
          return new Response(
            JSON.stringify({
              error: "File not found",
              filePath: filePath,
            }),
            {
              status: 404,
              headers: {
                "Content-Type": "application/json",
                "Access-Control-Allow-Origin": "*",
              },
            }
          );
        }

        await updateFileMetadata(fullFilePath, tags);

        const updatedMetadata = await getFileMetadata(fullFilePath);
        const updatedTags = updatedMetadata?.format?.tags || {};

        return new Response(
          JSON.stringify({
            success: true,
            filePath: filePath,
            fullPath: fullFilePath,
            updatedTags: updatedTags,
            message: "File metadata updated successfully",
          }),
          {
            status: 200,
            headers: {
              "Content-Type": "application/json",
              "Access-Control-Allow-Origin": "*",
            },
          }
        );
      } catch (error) {
        console.error("Failed to update file metadata:", error);
        return new Response(
          JSON.stringify({
            error: "Failed to update file metadata",
            details: (error as Error).message,
          }),
          {
            status: 500,
            headers: {
              "Content-Type": "application/json",
              "Access-Control-Allow-Origin": "*",
            },
          }
        );
      }
    }

    if (request.method === "POST" && url.pathname === "/cache/cleanup") {
      try {
        const requestBody = await request.json();
        const { daysOld } = requestBody as { daysOld?: number };

        const days = daysOld ?? 0;
        cache.cleanup(days);

        const stats = cache.getStats();

        return new Response(
          JSON.stringify({
            success: true,
            message: `Cache cleanup completed for entries older than ${days} days`,
            stats: stats,
          }),
          {
            status: 200,
            headers: {
              "Content-Type": "application/json",
              "Access-Control-Allow-Origin": "*",
            },
          }
        );
      } catch (error) {
        console.error("Failed to cleanup cache:", error);
        return new Response(
          JSON.stringify({
            error: "Failed to cleanup cache",
            details: (error as Error).message,
          }),
          {
            status: 500,
            headers: {
              "Content-Type": "application/json",
              "Access-Control-Allow-Origin": "*",
            },
          }
        );
      }
    }

    if (request.method !== "POST") {
      return new Response(
        JSON.stringify({
          error:
            "Only GET /files, GET /cache/stats, GET /metadata, PATCH /metadata, POST /cache/cleanup, and POST requests are supported.",
        }),
        {
          status: 405,
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
          },
        }
      );
    }

    try {
      const { prompt: url } = (await request.json()) as { prompt: string };
      if (!url) {
        return new Response(
          JSON.stringify({ error: "A 'prompt' with the URL is required." }),
          {
            status: 400,
            headers: {
              "Content-Type": "application/json",
              "Access-Control-Allow-Origin": "*",
            },
          }
        );
      }

      const sanitizedUrl = url
        .replace("&start_radio=1", "")
        .replace("?start_radio=1", "");

      if (isPlaylistUrl(sanitizedUrl)) {
        console.log("Processing playlist:", sanitizedUrl);

        const playlistData = await getPlaylistInfo(sanitizedUrl);
        const entries = playlistData.entries || [];

        if (entries.length === 0) {
          return new Response(
            JSON.stringify({ error: "No videos found in playlist." }),
            {
              status: 404,
              headers: {
                "Content-Type": "application/json",
                "Access-Control-Allow-Origin": "*",
              },
            }
          );
        }

        console.log(`Found ${entries.length} videos in playlist`);

        const results: MetaData[] = [];
        const errors: string[] = [];
        const batchSize = 10;

        for (
          let batchStart = 0;
          batchStart < entries.length;
          batchStart += batchSize
        ) {
          const batchEnd = Math.min(batchStart + batchSize, entries.length);
          const batch = entries.slice(batchStart, batchEnd);

          console.log(
            `Processing batch ${
              Math.floor(batchStart / batchSize) + 1
            }/${Math.ceil(entries.length / batchSize)} (videos ${
              batchStart + 1
            }-${batchEnd})`
          );

          const batchPromises = batch.map(
            async (entry: any, batchIndex: number) => {
              const globalIndex = batchStart + batchIndex;
              const videoUrl = entry.url.startsWith("http")
                ? entry.url
                : `https://www.youtube.com/watch?v=${entry.id}`;

              try {
                console.log(
                  `Processing video ${globalIndex + 1}/${entries.length}: ${
                    entry.title
                  }`
                );
                const result = await processVideo(videoUrl, globalIndex);

                if (playlistData.title && !result.album) {
                  result.album = playlistData.title;
                }

                return { success: true, result, index: globalIndex };
              } catch (error) {
                const errorMsg = `Failed to process video ${globalIndex + 1} (${
                  entry.title
                }): ${(error as Error).message}`;
                console.error(errorMsg);
                return { success: false, error: errorMsg, index: globalIndex };
              }
            }
          );

          const batchResults = await Promise.all(batchPromises);

          for (const batchResult of batchResults) {
            if (batchResult.success) {
              results.push(batchResult.result);
            } else {
              errors.push(batchResult.error);
            }
          }

          console.log(
            `Batch ${Math.floor(batchStart / batchSize) + 1} complete. ${
              results.length
            } successful so far, ${errors.length} failed so far.`
          );
        }

        console.log(
          `Playlist processing complete. ${results.length} successful, ${errors.length} failed.`
        );

        return new Response(
          JSON.stringify({
            type: "playlist",
            playlist_title: playlistData.title,
            playlist_url: sanitizedUrl,
            total_videos: entries.length,
            successful: results.length,
            failed: errors.length,
            results: results,
            errors: errors.length > 0 ? errors : undefined,
          }),
          {
            status: 200,
            headers: {
              "Content-Type": "application/json",
              "Access-Control-Allow-Origin": "*",
            },
          }
        );
      } else {
        console.log("Processing single video:", sanitizedUrl);

        try {
          const result = await processVideo(sanitizedUrl);

          return new Response(
            JSON.stringify({
              type: "single",
              ...result,
            }),
            {
              status: 200,
              headers: {
                "Content-Type": "application/json",
                "Access-Control-Allow-Origin": "*",
              },
            }
          );
        } catch (error) {
          console.error("Failed to process video:", error);

          return new Response(
            JSON.stringify({
              error: "Failed to process video",
              details: (error as Error).message,
            }),
            {
              status: 500,
              headers: {
                "Content-Type": "application/json",
                "Access-Control-Allow-Origin": "*",
              },
            }
          );
        }
      }
    } catch (error) {
      console.error("Server error:", error);
      return new Response(
        JSON.stringify({ error: "An internal server error occurred." }),
        {
          status: 500,
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
          },
        }
      );
    }
  },
  port: 3000,
  hostname: "0.0.0.0",
});

Bun.serve({
  fetch: async (req) => {
    const url = new URL(req.url);
    if (url.pathname === "/" || url.pathname === "/index.html") {
      return new Response(Bun.file("./index.html"));
    }

    return new Response("Not Found", { status: 404 });
  },
  port: 80,
  hostname: "0.0.0.0",
});

console.log("✅ Bun server listening on http://localhost:3000");
