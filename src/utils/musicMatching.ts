/**
 * Script-aware normalization and similarity scoring for matching music
 * metadata against provider results.
 *
 * The library mixes Latin and Arabic scripts, so this module:
 * - strips Latin accents and Arabic diacritics (tashkeel),
 * - unifies common Arabic letter variants (alef/ya/ta-marbuta/waw-hamza),
 * - removes release-format noise such as "(Deluxe Edition)" or
 *   "[Official Audio]" that providers include but our folders do not.
 *
 * Matching is deliberately conservative: providers vary wildly in quality
 * (Cover Art Archive, Discogs and free-text searches all return near-misses),
 * so callers score every candidate and only accept the best one above a
 * threshold instead of trusting the first result.
 */

/** Tokens that describe a release format rather than its musical content. */
const NOISE_TOKENS = new Set([
  "official",
  "audio",
  "video",
  "lyric",
  "lyrics",
  "visualizer",
  "visualiser",
  "hd",
  "hq",
  "mv",
  "deluxe",
  "edition",
  "remaster",
  "remastered",
  "expanded",
  "anniversary",
  "special",
  "limited",
  "bonus",
  "explicit",
  "clean",
  "complete",
  "full",
  // Format/edition qualifiers that providers append to the *release* title.
  // Without these, a real match is rejected for carrying its qualifier: Deezer's
  // "7ASAD (Live In Berlin)" by Shabjdeed scored 0.40 against the folder's
  // "7ASAD" — just under the album floor — even though it is the same artist and
  // the same record.
  "live",
  "remix",
  "remixes",
  "mix",
  "version",
  "edit",
  "instrumental",
  "acoustic",
  "session",
  "sessions",
  "unplugged",
  "concert",
  "single",
  "ep",
]);

/** Arabic letter variants that should compare equal when matching. */
const ARABIC_VARIANT_MAP: ReadonlyArray<readonly [RegExp, string]> = [
  [/[\u0622\u0623\u0625\u0671]/g, "\u0627"], // آ أ إ ٱ -> ا
  [/\u0649/g, "\u064A"], // ى -> ي
  [/\u0629/g, "\u0647"], // ة -> ه
  [/\u0624/g, "\u0648"], // ؤ -> و
  [/\u0626/g, "\u064A"], // ئ -> ي
];

/**
 * Normalizes a name for comparison across scripts and provider formats.
 * @param value The raw artist/album/title text.
 * @returns A lowercase, punctuation-free, accent-free, noise-free string.
 */
