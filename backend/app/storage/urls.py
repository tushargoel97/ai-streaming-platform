"""Central URL resolution for storage keys.

Translates internal storage keys (e.g. "transcoded/{id}/master.m3u8") into
publicly-accessible URLs based on the active environment and storage backend.

URL strategy:
  - Local storage  → /media/{key}         (nginx serves from disk)
  - Cloud + CDN    → {cdn_url}/{key}       (CDN serves from bucket origin)
  - Cloud, no CDN  → /api/v1/media/{key}   (backend streams via proxy endpoint)
"""

from app.config import settings


def resolve_media_url(storage_key: str | None) -> str:
    """Resolve a storage key to an accessible URL.

    Returns empty string for None/empty keys.
    """
    if not storage_key:
        return ""

    # If a CDN is configured, always use it (works for both local and cloud)
    if settings.cdn_url:
        base = settings.cdn_url.rstrip("/")
        return f"{base}/{storage_key}"

    # Local storage: nginx serves directly from /media/
    if settings.storage_backend == "local":
        return f"/media/{storage_key}"

    # Cloud storage without CDN: route through backend media proxy
    return f"/api/v1/media/{storage_key}"
