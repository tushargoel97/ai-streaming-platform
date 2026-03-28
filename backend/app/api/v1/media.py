"""Media proxy endpoint — streams files from any storage backend.

Used when:
  - Cloud storage is active but no CDN is configured
  - Development/staging environments without CDN
  - Fallback for any backend

For local storage in development, nginx serves files directly from /media/
and this endpoint is not needed. For production with CDN, the frontend gets
CDN URLs and this endpoint is not hit either.

This endpoint is the bridge for cloud storage without CDN — it streams
objects from S3/Azure/GCS through the backend so HLS relative paths
resolve correctly against the same origin.
"""

import mimetypes

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse

from app.storage.factory import get_storage_backend

router = APIRouter(prefix="/media", tags=["media"])

# Content type overrides for streaming-specific extensions
_CONTENT_TYPES: dict[str, str] = {
    ".m3u8": "application/vnd.apple.mpegurl",
    ".m4s": "video/mp4",
    ".ts": "video/mp2t",
    ".vtt": "text/vtt",
    ".webp": "image/webp",
    ".mp4": "video/mp4",
    ".srt": "application/x-subrip",
}


def _get_content_type(path: str) -> str:
    """Determine content type from file extension."""
    ext = ""
    if "." in path:
        ext = "." + path.rsplit(".", 1)[-1].lower()
    if ext in _CONTENT_TYPES:
        return _CONTENT_TYPES[ext]
    ct, _ = mimetypes.guess_type(path)
    return ct or "application/octet-stream"


@router.get("/{path:path}")
async def serve_media(path: str, request: Request):
    """Stream a file from the active storage backend.

    Supports:
      - Proper content-type headers for HLS/video/subtitle files
      - Cache headers (immutable for segments, no-cache for manifests)
      - CORS headers for cross-origin playback
      - HEAD requests (for player pre-flight)
    """
    storage = get_storage_backend()

    if not await storage.exists(path):
        raise HTTPException(status_code=404, detail="Not found")

    content_type = _get_content_type(path)

    # Manifests should not be cached (may update for live); segments are immutable
    if path.endswith(".m3u8"):
        cache_control = "no-cache"
    else:
        cache_control = "public, max-age=31536000, immutable"

    headers = {
        "Cache-Control": cache_control,
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
        "Access-Control-Allow-Headers": "Origin, Content-Type, Accept, Range",
    }

    # HEAD request — return headers only (player often checks content before fetching)
    if request.method == "HEAD":
        return StreamingResponse(
            iter([]),
            media_type=content_type,
            headers=headers,
        )

    async def _stream():
        async for chunk in storage.get_stream(path, chunk_size=65536):
            yield chunk

    return StreamingResponse(
        _stream(),
        media_type=content_type,
        headers=headers,
    )


@router.head("/{path:path}")
async def head_media(path: str, request: Request):
    """HEAD handler for media files (player pre-flight checks)."""
    return await serve_media(path, request)
