// Base directory for organizing music files
export const baseDirectory = process.env.BASE_DIR || "./music";
export const baseUrl = process.env.BASE_URL || "http://localhost:80";

// Cache configuration
export const cacheConfig = {
  directory: process.env.CACHE_DIR || "./cache",
  dbFile: "cache.sqlite",
} as const;

// Full cache database path
export const cacheDbPath = `${cacheConfig.directory}/${cacheConfig.dbFile}`;

// Server configuration
export const serverConfig = {
  port: parseInt(process.env.PORT || "80", 10),
  hostname: "0.0.0.0" as const,
};

// API configuration
const apiKeyEnv = process.env.GEMINI_API_KEY;
if (!apiKeyEnv) {
  throw new Error("GEMINI_API_KEY environment variable not set.");
}
export const apiKey: string = apiKeyEnv;

export const modelName = "gemini-2.5-flash";

// System instruction for the AI model
export const systemInstruction = `You are a metadata search and extraction specialist. You only return JSON.
    When a user provides a URL, use your search tool to find its metadata.
    
    This request requires deep searches with the Google Search tool for every metadata property.
    NEVER ADD \`\`\` OR ANY FORMATTING HERE.

    The user might provide some more data to give you hints as to which video they are interested in, such as the title, artist, or album. 
    These will not always be accurate, and it's your job to correct it cleanly.
    
    For title, Make sure you remove all extraneous information and focus on the key details.

    Title Example 1: Nasak - Lyric Video (English) => Nasak
    Example 2: Coldplay - Hymn for the Weekend (Official Video) => title: Hymn for the Weekend artist: coldplay

    For artist, only list one artist, the main one. Do not add features, additions, etc. Just list the primary artist.
    For bpm, you should google the beats per minute of a song. 
    For mood, analyze or search for the emotional tone of the song (e.g., "Happy", "Melancholic", "Energetic", "Chill").
    For genre, use standard music genres like "Pop", "Rock", "Hip hop", "Jazz", "Classical", "Electronic", etc. 
    For genre, make sure only the first word is capitalized. (Eg: Arabic hip-hop)
    For language, use the ISO 639-1 code.
    For album, if unknown, set to be the same as the title. DO NOT make it "Unknown Album" or anything similar.
    For album, Never add things like EP or Single or anything else. Only the album name.
    For disc, if unknown, set to 1.

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
      "mood": "STRING | null",
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
  "mood": "Dark",
  "genre": "Hip hop",
  "tags": [
    "Lil Wayne",
    "Tha Carter V",
    "Problems",
    "Hip hop"
  ],
  "language": "en"
}`;

// Buffer sizes for various operations
export const bufferSizes = {
  command: 1024 * 1024 * 5,
  ffmpeg: 1024 * 1024 * 10,
  download: 1024 * 1024 * 10,
  playlist: 1024 * 1024 * 50,
  move: 1024 * 1024,
} as const;
