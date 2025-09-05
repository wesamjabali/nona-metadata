# 🎵 Nona-Metadata

<div align="center">

**An intelligent YouTube-to-music library system with AI-powered metadata extraction**

[![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?style=for-the-badge&logo=typescript&logoColor=white)](https://typescriptlang.org/)
[![Bun](https://img.shields.io/badge/Bun-000000?style=for-the-badge&logo=bun&logoColor=white)](https://bun.sh/)
[![Google AI](https://img.shields.io/badge/Google%20AI-4285F4?style=for-the-badge&logo=google&logoColor=white)](https://ai.google.dev/)
[![FFmpeg](https://img.shields.io/badge/FFmpeg-007808?style=for-the-badge&logo=ffmpeg&logoColor=white)](https://ffmpeg.org/)

*Transform YouTube videos and playlists into a beautifully organized music library with intelligent metadata*

</div>

---

## 🚀 What is Nona-Metadata?

Nona-Metadata is a powerful, AI-driven music curation system that transforms YouTube content into a perfectly organized music library. It downloads audio from YouTube videos/playlists, uses Google's Gemini AI to extract and enhance metadata, and automatically organizes files with proper tags and folder structures.

### ✨ Key Features

- 🎯 **AI-Powered Metadata Extraction** - Uses Google Gemini to intelligently identify artist, album, track info, BPM, and more
- 📁 **Automatic Organization** - Creates clean folder structures: `Artist/Album/Track.mp3`
- 🎵 **Playlist Support** - Download and organize entire YouTube playlists with track numbering
- 🏷️ **Rich Metadata Tagging** - Automatically adds title, artist, album, year, genre, language, and BPM
- 🔧 **Metadata Editor** - Web interface to view and edit metadata for existing files
- 💾 **Intelligent Caching** - SQLite-based caching system to speed up repeated requests and reduce AI API calls
- ⚡ **High Performance** - Built with Bun for lightning-fast execution
- 🌐 **RESTful API** - Clean HTTP endpoints for all operations
- 📱 **Modern Web UI** - Beautiful, responsive interface built with Tailwind CSS

## 🛠️ Tech Stack

### Core Runtime & Language
- **[Bun](https://bun.sh/)** - Ultra-fast JavaScript runtime and package manager
- **[TypeScript](https://typescriptlang.org/)** - Type-safe JavaScript with modern features

### AI & External Services
- **[Google Gemini AI](https://ai.google.dev/)** - Advanced AI for metadata extraction and song identification
- **[yt-dlp](https://github.com/yt-dlp/yt-dlp)** - Robust YouTube video/audio downloader
- **[FFmpeg](https://ffmpeg.org/)** - Audio processing and metadata manipulation

### Database & Caching
- **[SQLite](https://sqlite.org/)** - Lightweight database for intelligent caching system
- **Write-Ahead Logging (WAL)** - Optimized database performance with concurrent read/write access

### Frontend
- **HTML5** - Modern semantic markup
- **[Tailwind CSS](https://tailwindcss.com/)** - Utility-first CSS framework
- **Vanilla JavaScript** - Lightweight, dependency-free frontend

### API Architecture
- **RESTful HTTP API** - Clean endpoints for all operations
- **JSON-based communication** - Structured data exchange
- **CORS-enabled** - Cross-origin resource sharing support

## 📋 API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/` | Download and process YouTube video/playlist |
| `GET` | `/files` | List all organized music files |
| `GET` | `/metadata?file=path` | Get metadata for a specific file |
| `PATCH` | `/metadata` | Update metadata for a file |
| `GET` | `/cache/stats` | Get cache statistics and information |
| `POST` | `/cache/cleanup` | Clean up old cache entries |

## 🚀 Quick Start

### Prerequisites

Make sure you have the following installed:
- **[Bun](https://bun.sh/)** (latest version)
- **[yt-dlp](https://github.com/yt-dlp/yt-dlp)** (`pip install yt-dlp`)
- **[FFmpeg](https://ffmpeg.org/)** (for audio processing)

### Installation

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd nona-metadata
   ```

2. **Install dependencies**
   ```bash
   bun install
   ```

3. **Set up environment variables**
   ```bash
   # Create .env file
   echo "GEMINI_API_KEY=your_google_ai_api_key_here" > .env
   echo "BASE_DIR=/path/to/your/music/directory" >> .env
   ```

4. **Run the server**
   ```bash
   bun run server.ts
   ```

5. **Access the web interface**
   - API Server: http://localhost:3000
   - Web Interface: http://localhost:80

## 💡 Usage Examples

### Download a Single Video
```bash
curl -X POST http://localhost:3000/ \
  -H "Content-Type: application/json" \
  -d '{"prompt": "https://www.youtube.com/watch?v=VIDEO_ID"}'
```

### Process a Playlist
```bash
curl -X POST http://localhost:3000/ \
  -H "Content-Type: application/json" \
  -d '{"prompt": "https://www.youtube.com/playlist?list=PLAYLIST_ID"}'
```

### List Your Music Files
```bash
curl http://localhost:3000/files
```

### Get File Metadata
```bash
curl "http://localhost:3000/metadata?file=Artist/Album/Song.mp3"
```

### Update Metadata
```bash
curl -X PATCH http://localhost:3000/metadata \
  -H "Content-Type: application/json" \
  -d '{
    "file": "Artist/Album/Song.mp3",
    "tags": {
      "title": "New Title",
      "artist": "New Artist"
    }
  }'
```

### Cache Management

#### Get Cache Statistics
```bash
curl http://localhost:3000/cache/stats
```

#### Clean Up Cache (remove entries older than 30 days)
```bash
curl -X POST http://localhost:3000/cache/cleanup \
  -H "Content-Type: application/json" \
  -d '{"daysOld": 30}'
```

## 📁 Project Structure

```
nona-metadata/
├── server.ts           # Main server application
├── index.html          # Web interface
├── package.json        # Dependencies and scripts
├── tsconfig.json       # TypeScript configuration
├── bun.lock           # Dependency lock file
├── cache.sqlite       # SQLite cache database
├── cache.sqlite-shm   # SQLite shared memory file
├── cache.sqlite-wal   # SQLite write-ahead log file
└── music/             # Organized music library
    └── Artist/
        └── Album/
            └── Track.mp3
```

## 💾 Intelligent Caching System

Nona-Metadata features a sophisticated SQLite-based caching system that dramatically improves performance by storing AI-generated metadata for YouTube URLs. This reduces redundant API calls and speeds up processing of previously analyzed content.

### 🔧 How It Works

1. **Cache Storage**: When a YouTube URL is processed, the AI-generated metadata is stored in a local SQLite database
2. **Smart Retrieval**: Before making new AI requests, the system checks if metadata for the URL already exists in cache
3. **Performance Optimization**: Cache hits eliminate the need for expensive AI API calls, resulting in near-instant responses
4. **Automatic Management**: The system tracks creation dates and access times for intelligent cache maintenance

### 📊 Cache Features

- **Fast Lookups**: Indexed URL-based retrieval for millisecond response times
- **Data Persistence**: SQLite with WAL mode for reliable, concurrent access
- **Statistics Tracking**: Monitor cache usage, hit rates, and entry counts
- **Flexible Cleanup**: Remove old entries based on age or access patterns
- **Web Interface**: Built-in cache management through the web UI

### 🛠️ Cache Management

#### View Cache Statistics
- **Total Entries**: Number of cached YouTube URLs
- **Oldest Entry**: Creation date of the first cached item
- **Newest Entry**: Creation date of the most recent cached item

#### Cache Cleanup Options
- **Age-based Cleanup**: Remove entries older than specified days
- **Manual Control**: Use the web interface or API endpoints
- **Automatic Maintenance**: Configurable cleanup policies

### 💡 Benefits

- **Reduced Costs**: Fewer AI API calls mean lower usage costs
- **Faster Processing**: Instant metadata retrieval for cached URLs
- **Improved Reliability**: Less dependency on external AI services
- **Better User Experience**: Quicker response times for repeat requests

## 🎵 How It Works

1. **Input**: Provide a YouTube URL (video or playlist)
2. **Cache Check**: System first checks if metadata for this URL already exists in cache
3. **Download**: yt-dlp extracts audio as MP3 (if not cached)
4. **AI Analysis**: Gemini AI analyzes video metadata and searches for accurate song information (if not cached)
5. **Cache Storage**: AI-generated metadata is stored in SQLite cache for future use
6. **Enhancement**: AI corrects titles, identifies artists, albums, BPM, genres, and more
7. **Organization**: Files are automatically organized in `Artist/Album/Track.mp3` structure
8. **Tagging**: Rich metadata is embedded directly into MP3 files
9. **Management**: Use the web interface to browse, edit your library, and manage cache

## 🔧 Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `GEMINI_API_KEY` | Google AI API key for metadata extraction | Required |
| `BASE_DIR` | Directory where music files are organized | `/music` |

### Database Files

The application automatically creates and manages the following SQLite database files:
- `cache.sqlite` - Main cache database
- `cache.sqlite-shm` - Shared memory file for WAL mode
- `cache.sqlite-wal` - Write-ahead log for concurrent access

### System Dependencies

- **yt-dlp**: `python3 -m pip install -U yt-dlp`
- **FFmpeg**: Required for audio processing and metadata handling

## 🎯 Features in Detail

### AI-Powered Metadata Enhancement
- Cleans up video titles (removes "Official Video", "Lyric Video", etc.)
- Identifies primary artist (removes featured artists from main field)
- Searches for accurate album information
- Determines BPM through AI analysis
- Detects language using ISO 639-1 codes

### Smart Organization
- Sanitizes filenames for cross-platform compatibility
- Creates nested folder structures automatically
- Handles track numbering for playlist downloads
- Manages duplicate file scenarios

### Web Interface Features
- Real-time processing status
- File browser with metadata display
- In-browser metadata editor
- Cache statistics and management
- Cache cleanup controls
- Custom tag addition
- Responsive design for all devices

## 📄 License

This project is open source and available under the MIT License.

---

<div align="center">

**Built with ❤️ using Bun, TypeScript, and Google AI**

*Transform your YouTube discoveries into a professional music library*

</div>
