/**
 * Album-art matching rules.
 *
 * Every case here is a real miss that reached the live library and had to be
 * found by hand: Shabjdeed's "7ASAD" (lost to a qualifier in the release title),
 * Rim Banna's "Ya Tal'een Al Jabal" (the provider spells it "Ya Talaaen El
 * Jabal"), and the Arabic folders filed against Latin credits ("دعسوقة" vs
 * "Do3souqa"). They are scored offline against fixed candidates, so a change to
 * the matcher fails here first instead of silently degrading covers again.
 *
 *   bun test
 */

import { describe, expect, test } from "bun:test";

import {
  type AlbumArtCandidate,
  rankCandidates,
  rankTrackCandidates,
  searchTermVariants,
} from "../src/services/albumArtProviders.js";
import { musicSimilarity } from "../src/utils/musicMatching.js";

function albumCandidate(artist: string, album: string): AlbumArtCandidate {
  return {
    provider: "deezer",
    id: `${artist}:${album}`,
    artist,
    album,
    imageUrls: ["https://example.invalid/cover.jpg"],
  };
}

function trackCandidate(
  artist: string,
  track: string,
  album: string,
): AlbumArtCandidate {
  return {
    provider: "deezer",
    id: `${artist}:${track}`,
    artist,
    album,
    track,
    imageUrls: ["https://example.invalid/cover.jpg"],
  };
}

describe("album matches that must be trusted", () => {
  const cases: Array<{ why: string; query: { artist: string; album: string }; candidate: AlbumArtCandidate }> = [
    {
      why: "a release qualified by its edition (7ASAD (Live In Berlin))",
      query: { artist: "Shabjdeed", album: "7ASAD" },
      candidate: albumCandidate("Shabjdeed", "7ASAD (Live In Berlin)"),
    },
    {
      why: "an iTunes single whose title carries the format (- Single)",
      query: { artist: "Mohammed Assaf", album: "Dammi Falastini" },
      candidate: albumCandidate("Mohammad Assaf", "Dammi Falastini - Single"),
    },
    {
      why: "a transliterated artist name (Fairouz for Fairuz)",
      query: { artist: "Fairuz", album: "Li Beirut" },
      candidate: albumCandidate("Fairouz", "Li Beirut"),
    },
    {
      why: "Arabic script against its Latin credit",
      query: { artist: "دعسوقة", album: "فرنصا" },
      candidate: albumCandidate("Do3souqa", "فرنصا"),
    },
  ];

  for (const { why, query, candidate } of cases) {
    test(why, () => {
      expect(rankCandidates([candidate], query)).toHaveLength(1);
    });
  }
});

describe("track matches that must be trusted", () => {
  const cases: Array<{ why: string; query: { artist: string; track: string }; candidate: AlbumArtCandidate }> = [
    {
      why: "the provider spells the title differently (Talaaen for Tal'een)",
      query: { artist: "Rim Banna", track: "Ya Tal'een Al Jabal" },
      candidate: trackCandidate("Rim Banna", "Ya Talaaen El Jabal", "Ya Talaaen El Jabal"),
    },
    {
      why: "Arabic title, Latin-credited artist",
      query: { artist: "دعسوقة", track: "فرنصا" },
      candidate: trackCandidate("Do3souqa", "فرنصا", "فرنصا"),
    },
    {
      why: "a featured credit on the release (Fi Harb (feat. Riyadiyat))",
      query: { artist: "Shabjdeed", track: "Fi Harb" },
      candidate: trackCandidate("Shabjdeed", "Fi Harb (feat. Riyadiyat)", "Fi Harb (feat. Riyadiyat)"),
    },
    {
      why: "a transliteration cousin (Farid El Atrache for Farid al-Atrash)",
      query: { artist: "Farid al-Atrash", track: "Ya Gamil Ya Gamil" },
      candidate: trackCandidate("Farid El Atrache", "Ya Gamil Ya Gamil", "Melodies of the Nile"),
    },
  ];

  for (const { why, query, candidate } of cases) {
    test(why, () => {
      expect(rankTrackCandidates([candidate], query)).toHaveLength(1);
    });
  }
});

