# StreamPlatform

A self-hosted, AI-powered video streaming platform. Upload content, transcode it to adaptive HLS, and serve it with a polished streaming UI, deployable anywhere, with AI features powered by a self-hosted LLM service rather than external AI API calls.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         Browser / Client                         │
└───────────────────────────────┬─────────────────────────────────┘
                                │ :8080
                        ┌───────▼────────┐
                        │  Nginx (RTMP)  │  HLS delivery + RTMP ingest
                        └──┬─────────┬───┘
                      :8000│    :3000│
              ┌────────────▼──┐  ┌───▼──────────┐
              │  FastAPI API  │  │  React / Vite │
              │  + Celery     │  │   Frontend    │
              └───┬──────┬────┘  └──────────────-┘
           :5432  │  :6379│  :8100│
     ┌────────────▼┐ ┌────▼──┐ ┌──▼────────────┐
     │ PostgreSQL  │ │ Redis │ │   AI Service  │
     │ + pgvector  │ │       │ │ (Ollama/vLLM) │
     └─────────────┘ └───────┘ └───────────────┘
```

### Services

| Service | Port | Description |
|---------|------|-------------|
| `nginx` | 8080 / 1935 | Reverse proxy, HLS file serving, RTMP live ingest |
| `backend` | 8000 | FastAPI REST API, auth, video metadata |
| `worker` | — | Celery worker, transcoding, AI tasks, embeddings |
| `ai` | 8100 | Local AI microservice (embeddings, scene analysis, intro detection) |
| `frontend` | 3000 | React SPA (Vite + Tailwind) |
| `postgres` | 5432 | Primary database with `pgvector` for semantic search |
| `redis` | 6379 | Task queue, SSE progress events, recommendation cache |

---

## Features

### Content & Playback
- **Adaptive HLS streaming.** FFmpeg transcodes uploads to 360p / 480p / 720p / 1080p / 4K variants automatically.
- **Auto hero banner rotation.** Cycles through featured content every 25 seconds with a live progress bar.
- **Rich streaming UI.** Hero banner, carousels, Top 10 ranked rows, portrait cards.
- **Video detail modal.** Expandable preview with episodes list (series) or "More Like This" (movies).
- **Continue watching.** Per-user watch progress tracked and displayed.
- **HLS preview on hover.** Cards show a muted clip when hovered.

### AI-Powered Features
- **Skip Intro button.** Local AI detects opening title sequences using audio fingerprinting (series) and frame analysis (all videos), runs automatically after every transcode.
- **AI scene analysis.** Picks the best preview start timestamp using a local vision model.
- **Semantic search.** Vector embeddings (pgvector) power similarity-based recommendations.
- **Metadata enrichment.** OMDB/TMDB APIs fill in ratings, descriptions, and genre on ingest.
- **Personalized recommendations.** Collaborative and content-based feed per user.

### Live Streaming
- **RTMP ingest** → HLS output via Nginx-RTMP.
- Live chat (WebSocket).
- PPV / pay-per-view support.

### Admin Panel
- Video upload & management (drag-and-drop, bulk re-transcode).
- Series / season / episode management.
- User & subscription management.
- AI settings (model selection per feature).
- Tenant / white-label configuration.
- Analytics dashboard.

### Auth
- Email + password.
- Email OTP (passwordless).
- Google / Facebook OAuth.
- Role-based access (viewer / admin / superadmin).
- Subscription tier gating.

---

## Quick Start

### Prerequisites

- [Docker](https://docs.docker.com/get-docker/) and Docker Compose v2.
- 8 GB RAM minimum, 16 GB recommended for AI features.
- FFmpeg is bundled inside the backend container.

### 1. Clone and configure

```bash
git clone <repo-url>
cd ai-streaming-platform
cp .env.example .env   # edit values as needed
```

Key `.env` variables:

```env
# Database
POSTGRES_USER=stream
POSTGRES_PASSWORD=stream
POSTGRES_DB=streamdb

# Auth
SECRET_KEY=change-me-in-production
ACCESS_TOKEN_EXPIRE_MINUTES=60

# Storage (local by default)
STORAGE_BACKEND=local
LOCAL_MEDIA_PATH=/media

# AI service
AI_SERVICE_URL=http://ai:8100

# Optional, metadata enrichment
OMDB_API_KEY=
TMDB_API_KEY=

