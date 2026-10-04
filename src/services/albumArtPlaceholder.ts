/**
 * Generated cover art — the last resort of the album-art chain.
 *
 * When no provider has a trustworthy cover and the source media has no usable
 * thumbnail, the album is left visually blank in Navidrome and every other
 * client. This module draws a real image instead: a two-stop gradient whose hue
 * is derived from `hash(artist|album)` (so an artist keeps one colour across the
 * library) with the artist and album title drawn on top.
 *
 * Rendering rules that matter:
 * - ffmpeg does the drawing, with `text_shaping` on: the image it is built from
 *   already carries libharfbuzz/libfribidi, so Arabic joins and reads
 *   right-to-left instead of rendering as isolated letterforms.
 * - The fonts are vendored in `assets/fonts` rather than taken from the system:
 *   the container ships no fonts, and the same two files must be used wherever
 *   this runs.
 * - Noto Sans (Latin) and Noto Sans Arabic do not share glyph coverage and
 *   ffmpeg has no per-glyph font fallback, so a mixed-script title would render
 *   half of itself as tofu boxes. Each script run therefore gets its own line.
 *
 * A generated cover is always marked with {@link PLACEHOLDER_MARKER_FILENAME}
 * so a later run can tell it apart from a real cover and replace it if the
 * providers ever find one.
 */

import { execFile } from "child_process";
import { createHash } from "crypto";
import { promises as fs } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { fileURLToPath } from "url";

import { bufferSizes, cacheConfig } from "../config/constants.js";

const FONT_LATIN = fileURLToPath(
  new URL("../../assets/fonts/NotoSans-Bold.ttf", import.meta.url),
);
const FONT_ARABIC = fileURLToPath(
  new URL("../../assets/fonts/NotoSansArabic-Bold.ttf", import.meta.url),
);

/**
 * Generated covers are recorded here (cache volume) rather than as a file inside
 * the music folder: the library tree stays clean for Navidrome's scanner, and
 * the record tells a later backfill that this cover is replaceable.
 */
const GENERATED_COVERS_FILE = join(
  cacheConfig.directory,
  "generated-covers.json",
);

/** One recorded generated cover. */
interface GeneratedCoverRecord {
  /** The label drawn on the image, e.g. an album title. */
  label: string;
  /** ISO timestamp of when it was drawn. */
  createdAt: string;
}

/**
 * Reads the registry of generated covers.
 * @returns Album-folder-relative path -> record.
 */
async function readGeneratedCovers(): Promise<
  Record<string, GeneratedCoverRecord>
> {
  try {
    const raw = await fs.readFile(GENERATED_COVERS_FILE, "utf8");
    const parsed = JSON.parse(raw) as Record<string, GeneratedCoverRecord>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * Writes the registry of generated covers.
 * @param registry The full registry to persist.
 */
async function writeGeneratedCovers(
  registry: Record<string, GeneratedCoverRecord>,
): Promise<void> {
  try {
    await fs.mkdir(cacheConfig.directory, { recursive: true });
    await fs.writeFile(
      GENERATED_COVERS_FILE,
      `${JSON.stringify(registry, null, 2)}\n`,
      "utf8",
    );
  } catch (error) {
    console.warn("Album art: could not record the generated cover:", error);
  }
}

/**
 * Records that an album folder's cover was generated.
 * @param albumDirectory Album folder relative to the library root.
 * @param label The label drawn on the image.
 */
export async function markGeneratedCover(
  albumDirectory: string,
  label: string,
): Promise<void> {
  const registry = await readGeneratedCovers();
  registry[albumDirectory] = {
    label,
    createdAt: new Date().toISOString(),
  };
  await writeGeneratedCovers(registry);
}

/**
 * Reports whether an album folder's current cover is a generated one, i.e.
 * still worth retrying against the providers.
 * @param albumDirectory Album folder relative to the library root.
 * @returns True when the cover is known to be generated.
 */
export async function isGeneratedCover(
  albumDirectory: string,
): Promise<boolean> {
  const registry = await readGeneratedCovers();
  return Object.hasOwn(registry, albumDirectory);
}

/**
 * Drops the "this cover is generated" record, e.g. after a real cover replaced
 * it.
 * @param albumDirectory Album folder relative to the library root.
 */
export async function forgetGeneratedCover(
  albumDirectory: string,
): Promise<void> {
  const registry = await readGeneratedCovers();

  if (!Object.hasOwn(registry, albumDirectory)) {
    return;
  }

  delete registry[albumDirectory];
  await writeGeneratedCovers(registry);
}

/** Cover edge length in pixels. Square, large enough for phone-sized players. */
const COVER_SIZE = 1000;

/** Arabic-script blocks (base letters, supplements, presentation forms). */
const ARABIC_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x0600, 0x06ff],
  [0x0750, 0x077f],
  [0x08a0, 0x08ff],
  [0xfb50, 0xfdff],
  [0xfe70, 0xfeff],
];

