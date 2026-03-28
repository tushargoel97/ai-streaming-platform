"""Google Cloud Storage backend."""

from __future__ import annotations

import asyncio
import mimetypes
from typing import AsyncIterator

from app.config import settings
from app.storage.base import StorageBackend


class GCSStorageBackend(StorageBackend):
    """Store files in Google Cloud Storage.

    Uses the synchronous google-cloud-storage SDK wrapped with asyncio.to_thread()
    for async compatibility. This is the recommended pattern when the async GCS
    library isn't available or stable.
    """

    def __init__(self) -> None:
        try:
            from google.cloud import storage as gcs  # noqa: F401
        except ImportError:
            raise ImportError(
                "GCS storage backend requires google-cloud-storage. "
                "Install it with: pip install 'streaming-backend[gcs]'"
            )
        from google.cloud import storage as gcs

        if settings.gcs_credentials_path:
            self._client = gcs.Client.from_service_account_json(settings.gcs_credentials_path)
        else:
            # Uses Application Default Credentials (ADC)
            self._client = gcs.Client()

        self._bucket = self._client.bucket(settings.gcs_bucket_name)

    # ── Write ──────────────────────────────────────────────────────────────────

    async def save(self, key: str, data: bytes) -> None:
        content_type = _guess_type(key)

        def _upload():
            blob = self._bucket.blob(key)
            blob.upload_from_string(data, content_type=content_type)

        await asyncio.to_thread(_upload)

    async def save_file(self, key: str, file_path: str) -> None:
        content_type = _guess_type(key)

        def _upload():
            blob = self._bucket.blob(key)
            blob.upload_from_filename(file_path, content_type=content_type)

        await asyncio.to_thread(_upload)

    # ── Read ───────────────────────────────────────────────────────────────────

    async def get(self, key: str) -> bytes:
        def _download():
            blob = self._bucket.blob(key)
            return blob.download_as_bytes()

        return await asyncio.to_thread(_download)

    async def get_stream(self, key: str, chunk_size: int = 8192) -> AsyncIterator[bytes]:
        # GCS sync SDK doesn't support true streaming; download full blob
        # and yield in chunks. For very large files, consider gcloud-aio-storage.
        data = await self.get(key)
        for i in range(0, len(data), chunk_size):
            yield data[i : i + chunk_size]

    # ── Delete ─────────────────────────────────────────────────────────────────

    async def delete(self, key: str) -> None:
        def _delete():
            blob = self._bucket.blob(key)
            try:
                blob.delete()
            except Exception:
                pass

        await asyncio.to_thread(_delete)

    async def delete_prefix(self, prefix: str) -> None:
        def _delete_all():
            blobs = list(self._client.list_blobs(self._bucket, prefix=prefix))
            if blobs:
                self._bucket.delete_blobs(blobs)

        await asyncio.to_thread(_delete_all)

    # ── Query ──────────────────────────────────────────────────────────────────

    async def exists(self, key: str) -> bool:
        def _exists():
            return self._bucket.blob(key).exists()

        return await asyncio.to_thread(_exists)

    async def get_url(self, key: str) -> str:
        if settings.cdn_url:
            return f"{settings.cdn_url.rstrip('/')}/{key}"
        return f"/api/v1/media/{key}"

    async def list_keys(self, prefix: str) -> list[str]:
        def _list():
            return [blob.name for blob in self._client.list_blobs(self._bucket, prefix=prefix)]

        return await asyncio.to_thread(_list)

    # ── Signed URL (for direct downloads, not HLS) ────────────────────────────

    async def get_signed_url(self, key: str, expiry_minutes: int = 60) -> str:
        """Generate a signed URL for direct file access."""
        from datetime import timedelta

        def _sign():
            blob = self._bucket.blob(key)
            return blob.generate_signed_url(
                version="v4",
                expiration=timedelta(minutes=expiry_minutes),
                method="GET",
            )

        return await asyncio.to_thread(_sign)


def _guess_type(key: str) -> str:
    content_type, _ = mimetypes.guess_type(key)
    if content_type:
        return content_type
    ext = key.rsplit(".", 1)[-1].lower() if "." in key else ""
    overrides = {
        "m3u8": "application/vnd.apple.mpegurl",
        "m4s": "video/mp4",
        "ts": "video/mp2t",
        "vtt": "text/vtt",
        "webp": "image/webp",
    }
    return overrides.get(ext, "application/octet-stream")
