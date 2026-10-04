/**
 * Tests for cover normalization.
 *
 * The case that reached the live library: a folder held a 53 MB, 16-bit,
 * 3277×2975 PNG. Navidrome could not decode it and answered the album with its
 * own placeholder art instead — so the album that looked fine on disk showed the
 * blue "navidrome" disc in every client.
 */

import { describe, expect, test } from "bun:test";
import { execFile } from "child_process";
import { promises as fs } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { promisify } from "util";

import {
  coverNeedsNormalizing,
  MAX_COVER_DIMENSION,
  normalizeCoverFile,
  normalizeCoverImage,
} from "../src/services/coverImage.js";

const execFileAsync = promisify(execFile);

/** Builds a PNG header with the given frame shape (no image data). */
function pngHeader(width: number, height: number, bitDepth: number): ArrayBuffer {
  const bytes = Buffer.alloc(64);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes, 0);
  bytes.write("IHDR", 12, "latin1");
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  bytes[24] = bitDepth;
  bytes[25] = 2; // truecolour; alpha does not change the decision
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

/** Builds a JPEG with one APP0 segment and a frame header of the given shape. */
function jpegHeader(width: number, height: number, precision = 8): ArrayBuffer {
  const bytes = Buffer.alloc(40);
  bytes[0] = 0xff;
  bytes[1] = 0xd8;
  bytes[2] = 0xff;
  bytes[3] = 0xe0;
  bytes.writeUInt16BE(16, 4); // APP0 segment length, including its own two bytes
  const frame = 20;
  bytes[frame] = 0xff;
  bytes[frame + 1] = 0xc0;
  bytes.writeUInt16BE(17, frame + 2);
  bytes[frame + 4] = precision;
  bytes.writeUInt16BE(height, frame + 5);
  bytes.writeUInt16BE(width, frame + 7);
  bytes[frame + 9] = 3;
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

/** Whether the container has ffmpeg, decided synchronously at import time. */
const FFMPEG_AVAILABLE = Boolean(Bun.which("ffmpeg"));

/** Renders a 16-bit PNG, the shape that broke Navidrome. */
async function renderSixteenBitPng(path: string, width: number, height: number) {
  await execFileAsync("ffmpeg", [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-f",
    "lavfi",
    "-i",
    `testsrc=size=${width}x${height}`,
    "-frames:v",
    "1",
    "-pix_fmt",
    "rgb48be",
    path,
  ]);
}

describe("coverNeedsNormalizing", () => {
  test("accepts an 8-bit PNG inside the bound", () => {
    expect(coverNeedsNormalizing(pngHeader(800, 800, 8))).toBe(false);
  });

  test("rejects a 16-bit PNG however small it is", () => {
    expect(coverNeedsNormalizing(pngHeader(600, 600, 16))).toBe(true);
  });

  test("rejects a PNG larger than the bound", () => {
    expect(
      coverNeedsNormalizing(pngHeader(MAX_COVER_DIMENSION + 1, 800, 8)),
    ).toBe(true);
  });

  test("accepts an 8-bit JPEG inside the bound", () => {
    expect(coverNeedsNormalizing(jpegHeader(1000, 1000))).toBe(false);
  });

  test("rejects an oversized or 12-bit JPEG", () => {
    expect(coverNeedsNormalizing(jpegHeader(3000, 3000))).toBe(true);
    expect(coverNeedsNormalizing(jpegHeader(500, 500, 12))).toBe(true);
  });

  test("rejects anything too large to be cover art, known format or not", () => {
    const big = new Uint8Array(3 * 1024 * 1024);
    big[0] = 0xff;
    big[1] = 0xd8; // a JPEG, but far past the size bound
    expect(coverNeedsNormalizing(big.buffer as ArrayBuffer)).toBe(true);
  });

  test("rejects an unknown container", () => {
    const bmp = Buffer.alloc(64);
    bmp.write("BM");
    expect(coverNeedsNormalizing(bmp.buffer as ArrayBuffer)).toBe(true);
  });

  test("accepts WebP, which every client here reads", () => {
    const webp = Buffer.alloc(64);
    webp.write("RIFF", 0);
    webp.write("WEBP", 8);
    expect(coverNeedsNormalizing(webp.buffer as ArrayBuffer)).toBe(false);
  });
});

describe("normalizeCoverImage", () => {
  test("leaves an already-safe image untouched", async () => {
    const safe = jpegHeader(600, 600);
    const result = await normalizeCoverImage(safe, "image/jpeg");

    expect(result?.data).toBe(safe);
    expect(result?.contentType).toBe("image/jpeg");
  });

  test.skipIf(!FFMPEG_AVAILABLE)(
    "turns a 16-bit 3277×2975 PNG into a bounded 8-bit JPEG",
    async () => {
      const workDir = await fs.mkdtemp(join(tmpdir(), "nona-cover-test-"));
      const pngPath = join(workDir, "cover.png");

      try {
        await renderSixteenBitPng(pngPath, 3277, 2975);

        const original = await fs.readFile(pngPath);
        expect(original[24]).toBe(16); // the bit depth that broke the client
        expect(coverNeedsNormalizing(original.buffer.slice(
          original.byteOffset,
          original.byteOffset + original.byteLength,
        ) as ArrayBuffer)).toBe(true);

        const normalized = await normalizeCoverImage(
          original.buffer.slice(
            original.byteOffset,
            original.byteOffset + original.byteLength,
          ) as ArrayBuffer,
          "image/png",
        );
        expect(normalized?.contentType).toBe("image/jpeg");

        const out = Buffer.from(normalized!.data);
        expect(out[0]).toBe(0xff);
        expect(out[1]).toBe(0xd8);

        const probe = jpegHeaderProbe(out);
        expect(probe.bitDepth).toBe(8);
        expect(probe.width).toBeLessThanOrEqual(MAX_COVER_DIMENSION);
        expect(probe.height).toBeLessThanOrEqual(MAX_COVER_DIMENSION);
        // 3277×2975 is landscape, so the long side is the one that shrinks.
        expect(probe.width).toBe(MAX_COVER_DIMENSION);

        expect(out.length).toBeLessThan(original.length);
        expect(coverNeedsNormalizing(normalized!.data)).toBe(false);
      } finally {
        await fs.rm(workDir, { recursive: true, force: true });
      }
    },
  );
});

describe("normalizeCoverFile", () => {
  test.skipIf(!FFMPEG_AVAILABLE)(
    "rewrites an unreadable cover file and drops the variant it replaced",
    async () => {
      const workDir = await fs.mkdtemp(join(tmpdir(), "nona-cover-file-test-"));
      const pngPath = join(workDir, "cover.png");

      try {
        await renderSixteenBitPng(pngPath, 1600, 1400);

        const result = await normalizeCoverFile(pngPath);
        expect(result).toBe(join(workDir, "cover.jpg"));

        const files = (await fs.readdir(workDir)).sort();
        expect(files).toEqual(["cover.jpg"]);

        const jpeg = await fs.readFile(result!);
        expect(jpeg[0]).toBe(0xff);
        expect(jpeg[1]).toBe(0xd8);
        expect(jpegHeaderProbe(jpeg).width).toBeLessThanOrEqual(MAX_COVER_DIMENSION);
      } finally {
        await fs.rm(workDir, { recursive: true, force: true });
      }
    },
  );

  test.skipIf(!FFMPEG_AVAILABLE)(
    "leaves a readable cover file exactly where it is",
    async () => {
      const workDir = await fs.mkdtemp(join(tmpdir(), "nona-cover-ok-test-"));
      const jpegPath = join(workDir, "cover.jpg");

      try {
        await execFileAsync("ffmpeg", [
          "-hide_banner",
          "-loglevel",
          "error",
          "-y",
          "-f",
          "lavfi",
          "-i",
          "testsrc=size=600x600",
          "-frames:v",
          "1",
          jpegPath,
        ]);
        const before = await fs.readFile(jpegPath);

        expect(await normalizeCoverFile(jpegPath)).toBe(jpegPath);
        expect((await fs.readFile(jpegPath)).equals(before)).toBe(true);
      } finally {
        await fs.rm(workDir, { recursive: true, force: true });
      }
    },
  );
});

/** Reads a JPEG's dimensions and precision back out, for assertions. */
function jpegHeaderProbe(bytes: Buffer): {
  width: number;
  height: number;
  bitDepth: number;
} {
  let offset = 2;
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }

    const marker = bytes[offset + 1] ?? 0;
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      return {
        bitDepth: bytes[offset + 4] ?? 0,
        height: bytes.readUInt16BE(offset + 5),
        width: bytes.readUInt16BE(offset + 7),
      };
    }

    const length = bytes.readUInt16BE(offset + 2);
    if (length < 2) {
      break;
    }
    offset += 2 + length;
  }

  throw new Error("no JPEG frame header found");
}
