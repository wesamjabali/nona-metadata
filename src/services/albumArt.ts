import { discogsApiKey } from "../config/constants.js";

type MusicBrainzRelease = {
  id: string;
  title: string;
  "artist-credit": { artist: { name: string } }[];
  "release-group": { id: string };
};

// Rate limiting for MusicBrainz API (1 request per 2 seconds)
class MusicBrainzRateLimiter {
  private lastRequestTime: number = 0;
  private readonly requestInterval: number = 2000;

  async waitForRateLimit(): Promise<void> {
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequestTime;

    if (timeSinceLastRequest < this.requestInterval) {
      const waitTime = this.requestInterval - timeSinceLastRequest;
      console.log(
        `Rate limiting: waiting ${waitTime}ms before next MusicBrainz request...`
      );
      await new Promise((resolve) => setTimeout(resolve, waitTime));
    }

    this.lastRequestTime = Date.now();
  }
}

// Global rate limiter instance
const musicBrainzRateLimiter = new MusicBrainzRateLimiter();

/**
 * Searches the MusicBrainz API for a release group using artist + album query.
 * @param artist The artist's name.
 * @param album The album's title.
 * @returns The MusicBrainz ID (MBID) as a string, or null if not found.
 */
async function searchMusicBrainzByArtistAndAlbum(
  artist: string,
  album: string
): Promise<string | null> {
  await musicBrainzRateLimiter.waitForRateLimit();

  const musicbrainzApiUrl = "https://musicbrainz.org/ws/2/release/";

  let queryUrl = `${musicbrainzApiUrl}?query=artist:"${encodeURIComponent(
    artist
  )}" AND release:"${encodeURIComponent(album)}"&fmt=json`;

  console.log(
    `Searching MusicBrainz for: "${album}" by "${artist}" (exact match)...`
  );

  try {
    let response = await fetch(queryUrl, {
      headers: {
        "User-Agent": "Nona-metadata (contact@example.com)",
      },
    });

    if (!response.ok) {
      console.error(
        `MusicBrainz API error: ${response.status} ${response.statusText}`
      );
      return null;
    }

    let data = (await response.json()) as { releases?: MusicBrainzRelease[] };

    let release = data.releases?.find((r) => r["release-group"]?.id);

    if (release) {
      const mbid = release["release-group"].id;
      console.log(`Found MBID (exact): ${mbid}`);
      return mbid;
    }

    console.log(`Exact match failed, trying less strict search...`);
    await musicBrainzRateLimiter.waitForRateLimit();

    queryUrl = `${musicbrainzApiUrl}?query=artist:${encodeURIComponent(
      artist
    )} AND release:${encodeURIComponent(album)}&fmt=json`;

    response = await fetch(queryUrl, {
      headers: {
        "User-Agent": "Nona-metadata (contact@example.com)",
      },
    });

    if (!response.ok) {
      console.error(
        `MusicBrainz API error: ${response.status} ${response.statusText}`
      );
      return null;
    }

    data = (await response.json()) as { releases?: MusicBrainzRelease[] };
    release = data.releases?.find((r) => r["release-group"]?.id);

    if (release) {
      const mbid = release["release-group"].id;
      console.log(`Found MBID (loose): ${mbid}`);
      return mbid;
    }

    console.log("No matching album found with artist + album queries.");
    return null;
  } catch (error) {
    console.error("An error occurred while searching MusicBrainz:", error);
    return null;
  }
}

/**
 * Searches the MusicBrainz API for releases by artist only (fallback method).
 * @param artist The artist's name.
 * @param album The album's title to search for in the results.
 * @returns The MusicBrainz ID (MBID) as a string, or null if not found.
 */
