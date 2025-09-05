import { execFile } from "child_process";
import { bufferSizes } from "../config/constants.js";

/**
 * Extracts metadata from an audio file using ffprobe.
 * @param filePath The path to the audio file.
 * @returns A Promise that resolves with the file's metadata.
 */
export function getFileMetadata(filePath: string): Promise<any> {
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
      { maxBuffer: bufferSizes.command },
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
export function updateFileMetadata(
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
      { maxBuffer: bufferSizes.command },
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
          { maxBuffer: bufferSizes.move },
          (mvError) => {
            if (mvError) {
              execFile(
                "rm",
                [tempFilePath],
                { maxBuffer: bufferSizes.move },
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