# Optional, OAuth
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
FACEBOOK_APP_ID=
FACEBOOK_APP_SECRET=
```

### 2. Start all services

```bash
make up          # build + start (foreground)
make up-d        # build + start (background)
```

### 3. Run migrations

```bash
make db-migrate
```

### 4. Open the app

| URL | What |
|-----|------|
| http://localhost:8080 | Main app |
| http://localhost:8080/admin | Admin panel |
| http://localhost:8000/docs | API docs (Swagger) |
| http://localhost:8100/docs | AI service docs |

---

## Development

### Useful Make commands

```bash
make logs          # tail all service logs
make logs-be       # backend only
make logs-fe       # frontend only
make logs-ai       # AI service only

make shell-be      # bash inside backend container
make shell-fe      # sh inside frontend container
make shell-ai      # bash inside AI container
make shell-db      # psql session

make db-migrate              # run pending Alembic migrations
make db-revision msg="desc"  # generate new migration
make db-seed                 # seed demo content

make clean         # stop all, remove volumes and media files
```

### Media layout

All media is stored under `./media/` with a predictable per-video structure:

```
media/
  uploads/
    {video_id}/original.{ext}        ← source file
  transcoded/
    {video_id}/
      master.m3u8                    ← adaptive playlist
      360p/playlist.m3u8
      720p/playlist.m3u8
      1080p/playlist.m3u8
      subs/{lang}.vtt                ← extracted subtitles
  thumbnails/
    {video_id}/
      thumb_000.webp                 ← default thumbnail
      thumb_001.webp                 ← candidate frames
  live/                              ← HLS segments for live streams
```

To migrate an existing flat media directory to this layout:

```bash
docker compose exec backend python /app/scripts/migrate_media_layout.py --dry-run
docker compose exec backend python /app/scripts/migrate_media_layout.py
```

### Adding a new Alembic migration

```bash
make db-revision msg="add_my_column"
make db-migrate
```

### GPU-accelerated transcoding

Uncomment the relevant block in `docker-compose.yml` under the `backend` service:

```yaml
# NVIDIA
runtime: nvidia
environment:
  - NVIDIA_VISIBLE_DEVICES=all
  - NVIDIA_DRIVER_CAPABILITIES=video,compute,utility
```

Then set `FFMPEG_HWACCEL=nvenc` in `.env`.

---

## Project Structure

```
.
├── backend/               # FastAPI API + Celery worker
│   ├── app/
│   │   ├── api/v1/        # REST endpoints
│   │   ├── models/        # SQLAlchemy ORM models
│   │   ├── schemas/       # Pydantic request/response schemas
│   │   ├── services/      # Business logic
│   │   │   ├── transcode_service.py
│   │   │   ├── intro_detection.py
│   │   │   ├── scene_analysis.py
│   │   │   ├── embedding_service.py
│   │   │   └── recommendation_service.py
│   │   ├── storage/       # Local + S3 storage backends
│   │   └── worker/        # Celery tasks
│   └── migrations/        # Alembic migration versions
│
├── ai/                    # Local AI microservice (FastAPI)
│   └── app/api/
│       ├── content.py     # Intro detection, scene analysis, content tagging
│       ├── embeddings.py  # Text/video embedding generation
│       └── search.py      # Semantic search
│
├── frontend/              # React + Vite + Tailwind SPA
│   └── src/
│       ├── components/
│       │   ├── video/     # VideoCard, VideoPlayer, CarouselRow, VideoDetailModal
│       │   └── layout/    # Navbar, AppShell, AdminLayout
│       ├── pages/         # Route-level components
│       ├── stores/        # Zustand state (auth, tenant)
│       └── hooks/         # useWatchProgress, etc.
│
├── nginx/                 # Nginx + RTMP config
├── scripts/               # Migration and utility scripts
├── media/                 # Runtime media storage (git-ignored)
├── docker-compose.yml
└── Makefile
```

---

## Intro Detection

After every transcode, a background Celery task automatically detects the intro/opening sequence:

1. **Series (audio fingerprinting).** Extracts 8kHz mono PCM from up to 5 sibling episodes, hashes 2-second audio windows using 8-band energy (SHA-256), and finds the longest common audio run across all episodes.
2. **All videos (AI vision).** Samples one frame every 10 seconds from the first 4 minutes and asks the local vision model to identify where the intro ends.

Results are stored as `intro_start` / `intro_end` (seconds) on the video record and surfaced as a Skip Intro button in the player. Detection can also be triggered manually or timestamps overridden from the admin panel.

---

## Storage Backends

| Backend | Config | Notes |
|---------|--------|-------|
| Local filesystem | `STORAGE_BACKEND=local` | Default, served via Nginx |
| Amazon S3 | `STORAGE_BACKEND=s3` | Set `AWS_*` vars in `.env` |

---

## License

[MIT](LICENSE)