async function searchMusicBrainzByArtistOnly(
  artist: string,
  album: string
): Promise<string | null> {
  await musicBrainzRateLimiter.waitForRateLimit();

  const musicbrainzApiUrl = "https://musicbrainz.org/ws/2/release/";

  const queryUrl = `${musicbrainzApiUrl}?query=artist:"${encodeURIComponent(
    artist
  )}"&fmt=json&limit=100`;

  console.log(`Fallback: Searching MusicBrainz by artist only: "${artist}"...`);

  try {
    const response = await fetch(queryUrl, {
      headers: {
        "User-Agent": "Nona-metadata (contact@example.com)",
      },
    });

    if (!response.ok) {
      console.error(
        `MusicBrainz API error: ${response.status} ${response.statusText}`
      );
      return null;
    }

    const data = (await response.json()) as { releases?: MusicBrainzRelease[] };

    if (!data.releases || data.releases.length === 0) {
      console.log("No releases found for this artist.");
      return null;
    }

    const normalizeTitle = (title: string) =>
      title
        .toLowerCase()
        .replace(/[^\w\s]/g, " ")
        .replace(/\s+/g, " ")
        .trim();

    const targetAlbum = normalizeTitle(album);

    const matchingRelease = data.releases.find((release) => {
      if (!release["release-group"]?.id) return false;

      const releaseTitle = normalizeTitle(release.title);

      if (releaseTitle === targetAlbum) {
        console.log(`Exact match found: "${release.title}" matches "${album}"`);
        return true;
      }

      if (
        releaseTitle.includes(targetAlbum) ||
        targetAlbum.includes(releaseTitle)
      ) {
        console.log(
          `Partial match found: "${release.title}" matches "${album}"`
        );
        return true;
      }

      const targetWords = targetAlbum
        .split(" ")
        .filter((word) => word.length > 2);
      const releaseWords = releaseTitle.split(" ");
      const matchingWords = targetWords.filter((word) =>
        releaseWords.some(
          (releaseWord) =>
            releaseWord.includes(word) || word.includes(releaseWord)
        )
      );

      if (matchingWords.length >= Math.min(targetWords.length, 2)) {
        console.log(
          `Fuzzy match found: "${release.title}" matches "${album}" (${matchingWords.length}/${targetWords.length} words)`
        );
        return true;
      }

      return false;
    });

    if (matchingRelease) {
      const mbid = matchingRelease["release-group"].id;
      console.log(
        `Found MBID via artist fallback: ${mbid} for "${matchingRelease.title}"`
      );
      return mbid;
    } else {
      console.log(`No matching album "${album}" found in artist's releases.`);
      return null;
    }
  } catch (error) {
    console.error(
      "An error occurred while searching MusicBrainz by artist:",
      error
    );
    return null;
  }
}

/**
 * Searches the MusicBrainz API for a release group and returns the MBID.
 * This is a necessary first step as the Cover Art Archive uses MBIDs.
 * Uses a multi-strategy approach:
 * 1. Artist + album search (strict and loose)
 * 2. Artist-only search with album matching
 * 3. Fuzzy artist name search (if needed)
 * @param artist The artist's name.
 * @param album The album's title.
 * @returns The MusicBrainz ID (MBID) as a string, or null if not found.
 */
async function searchMusicBrainz(
  artist: string,
  album: string
): Promise<string | null> {
  console.log(
    `Album art search: Starting multi-strategy search for "${album}" by "${artist}"`
  );

  let mbid = await searchMusicBrainzByArtistAndAlbum(artist, album);

  if (mbid) {
    console.log(`Album art search: Success with artist+album strategy`);
    return mbid;
  }

  console.log(
    "Album art search: Artist+album failed, trying artist-only fallback..."
  );
  mbid = await searchMusicBrainzByArtistOnly(artist, album);

  if (mbid) {
    console.log(`Album art search: Success with artist-only strategy`);
    return mbid;
  }

  console.log(
    "Album art search: Artist-only failed, trying fuzzy artist search..."
  );
  mbid = await searchMusicBrainzByFuzzyArtist(artist, album);

  if (mbid) {
    console.log(`Album art search: Success with fuzzy artist strategy`);
    return mbid;
  }

  console.log(
    `Album art search: All strategies failed for "${album}" by "${artist}"`
  );
  return null;
}

/**
 * Searches MusicBrainz with a fuzzy artist name search as a last resort.
 * @param artist The artist's name.
 * @param album The album's title.
 * @returns The MusicBrainz ID (MBID) as a string, or null if not found.
 */
