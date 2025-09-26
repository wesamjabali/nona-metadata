import { execFile } from "child_process";
import { bufferSizes } from "../config/constants.js";

/**
 * Retry wrapper for yt-dlp operations with exponential backoff
 */
async function retryWithBackoff<T>(
  operation: () => Promise<T>,
  maxRetries: number = 3,
  baseDelay: number = 2000
): Promise<T> {
  let lastError: Error;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error as Error;

      if (!isNetworkError(error as Error)) {
        throw error;
      }

      if (attempt === maxRetries) {
        console.error(
          `yt-dlp operation failed after ${maxRetries + 1} attempts:`,
          lastError.message
        );
        throw lastError;
      }

      const delay = baseDelay * Math.pow(2, attempt);
      console.warn(
        `yt-dlp operation failed (attempt ${attempt + 1}/${
          maxRetries + 1
        }), retrying in ${delay}ms:`,
        lastError.message
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastError!;
}

/**
 * Check if an error is network-related and should be retried
 */
function isNetworkError(error: Error): boolean {
  const networkErrorMessages = [
    "handshake operation timed out",
    "timeout",
    "connection",
    "network",
    "ssl",
    "tls",
    "ECONNRESET",
    "ENOTFOUND",
    "ECONNREFUSED",
  ];

  return networkErrorMessages.some((msg) =>
    error.message.toLowerCase().includes(msg.toLowerCase())
  );
}

/**
 * Fetches playlist information from a YouTube playlist URL using yt-dlp.
 * @param playlistUrl The URL of the YouTube playlist.
 * @returns A Promise that resolves with the playlist's metadata object or rejects on error.
 */
export function getPlaylistInfo(playlistUrl: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      reject(
        new Error(
          `Playlist info request timed out after 8 seconds. This may be a large playlist or network issue.`
        )
      );
    }, 30000);

    const child = execFile(
      "yt-dlp",
      [
        "--flat-playlist",
        "--dump-json",
        "--no-warnings",
        "--socket-timeout",
        "10",
        "--playlist-end",
        "100",
        playlistUrl,
      ],
      { maxBuffer: bufferSizes.playlist },
      (error, stdout) => {
        clearTimeout(timeout);

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
            const firstEntry = entries[0];
            const playlistTitle =
              firstEntry.playlist_title ||
              firstEntry.playlist ||
              "Unknown Playlist";

            resolve({
              _type: "playlist",
              title: playlistTitle,
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
 * Fetches video metadata from a YouTube URL using yt-dlp with retry logic.
 * @param videoUrl The URL of the YouTube video.
 * @returns A Promise that resolves with the video's metadata object or rejects on error.
 */
export function getVideoInfo(videoUrl: string): Promise<any> {
  return retryWithBackoff(() => {
    return new Promise((resolve, reject) => {
      execFile(
        "yt-dlp",
        [
          "--dump-json",
          "--no-warnings",
          "--socket-timeout",
          "30",
          "--retries",
          "3",
          videoUrl,
        ],
        { maxBuffer: bufferSizes.download },
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
  });
}

/**
 * Downloads a video from a URL using yt-dlp with retry logic.
 * @param videoUrl The URL of the YouTube video.
 * @param outputPath The file path where the video should be saved.
 * @returns A Promise that resolves when the download is complete or rejects on error.
 */
export function downloadVideo(
  videoUrl: string,
  outputPath: string
): Promise<void> {
  return retryWithBackoff(() => {
    return new Promise<void>((resolve, reject) => {
      execFile(
        "yt-dlp",
        [
          "-4", // Force IPv4
          "--user-agent",
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
          "-f",
          "bestaudio[ext=m4a]/bestaudio[ext=mp3]/bestaudio[acodec=aac]/bestaudio",
          "-x",
          "--audio-format",
          "best",
          "--socket-timeout",
          "30",
          "--retries",
          "3",
          "-o",
          outputPath,
          videoUrl,
        ],
        { maxBuffer: bufferSizes.download },
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
  });
}
