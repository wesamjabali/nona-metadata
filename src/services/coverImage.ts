/**
 * Client-safe cover images.
 *
 * A stored cover is only useful if the clients that read the library can decode
 * it. Providers hand out whatever their catalogue holds — 3,000px scans,
 * 16-bit PNGs, files of tens of megabytes — and a cover no client will read is
 * worse than no cover at all: Navidrome answers such an album with its own
 * placeholder art (the blue "navidrome" disc) while the folder looks perfectly
 * correct on disk.
 *
 * So every cover is normalized on the way in, and a cover that is already
 * stored can be checked and rewritten in place:
 * at most {@link MAX_COVER_DIMENSION} on the longest side, 8 bits per channel,
 * JPEG. That is the format every client reads and the size every client wants.
 */

import { execFile } from "child_process";
import { promises as fs } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import { bufferSizes } from "../config/constants.js";

/** Longest side of a stored cover, in pixels. */
export const MAX_COVER_DIMENSION = 1200;

/** Covers above this are re-encoded even when their header looks fine. */
export const MAX_COVER_BYTES = 2 * 1024 * 1024;

/** ffmpeg's `-q:v` scale; 3 is visually lossless for cover art. */
const JPEG_QUALITY = "3";

export interface CoverImage {
  data: ArrayBuffer;
  contentType: string;
}

interface ImageProbe {
  format: "png" | "jpeg" | "other";
  width?: number;
  height?: number;
  bitDepth?: number;
}

/**
 * Reads a PNG's real header: dimensions and bit depth as stored.
 * @param bytes The image bytes.
 * @returns The probe, or null when this is not a PNG.
 */
function probePng(bytes: Buffer): ImageProbe | null {
  const isPng =
    bytes.length > 24 &&
    bytes[0] === 0x89 &&
    bytes.toString("latin1", 1, 4) === "PNG";

  if (!isPng) {
    return null;
  }

  return {
    format: "png",
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
    bitDepth: bytes[24],
  };
}

/**
 * Reads a JPEG's frame header for its dimensions and sample precision.
 *
 * Walks the marker segments rather than trusting a fixed offset: the frame
 * header sits behind however many EXIF/ICC segments the encoder wrote.
 * @param bytes The image bytes.
 * @returns The probe, or null when no frame header was found.
 */
function probeJpeg(bytes: Buffer): ImageProbe | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    return null;
  }

  let offset = 2;
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }

    const marker = bytes[offset + 1] ?? 0;
    // Start-of-frame markers, minus the DHT/JPG/DAC markers that share the range.
    const isFrameHeader =
      marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);

    if (isFrameHeader) {
      return {
        format: "jpeg",
        bitDepth: bytes[offset + 4],
        height: bytes.readUInt16BE(offset + 5),
        width: bytes.readUInt16BE(offset + 7),
      };
    }

    const segmentLength = bytes.readUInt16BE(offset + 2);
    if (segmentLength < 2) {
      break;
    }
    offset += 2 + segmentLength;
  }

  return null;
}

/**
 * Describes the image bytes well enough to decide whether clients can read them.
 * @param data The image bytes.
 * @returns The probe; `format: "other"` for anything unrecognised.
 */
function probeImage(data: ArrayBuffer): ImageProbe {
  const bytes = Buffer.from(data);

  return (
    probePng(bytes) ??
    probeJpeg(bytes) ?? { format: "other" as const }
  );
}

/**
 * Whether a cover has to be re-encoded before clients can be trusted with it.
 *
 * True for files that are too large to be cover art, for PNGs stored at more
 * than 8 bits per channel (Navidrome's decoder refuses 16-bit frames, which is
 * how a folder ended up showing the placeholder art), and for oversized frames.
 * A recognizable 8-bit JPEG or PNG inside the bounds is left alone.
 * @param data The image bytes.
 * @returns True when the image should be rewritten as a bounded 8-bit JPEG.
 */
