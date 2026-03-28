"""Azure Blob Storage backend."""

from __future__ import annotations

import mimetypes
from typing import AsyncIterator

from app.config import settings
from app.storage.base import StorageBackend


class AzureBlobStorageBackend(StorageBackend):
    """Store files in Azure Blob Storage."""

    def __init__(self) -> None:
        try:
            from azure.storage.blob.aio import BlobServiceClient  # noqa: F401
        except ImportError:
            raise ImportError(
                "Azure Blob storage backend requires azure-storage-blob. "
                "Install it with: pip install 'streaming-backend[azure]'"
            )
        from azure.storage.blob.aio import BlobServiceClient

        self._service_client = BlobServiceClient.from_connection_string(
            settings.azure_storage_connection_string
        )
        self._container_name = settings.azure_container_name

    def _container_client(self):
        return self._service_client.get_container_client(self._container_name)

    def _blob_client(self, key: str):
        return self._service_client.get_blob_client(self._container_name, key)

    # ── Write ──────────────────────────────────────────────────────────────────

    async def save(self, key: str, data: bytes) -> None:
        content_type = _guess_type(key)
        from azure.storage.blob import ContentSettings

        blob = self._blob_client(key)
        await blob.upload_blob(
            data,
            overwrite=True,
            content_settings=ContentSettings(content_type=content_type),
        )

    async def save_file(self, key: str, file_path: str) -> None:
        content_type = _guess_type(key)
        from azure.storage.blob import ContentSettings

        blob = self._blob_client(key)
        with open(file_path, "rb") as f:
            await blob.upload_blob(
                f,
                overwrite=True,
                content_settings=ContentSettings(content_type=content_type),
            )

    # ── Read ───────────────────────────────────────────────────────────────────

    async def get(self, key: str) -> bytes:
        blob = self._blob_client(key)
        stream = await blob.download_blob()
        return await stream.readall()

    async def get_stream(self, key: str, chunk_size: int = 8192) -> AsyncIterator[bytes]:
        blob = self._blob_client(key)
        stream = await blob.download_blob()
        async for chunk in stream.chunks():
            yield chunk

    # ── Delete ─────────────────────────────────────────────────────────────────

    async def delete(self, key: str) -> None:
        blob = self._blob_client(key)
        try:
            await blob.delete_blob()
        except Exception:
            pass  # blob may not exist

    async def delete_prefix(self, prefix: str) -> None:
        container = self._container_client()
        async for blob in container.list_blobs(name_starts_with=prefix):
            await container.delete_blob(blob.name)

    # ── Query ──────────────────────────────────────────────────────────────────

    async def exists(self, key: str) -> bool:
        blob = self._blob_client(key)
        try:
            await blob.get_blob_properties()
            return True
        except Exception:
            return False

    async def get_url(self, key: str) -> str:
        if settings.cdn_url:
            return f"{settings.cdn_url.rstrip('/')}/{key}"
        return f"/api/v1/media/{key}"

    async def list_keys(self, prefix: str) -> list[str]:
        keys: list[str] = []
        container = self._container_client()
        async for blob in container.list_blobs(name_starts_with=prefix):
            keys.append(blob.name)
        return keys

    # ── SAS URL (for direct downloads, not HLS) ────────────────────────────────

    async def get_sas_url(self, key: str, expiry_hours: int = 1) -> str:
        """Generate a SAS URL for direct file access."""
        from datetime import datetime, timedelta, timezone

        from azure.storage.blob import BlobSasPermissions, generate_blob_sas

        blob = self._blob_client(key)
        props = await blob.get_blob_properties()
        sas_token = generate_blob_sas(
            account_name=self._service_client.account_name,
            container_name=self._container_name,
            blob_name=key,
            account_key=self._service_client.credential.account_key,
            permission=BlobSasPermissions(read=True),
            expiry=datetime.now(timezone.utc) + timedelta(hours=expiry_hours),
        )
        return f"{blob.url}?{sas_token}"


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