async function searchMusicBrainzByFuzzyArtist(
  artist: string,
  album: string
): Promise<string | null> {
  await musicBrainzRateLimiter.waitForRateLimit();

  const musicbrainzApiUrl = "https://musicbrainz.org/ws/2/release/";

  const queryUrl = `${musicbrainzApiUrl}?query=${encodeURIComponent(
    `${artist} ${album}`
  )}&fmt=json&limit=25`;

  console.log(
    `Fuzzy search: Searching MusicBrainz with combined terms: "${artist} ${album}"...`
  );

  try {
    const response = await fetch(queryUrl, {
      headers: {
        "User-Agent": "Nona-metadata (contact@example.com)",
      },
    });

    if (!response.ok) {
      console.error(
        `MusicBrainz API error: ${response.status} ${response.statusText}`
      );
      return null;
    }

    const data = (await response.json()) as { releases?: MusicBrainzRelease[] };

    if (!data.releases || data.releases.length === 0) {
      console.log("No releases found with fuzzy search.");
      return null;
    }

    const targetArtist = artist;
    const targetAlbum = album;

    const matchingRelease = data.releases.find((release) => {
      if (!release["release-group"]?.id) return false;

      const releaseTitle = release.title;
      const artistCredit = release["artist-credit"]?.[0]?.artist?.name;
      const releaseArtist = artistCredit ?? "";

      const artistWords = targetArtist.split(" ").filter((w) => w.length > 2);
      const releaseArtistWords = releaseArtist.split(" ");
      const artistMatches = artistWords.filter((word) =>
        releaseArtistWords.some(
          (rWord) => rWord.includes(word) || word.includes(rWord)
        )
      ).length;

      const albumWords = targetAlbum.split(" ").filter((w) => w.length > 2);
      const releaseTitleWords = releaseTitle.split(" ");
      const albumMatches = albumWords.filter((word) =>
        releaseTitleWords.some(
          (rWord) => rWord.includes(word) || word.includes(rWord)
        )
      ).length;

      const hasArtistMatch = artistMatches >= Math.min(artistWords.length, 1);
      const hasAlbumMatch = albumMatches >= Math.min(albumWords.length, 1);

      if (hasArtistMatch && hasAlbumMatch) {
        console.log(
          `Fuzzy match: "${release.title}" by "${artistCredit}" matches "${album}" by "${artist}"`
        );
        return true;
      }

      return false;
    });

    if (matchingRelease) {
      const mbid = matchingRelease["release-group"].id;
      console.log(
        `Found MBID via fuzzy search: ${mbid} for "${matchingRelease.title}"`
      );
      return mbid;
    } else {
      console.log(`No fuzzy matches found for "${album}" by "${artist}".`);
      return null;
    }
  } catch (error) {
    console.error("An error occurred during fuzzy MusicBrainz search:", error);
    return null;
  }
}

/**
 * Fetches the front cover art for a given MusicBrainz ID (MBID).
 * @param mbid The MusicBrainz ID for the album or release group.
 * @returns An object with image data and content type, or null if fetching failed.
 */
async function getAlbumCover(
  mbid: string
): Promise<{ data: ArrayBuffer; contentType: string } | null> {
  const coverartArchiveUrl = `https://coverartarchive.org/release-group/${mbid}/front`;

  console.log(`Fetching album cover from Cover Art Archive...`);

  try {
    const response = await fetch(coverartArchiveUrl, {
      headers: {
        "User-Agent": "Bun Album Art Fetcher / 1.0.0 (contact@example.com)",
      },
    });

    if (!response.ok) {
      if (response.status === 404) {
        console.log("No cover art found for this MBID.");
      } else {
        console.error(
          `Cover Art Archive API error: ${response.status} ${response.statusText}`
        );
      }
      return null;
    }

    const contentType = response.headers.get("content-type") || "image/jpeg";
    const data = await response.arrayBuffer();

    console.log(`Retrieved album cover with content type: ${contentType}`);
    return { data, contentType };
  } catch (error) {
    console.error("An error occurred while fetching the cover art:", error);
    return null;
  }
}

/**
 * Determines the file extension based on content type.
 * @param contentType The MIME content type.
 * @returns The appropriate file extension.
 */
function getExtensionFromContentType(contentType: string): string {
  const lowerContentType = contentType.toLowerCase();

  if (lowerContentType.includes("image/png")) {
    return ".png";
  } else if (lowerContentType.includes("image/gif")) {
    return ".gif";
  } else if (lowerContentType.includes("image/webp")) {
    return ".webp";
  } else if (lowerContentType.includes("image/bmp")) {
    return ".bmp";
  } else if (lowerContentType.includes("image/svg")) {
    return ".svg";
  } else {
    return ".jpg";
  }
}

/**
 * Searches Discogs for album art
 * @param artist The artist's name
 * @param album The album's title
 * @returns An object with image data and content type, or null if not found
 */