export interface GeneratedArt {
  data: ArrayBuffer;
  contentType: string;
}

/**
 * Reports whether a character belongs to an Arabic-script block.
 * @param character A single character.
 * @returns True when the character is Arabic script.
 */
function isArabic(character: string): boolean {
  const code = character.codePointAt(0) ?? 0;
  return ARABIC_RANGES.some(([low, high]) => code >= low && code <= high);
}

/**
 * Reports whether a string needs the Arabic font.
 * @param text The text to test.
 * @returns True when at least one character is Arabic script.
 */
export function hasArabic(text: string): boolean {
  return [...text].some(isArabic);
}

/**
 * Picks the font that can actually render the text.
 * @param text The text to draw.
 * @returns Absolute path to the font file.
 */
function fontFor(text: string): string {
  return hasArabic(text) ? FONT_ARABIC : FONT_LATIN;
}

/**
 * Splits a label into one line per script run so that no line mixes scripts
 * (a mixed line would lose its Latin glyphs to tofu boxes). Separators between
 * runs are dropped; at most two runs are kept.
 * @param text The label to split.
 * @returns Non-empty lines, in their original order.
 */
export function scriptLines(text: string): string[] {
  const separators = new Set([" ", "-", "–", "—", "·", "|"]);
  const runs: string[] = [];
  let current = "";
  let currentIsArabic: boolean | null = null;

  for (const character of text.trim()) {
    if (separators.has(character)) {
      current += character;
      continue;
    }

    const arabic = isArabic(character);
    if (currentIsArabic === null || arabic === currentIsArabic) {
      current += character;
      currentIsArabic = arabic;
    } else {
      runs.push(current);
      current = character;
      currentIsArabic = arabic;
    }
  }
  runs.push(current);

  const cleaned = runs
    .map((run) => run.replace(/^[\s\-–—·|]+|[\s\-–—·|]+$/g, ""))
    .filter(Boolean);

  if (cleaned.length <= 2) {
    return cleaned;
  }

  return [cleaned[0], cleaned.slice(1).join(" ")];
}

/**
 * Derives a stable hue from the artist/album pair.
 * @param key The string to hash.
 * @returns A hue in degrees.
 */
function hueFor(key: string): number {
  const digest = createHash("sha256").update(key).digest();
  return digest.readUInt32BE(0) % 360;
}

/**
 * Converts HSL to the `0xRRGGBB` literal ffmpeg colour options expect.
 * @param hue Hue in degrees.
 * @param saturation Saturation in [0, 1].
 * @param lightness Lightness in [0, 1].
 * @returns An ffmpeg colour literal.
 */
function hslToFfmpegColor(
  hue: number,
  saturation: number,
  lightness: number,
): string {
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const hueSection = (((hue % 360) + 360) % 360) / 60;
  const secondary = chroma * (1 - Math.abs((hueSection % 2) - 1));
  const offset = lightness - chroma / 2;

  const rgb: [number, number, number] =
    hueSection < 1
      ? [chroma, secondary, 0]
      : hueSection < 2
        ? [secondary, chroma, 0]
        : hueSection < 3
          ? [0, chroma, secondary]
          : hueSection < 4
            ? [0, secondary, chroma]
            : hueSection < 5
              ? [secondary, 0, chroma]
              : [chroma, 0, secondary];

  const [red, green, blue] = rgb;

  const toByte = (value: number) =>
    Math.max(0, Math.min(255, Math.round((value + offset) * 255)))
      .toString(16)
      .padStart(2, "0")
      .toUpperCase();

  return `0x${toByte(red)}${toByte(green)}${toByte(blue)}`;
}