describe("candidates that must stay rejected", () => {
  test("a different artist recording the same song", () => {
    const query = { artist: "Rim Banna", track: "Ya Tal'een Al Jabal" };
    expect(
      rankTrackCandidates(
        [trackCandidate("Shadi Kario", "Ya Tal'in Al Jabal", "Ya Tal'in Al Jabal")],
        query,
      ),
    ).toHaveLength(0);
  });

  test("the same title by an unrelated artist", () => {
    const query = { artist: "Zeyne", album: "Wala Forsa" };
    expect(
      rankCandidates([albumCandidate("Nancy Ajram", "Wala Forsa")], query),
    ).toHaveLength(0);
  });

  test("a karaoke/cover upload of an Arabic classic", () => {
    const query = { artist: "Fadia El Hage", track: "أَيُّها الساقي إِلَيكَ المُشتَكى" };
    expect(
      rankTrackCandidates(
        [trackCandidate("voxmind music", "ايها الساقي اليك المشتكي", "أفق الروح")],
        query,
      ),
    ).toHaveLength(0);
  });

  test("an unrelated artist for an Arabic folder", () => {
    const query = { artist: "دعسوقة", track: "فرنصا" };
    expect(
      rankTrackCandidates(
        [trackCandidate("Cheb Zaki", "نتيا فرنسا داتك", "نتيا فرنسا داتك")],
        query,
      ),
    ).toHaveLength(0);
  });
});

describe("cross-script similarity", () => {
  test("Arabic names match their Latin filing", () => {
    expect(musicSimilarity("دعسوقة", "Do3souqa")).toBeGreaterThanOrEqual(0.5);
    expect(musicSimilarity("فيروز", "Fairuz")).toBeGreaterThanOrEqual(0.6);
    expect(musicSimilarity("ريم بنا", "Rim Banna")).toBeGreaterThanOrEqual(0.7);
  });

  test("different artists stay apart", () => {
    expect(musicSimilarity("شادية", "Sharifa Fadel")).toBeLessThan(0.4);
    expect(musicSimilarity("نوال الزغبي", "Nancy Ajram")).toBeLessThan(0.4);
    expect(musicSimilarity("أم كلثوم", "فيروز")).toBeLessThan(0.4);
  });
});

describe("a release title that only carries extra words", () => {
  test("scores as contained, not as a stranger", () => {
    expect(musicSimilarity("7ASAD", "7ASAD (Live In Berlin)")).toBeGreaterThanOrEqual(0.7);
    expect(musicSimilarity("Wala Forsa", "Wala Forsa")).toBe(1);
    // An article in front of the album name must not hide it either.
    expect(musicSimilarity("Beirut", "Li Beirut")).toBeGreaterThanOrEqual(0.7);
  });

  test("containment requires the words in order, adjacent", () => {
    // Both words are in the release title, but not as a run, so no containment
    // credit is given and the score is only what the other strategies produce.
    expect(musicSimilarity("Ya Jabal", "Ya Talaaen El Jabal")).toBeLessThan(0.7);
    // The run that *is* there — "Ya Talaaen" — gets the containment score.
    expect(musicSimilarity("Ya Talaaen", "Ya Talaaen El Jabal")).toBeGreaterThanOrEqual(0.7);
  });
});

describe("search term variants", () => {
  test("folds punctuation into a second attempt", () => {
    expect(searchTermVariants("Rim Banna Ya Tal'een Al Jabal")).toEqual([
      "Rim Banna Ya Tal'een Al Jabal",
      "Rim Banna Ya Taleen Al Jabal",
    ]);
  });

  test("adds nothing when there is nothing to fold", () => {
    expect(searchTermVariants("Shabjdeed Fi Harb")).toEqual(["Shabjdeed Fi Harb"]);
    expect(searchTermVariants("دعسوقة فرنصا")).toEqual(["دعسوقة فرنصا"]);
  });
});