export function normalizeForMusicMatch(value: string): string {
  if (!value) {
    return "";
  }

  let result = value.normalize("NFKD").replace(/\p{M}+/gu, "");
  result = result.replace(/\u0640/g, ""); // Tatweel (kashida) is decorative.

  for (const [pattern, replacement] of ARABIC_VARIANT_MAP) {
    result = result.replace(pattern, replacement);
  }

  result = result.toLowerCase();
  result = result.replace(/&/g, " and ");
  result = result.replace(/[\u2018\u2019'`]/g, "");
  // Drop "feat. X" tails: the featured artists are not part of the artist name.
  result = result.replace(/\b(?:feat|ft|featuring)\b.*$/u, " ");
  result = result.replace(/[^\p{L}\p{N}\s]/gu, " ");

  const tokens = result.split(/\s+/).filter(Boolean);
  const meaningful = tokens.filter((token) => !NOISE_TOKENS.has(token));

  // Never let noise removal erase a title entirely (e.g. an album called "Audio").
  return (meaningful.length > 0 ? meaningful : tokens).join(" ");
}

/**
 * Dice coefficient over two multisets of tokens/characters.
 * @param a The first collection.
 * @param b The second collection.
 * @returns A similarity in [0, 1].
 */
function diceCoefficient(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) {
    return 0;
  }

  const counts = new Map<string, number>();
  for (const item of a) {
    counts.set(item, (counts.get(item) ?? 0) + 1);
  }

  let intersection = 0;
  for (const item of b) {
    const remaining = counts.get(item) ?? 0;
    if (remaining > 0) {
      counts.set(item, remaining - 1);
      intersection++;
    }
  }

  return (2 * intersection) / (a.length + b.length);
}

/** Splits a normalized string into character bigrams (unigrams when short). */
function bigrams(value: string): string[] {
  if (value.length < 2) {
    return value ? [value] : [];
  }

  const result: string[] = [];
  for (let i = 0; i < value.length - 1; i++) {
    result.push(value.slice(i, i + 2));
  }
  return result;
}

/**
 * Folds common Latin transliteration variants so that spellings of the same
 * Arabic name compare equal (e.g. "Fayrouz"/"Fairuz", "Mohammed"/"Muhammad").
 * ASCII-only, so it is a no-op for Arabic-script input.
 * @param value A normalized (lowercase) string.
 * @returns The transliteration-folded string.
 */
function foldTransliteration(value: string): string {
  return value
    .replace(/ph/g, "f")
    .replace(/kh/g, "k")
    .replace(/gh/g, "g")
    .replace(/th/g, "t")
    .replace(/sh/g, "s")
    .replace(/ch/g, "c")
    .replace(/ck/g, "k")
    .replace(/q/g, "k")
    .replace(/ou/g, "u")
    .replace(/oo/g, "u")
    .replace(/ee/g, "i")
    .replace(/y/g, "i")
    .replace(/j/g, "g")
    .replace(/(.)\1+/g, "$1");
}

/** Token Dice coefficient for two already-normalized strings. */
function tokenDiceNormalized(a: string, b: string): number {
  return diceCoefficient(
    a.split(" ").filter(Boolean),
    b.split(" ").filter(Boolean),
  );
}

/** Character-bigram Dice coefficient for two already-normalized strings. */
function bigramDiceNormalized(a: string, b: string): number {
  return diceCoefficient(bigrams(a), bigrams(b));
}

/**
 * Token-level similarity (word order/punctuation insensitive).
 * @param a The first name.
 * @param b The second name.
 * @returns A similarity in [0, 1].
 */
export function tokenSimilarity(a: string, b: string): number {
  const normalizedA = normalizeForMusicMatch(a);
  const normalizedB = normalizeForMusicMatch(b);

  return Math.max(
    tokenDiceNormalized(normalizedA, normalizedB),
    tokenDiceNormalized(
      foldTransliteration(normalizedA),
      foldTransliteration(normalizedB),
    ),
  );
}

/**
 * Character-bigram similarity, which tolerates transliteration differences and
 * small spelling mistakes that token matching misses.
 * @param a The first name.
 * @param b The second name.
 * @returns A similarity in [0, 1].
 */
export function bigramSimilarity(a: string, b: string): number {
  const normalizedA = normalizeForMusicMatch(a);
  const normalizedB = normalizeForMusicMatch(b);

  return Math.max(
    bigramDiceNormalized(normalizedA, normalizedB),
    bigramDiceNormalized(
      foldTransliteration(normalizedA),
      foldTransliteration(normalizedB),
    ),
  );
}

/** Scores a pair of already-normalized strings (all strategies combined). */
function scoreNormalizedPair(a: string, b: string): number {
  if (!a || !b) {
    return 0;
  }

  if (a === b) {
    return 1;
  }

  const shorter = a.length <= b.length ? a : b;
  const longer = a.length <= b.length ? b : a;
  const containment = longer.includes(shorter)
    ? shorter.length / longer.length
    : 0;

  return Math.max(
    tokenDiceNormalized(a, b),
    bigramDiceNormalized(a, b) * 0.95,
    containment,
  );
}

/**
 * Arabic letters mapped to the Latin form this library already uses.
 *
 * Wesam's library files the same artist under both scripts ("دعسوقة" and
 * "Do3souqa", "سناء موسى" and "Sanaa Moussa"), and a provider often credits only
 * one of them. Without a bridge the two sides compare at exactly 0, so a folder
 * in Arabic can never match its own release credited in Latin (or the reverse).
 *
 * The mapping follows the Arabic chat alphabet the library already uses for
 * numerals (ع→3, ح→7) and, wherever there is a choice, the spelling that
 * `foldTransliteration` converges on (ق→k, و→u, ي→i), so both sides fold to the
 * same skeleton.
 */
const ARABIC_TO_LATIN: ReadonlyArray<readonly [string, string]> = [
  ["ث", "th"],
  ["ش", "sh"],
  ["خ", "kh"],
  ["غ", "gh"],
  ["ذ", "dh"],
  ["ع", "3"],
  ["ح", "7"],
  ["ء", "2"],
  ["ئ", "i"],
  ["ؤ", "u"],
  ["أ", "a"],
  ["إ", "a"],
  ["آ", "a"],
  ["ٱ", "a"],
  ["ا", "a"],
  ["ى", "a"],
  ["ة", "a"],
  ["و", "u"],
  ["ي", "i"],
  ["ق", "k"],
  ["ب", "b"],
  ["ت", "t"],
  ["ج", "j"],
  ["د", "d"],
  ["ر", "r"],
  ["ز", "z"],
  ["س", "s"],
  ["ص", "s"],
  ["ض", "d"],
  ["ط", "t"],
  ["ظ", "dh"],
  ["ف", "f"],
  ["ك", "k"],
  ["ل", "l"],
  ["م", "m"],
  ["ن", "n"],
  ["ه", "h"],
];

/**
 * Rewrites Arabic script in the Latin spelling this library uses, so an
 * Arabic-script name can be compared with a Latin one. Latin input passes
 * through untouched.
 * @param value A normalized (lowercase, diacritic-free) string.
 * @returns The same string with Arabic letters transliterated.
 */
export function transliterateArabicToLatin(value: string): string {
  let result = "";

  for (const character of value) {
    const mapped = ARABIC_TO_LATIN.find(([arabic]) => arabic === character);
    result += mapped ? mapped[1] : character;
  }

  return result;
}

/**
 * Similarity across scripts: Arabic vs Latin only compares meaningfully once the
 * Arabic side is transliterated, so that pairing gets its own attempt.
 * @param a A normalized string.
 * @param b A normalized string.
 * @returns The best of the direct and transliterated comparisons.
 */
function crossScriptSimilarity(a: string, b: string): number {
  const aHasArabic = /[\u0600-\u06ff]/.test(a);
  const bHasArabic = /[\u0600-\u06ff]/.test(b);

  // Only the mismatched case is missing anything: same-script pairs are already
  // covered by the comparisons the caller makes.
  if (aHasArabic === bHasArabic) {
    return 0;
  }

  const left = foldTransliteration(transliterateArabicToLatin(a));
  const right = foldTransliteration(transliterateArabicToLatin(b));

  return scoreNormalizedPair(left, right);
}

/**
 * Combined similarity for a single metadata field. Takes the best of exact,
 * containment, token, bigram and transliteration-folded matching so that short
 * artist names ("Emel") still match long ones ("Emel Mathlouthi") and Arabic
 * names spelled with different Latin transliterations still match.
 * @param a The first name.
 * @param b The second name.
 * @returns A similarity in [0, 1].
 */
export function musicSimilarity(a: string, b: string): number {
  const normalizedA = normalizeForMusicMatch(a);
  const normalizedB = normalizeForMusicMatch(b);

  return Math.max(
    scoreNormalizedPair(normalizedA, normalizedB),
    scoreNormalizedPair(
      foldTransliteration(normalizedA),
      foldTransliteration(normalizedB),
    ),
    crossScriptSimilarity(normalizedA, normalizedB),
  );
}

/** Breakdown of how well a candidate matches the requested album. */
export interface AlbumMatchScore {
  /** Similarity of the artist names in [0, 1]. */
  artist: number;
  /** Similarity of the album titles in [0, 1]. */
  album: number;
  /** Weighted combination used for ranking in [0, 1]. */
  combined: number;
}

/**
 * Minimum artist-name similarity required before provider art is trusted.
 *
 * This gate is what keeps cover versions, remixes and tributes by *other*
 * artists out: an exact album-title match with a different artist must not be
 * accepted just because the title lined up. It is low enough to allow
 * transliteration variants ("Fayrouz" vs "Fairuz").
 */
export const MIN_ARTIST_MATCH_SCORE = 0.4;

/** Minimum album-title similarity required before provider art is trusted. */
export const MIN_ALBUM_TITLE_MATCH_SCORE = 0.45;

/**
 * Minimum track-title similarity required before track-level artwork is
 * trusted.
 *
 * Higher than the album floor on purpose: a track-level hit exists to cover a
 * *missing* album name, so nothing else corroborates it, and a provider will
 * happily return a different song by the same artist. An exact title match is
 * the normal case (providers spell tracks the way they were released), so
 * demanding one costs almost nothing and keeps lookalike titles out.
 */
export const MIN_TRACK_TITLE_MATCH_SCORE = 0.6;

/**
 * Minimum artist similarity required when the *artist name alone* drove the
 * search ("give me this artist's catalogue").
 *
 * The normal artist floor exists to let spelling variants through, and it is low
 * because the release title is doing the identifying. Here the search itself was
 * built from the artist name, so a loose artist match would return a different
 * artist's catalogue and the title floor would be the only thing left holding
 * the line. Not every transliteration cousin clears this ("فيروز" vs "Fairuz"
 * scores 0.63) — those cases are covered by the ordinary searches, which compare
 * the release title in scripts that do line up.
 */
export const MIN_ARTIST_ONLY_MATCH_SCORE = 0.7;

/**
 * Minimum weighted {@link AlbumMatchScore.combined} required before provider
 * art is trusted. Below this we prefer no art (or the video thumbnail
 * fallback) over confidently wrong art.
 */
export const MIN_ALBUM_MATCH_SCORE = 0.5;

/**
 * Scores a provider candidate against the requested artist + album.
 *
 * Artist and album are weighted equally, and callers should additionally
 * enforce {@link MIN_ARTIST_MATCH_SCORE} / {@link MIN_ALBUM_TITLE_MATCH_SCORE}
 * so that a perfect title match by the wrong artist cannot pass on weight
 * alone.
 * @param artist The requested artist name.
 * @param album The requested album title.
 * @param candidateArtist The provider's artist name.
 * @param candidateAlbum The provider's album title.
 * @returns The match score breakdown.
 */
export function scoreAlbumMatch(
  artist: string,
  album: string,
  candidateArtist: string,
  candidateAlbum: string,
): AlbumMatchScore {
  const artistScore = musicSimilarity(artist, candidateArtist);
  const albumScore = musicSimilarity(album, candidateAlbum);

  return {
    artist: artistScore,
    album: albumScore,
    combined: artistScore * 0.5 + albumScore * 0.5,
  };
}