export function coverNeedsNormalizing(data: ArrayBuffer): boolean {
  if (data.byteLength > MAX_COVER_BYTES) {
    return true;
  }

  const probe = probeImage(data);

  if (probe.format === "other") {
    // WebP is the one "other" every client here reads; anything else (GIF, BMP,
    // an unknown container) is re-encoded rather than gambled on.
    const bytes = Buffer.from(data);
    const isWebp =
      bytes.length > 12 &&
      bytes.toString("latin1", 0, 4) === "RIFF" &&
      bytes.toString("latin1", 8, 12) === "WEBP";

    return !isWebp;
  }

  if (probe.bitDepth !== 8) {
    return true;
  }

  return (
    (probe.width ?? 0) > MAX_COVER_DIMENSION ||
    (probe.height ?? 0) > MAX_COVER_DIMENSION
  );
}

/**
 * Re-encodes an image as an 8-bit JPEG no larger than the cover bound.
 *
 * Returns the input unchanged when it is already client-safe, and null when the
 * re-encode failed — callers then keep the original bytes, since a cover some
 * clients can read still beats a folder with no cover at all.
 * @param data The image bytes.
 * @param contentType The MIME type the bytes arrived with.
 * @returns The normalized image, or null when it could not be produced.
 */
export async function normalizeCoverImage(
  data: ArrayBuffer,
  contentType: string,
): Promise<CoverImage | null> {
  if (!coverNeedsNormalizing(data)) {
    return { data, contentType };
  }

  const workDir = await fs.mkdtemp(join(tmpdir(), "nona-cover-norm-"));
  const inputPath = join(workDir, "input.img");
  const outputPath = join(workDir, "cover.jpg");

  try {
    await fs.writeFile(inputPath, new Uint8Array(data));

    await new Promise<void>((resolve, reject) => {
      execFile(
        "ffmpeg",
        [
          "-hide_banner",
          "-loglevel",
          "error",
          "-y",
          "-i",
          inputPath,
          // `min()` keeps an already-small cover at its own size; the aspect
          // ratio is preserved rather than padded, so no bars are introduced.
          "-vf",
          `scale='min(${MAX_COVER_DIMENSION},iw)':'min(${MAX_COVER_DIMENSION},ih)':` +
            "force_original_aspect_ratio=decrease:flags=lanczos,format=rgb24",
          "-frames:v",
          "1",
          "-q:v",
          JPEG_QUALITY,
          outputPath,
        ],
        { maxBuffer: bufferSizes.ffmpeg },
        (error, _stdout, stderr) => {
          if (error) {
            return reject(
              new Error(`Cover normalization failed: ${stderr || error.message}`),
            );
          }
          resolve();
        },
      );
    });

    const normalized = await fs.readFile(outputPath);
    console.log(
      `Album art: normalized cover ${data.byteLength} -> ${normalized.length} bytes`,
    );

    return {
      data: normalized.buffer.slice(
        normalized.byteOffset,
        normalized.byteOffset + normalized.byteLength,
      ) as ArrayBuffer,
      contentType: "image/jpeg",
    };
  } catch (error) {
    console.warn(
      "Album art: could not normalize the cover, keeping the original bytes:",
      (error as Error).message,
    );
    return null;
  } finally {
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Rewrites an existing cover file in place when clients cannot read it.
 *
 * The old file is removed when the normalized image takes a different
 * extension, so a folder never ends up holding both its unreadable cover and
 * its readable one.
 * @param coverPath The stored cover file.
 * @returns The file now holding the cover, or null when normalization failed.
 */
export async function normalizeCoverFile(coverPath: string): Promise<string | null> {
  const bytes = await fs.readFile(coverPath);
  const data = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;

  if (!coverNeedsNormalizing(data)) {
    return coverPath;
  }

  const normalized = await normalizeCoverImage(data, "application/octet-stream");
  if (!normalized) {
    return null;
  }

  const targetPath = coverPath.replace(/\.[^.]+$/, "") + ".jpg";
  await fs.writeFile(targetPath, new Uint8Array(normalized.data));

  if (targetPath !== coverPath) {
    await fs.unlink(coverPath).catch(() => {});
  }

  return targetPath;
}