async function searchDiscogsForAlbumArt(
  artist: string,
  album: string
): Promise<{ data: ArrayBuffer; contentType: string } | null> {
  if (!discogsApiKey) {
    console.log("Discogs API key not configured, skipping Discogs search");
    return null;
  }

  try {
    console.log(`Searching Discogs for "${album}" by "${artist}"...`);

    const searchUrl = `https://api.discogs.com/database/search?artist=${encodeURIComponent(
      artist
    )}&release_title=${encodeURIComponent(album)}&type=release&per_page=5`;

    const response = await fetch(searchUrl, {
      headers: {
        Authorization: `Discogs token=${discogsApiKey}`,
        "User-Agent": "Nona-metadata (contact@example.com)",
      },
    });

    if (!response.ok) {
      console.error(
        `Discogs search failed: ${response.status} ${response.statusText}`
      );
      return null;
    }

    const data = (await response.json()) as { results?: any[] };
    const results = data.results;

    if (!results || results.length === 0) {
      console.log("No Discogs results found");
      return null;
    }

    // Try to get the first result with images
    for (const result of results) {
      if (result.thumb && result.thumb !== "") {
        console.log(`Found Discogs result with thumb: ${result.thumb}`);

        // Get the full release details to access larger images
        const releaseUrl = `https://api.discogs.com/releases/${result.id}`;
        const releaseResponse = await fetch(releaseUrl, {
          headers: {
            Authorization: `Discogs key=${discogsApiKey}`,
            "User-Agent": "Nona-metadata (contact@example.com)",
          },
        });

        if (releaseResponse.ok) {
          const releaseData = (await releaseResponse.json()) as {
            images?: any[];
          };
          const images = releaseData.images;

          if (images && images.length > 0) {
            // Get the primary image or the first one
            const primaryImage =
              images.find((img: any) => img.type === "primary") || images[0];
            const imageUrl = primaryImage.uri;

            console.log(`Fetching Discogs image: ${imageUrl}`);

            const imageResponse = await fetch(imageUrl);
            if (imageResponse.ok) {
              const contentType =
                imageResponse.headers.get("content-type") || "image/jpeg";
              const data = await imageResponse.arrayBuffer();

              console.log(`Successfully retrieved album art from Discogs`);
              return { data, contentType };
            }
          }
        }

        // Fallback to thumb if full images aren't available
        const thumbResponse = await fetch(result.thumb);
        if (thumbResponse.ok) {
          const contentType =
            thumbResponse.headers.get("content-type") || "image/jpeg";
          const data = await thumbResponse.arrayBuffer();

          console.log(
            `Successfully retrieved album art thumbnail from Discogs`
          );
          return { data, contentType };
        }
      }
    }

    console.log("No suitable images found in Discogs results");
    return null;
  } catch (error) {
    console.error("Error searching Discogs:", error);
    return null;
  }
}

/**
 * Fetches album art for a given artist and album.
 * @param artist The artist's name.
 * @param album The album's title.
 * @returns An object with image data and content type, or null if not found.
 */
export async function fetchAlbumArt(
  artist: string,
  album: string
): Promise<{ data: ArrayBuffer; contentType: string } | null> {
  const mbid = await searchMusicBrainz(artist, album);

  if (mbid) {
    const coverArtResult = await getAlbumCover(mbid);
    if (coverArtResult) {
      return coverArtResult;
    } else {
      console.log(
        "No cover art found in Cover Art Archive, trying Discogs as fallback..."
      );
      return await searchDiscogsForAlbumArt(artist, album);
    }
  } else {
    console.log("No MBID found, trying Discogs as fallback...");
    return await searchDiscogsForAlbumArt(artist, album);
  }
}

/**
 * Saves album art to a file with the correct extension based on content type.
 * @param imageData The image data as ArrayBuffer.
 * @param contentType The MIME content type of the image.
 * @param basePath The base path without extension where to save the image.
 * @returns The actual file path where the image was saved, or null if failed.
 */
export async function saveAlbumArt(
  imageData: ArrayBuffer,
  contentType: string,
  basePath: string
): Promise<string | null> {
  try {
    const extension = getExtensionFromContentType(contentType);
    const filePath = basePath.replace(/\.[^.]+$/, "") + extension;

    await Bun.write(filePath, new Uint8Array(imageData));
    console.log(`Successfully saved album cover to ${filePath}`);
    return filePath;
  } catch (error) {
    console.error("Failed to write image file:", error);
    return null;
  }
}