/**
 * Approximates the largest font size at which a label still fits the canvas.
 * @param text The label.
 * @param maxWidth Available width in pixels.
 * @param base Preferred size for a short label.
 * @param minimum Floor for very long labels.
 * @returns A font size in pixels.
 */
function fitFontSize(
  text: string,
  maxWidth: number,
  base: number,
  minimum: number,
): number {
  // Latin glyphs average wider than Arabic ones; both are estimates, which is
  // all a centring pass needs.
  const widthFactor = hasArabic(text) ? 0.5 : 0.58;
  const fitted = Math.floor(maxWidth / Math.max(text.length, 1) / widthFactor);

  return Math.max(minimum, Math.min(base, fitted));
}

/**
 * Escapes a path for use as an ffmpeg filter option value.
 * @param value The raw path.
 * @returns The escaped value.
 */
function escapeFilterValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/:/g, "\\:").replace(/'/g, "\\'");
}

/**
 * Draws a placeholder cover for an album.
 * @param artist The artist name (drawn first, largest).
 * @param label The album or track title (drawn beneath).
 * @returns The JPEG bytes, or null when rendering failed.
 */
export async function generatePlaceholderArt(
  artist: string,
  label: string,
): Promise<GeneratedArt | null> {
  const workDir = await fs.mkdtemp(join(tmpdir(), "nona-cover-"));
  const outputPath = join(workDir, "cover.jpg");

  try {
    const hue = hueFor(`${artist}|${label}`);
    const topColor = hslToFfmpegColor(hue, 0.55, 0.34);
    const bottomColor = hslToFfmpegColor(hue + 25, 0.6, 0.12);

    const lines = [
      { text: artist, base: 104, minimum: 34 },
      { text: label, base: 62, minimum: 24 },
    ].flatMap(({ text, base, minimum }) =>
      scriptLines(text).map((line) => ({
        text: line,
        size: fitFontSize(line, Math.floor(COVER_SIZE * 0.84), base, minimum),
      })),
    );

    const filters = [
      // Accent rule so the image reads as designed artwork, not a broken file.
      `drawbox=x=${(COVER_SIZE - 140) / 2}:y=${Math.floor(COVER_SIZE * 0.28)}:w=140:h=6:color=white@0.75:t=fill`,
    ];

    let y = Math.floor(COVER_SIZE * 0.34);
    for (const [index, line] of lines.entries()) {
      const textFile = join(workDir, `line${index}.txt`);
      await fs.writeFile(textFile, line.text, "utf8");

      filters.push(
        `drawtext=fontfile=${escapeFilterValue(fontFor(line.text))}` +
          `:textfile=${escapeFilterValue(textFile)}:fontsize=${line.size}` +
          `:fontcolor=white${index === 0 ? "" : "@0.82"}` +
          `:x=(w-text_w)/2:y=${y}:text_shaping=1:fix_bounds=1`,
      );
      y += line.size + 34;
    }

    await new Promise<void>((resolve, reject) => {
      execFile(
        "ffmpeg",
        [
          "-hide_banner",
          "-loglevel",
          "error",
          "-y",
          "-f",
          "lavfi",
          "-i",
          `gradients=s=${COVER_SIZE}x${COVER_SIZE}:c0=${topColor}:c1=${bottomColor}` +
            `:x0=0:y0=0:x1=${COVER_SIZE}:y1=${COVER_SIZE}:d=1`,
          "-frames:v",
          "1",
          "-vf",
          filters.join(","),
          "-q:v",
          "3",
          outputPath,
        ],
        { maxBuffer: bufferSizes.ffmpeg },
        (error, _stdout, stderr) => {
          if (error) {
            return reject(
              new Error(`Placeholder cover generation failed: ${stderr}`),
            );
          }
          resolve();
        },
      );
    });

    const rendered = await fs.readFile(outputPath);
    const data = rendered.buffer.slice(
      rendered.byteOffset,
      rendered.byteOffset + rendered.byteLength,
    ) as ArrayBuffer;

    console.log(
      `Album art: generated a placeholder cover for "${label}" by "${artist}" (${rendered.length} bytes)`,
    );

    return { data, contentType: "image/jpeg" };
  } catch (error) {
    console.warn("Album art: failed to generate a placeholder cover:", error);
    return null;
  } finally {
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}
