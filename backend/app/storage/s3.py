"""AWS S3 (and S3-compatible) storage backend."""

from __future__ import annotations

import mimetypes
from typing import AsyncIterator

from app.config import settings
from app.storage.base import StorageBackend


class S3StorageBackend(StorageBackend):
    """Store files in AWS S3 or S3-compatible services (MinIO, DigitalOcean Spaces, etc.)."""

    def __init__(self) -> None:
        try:
            import aioboto3  # noqa: F401
        except ImportError:
            raise ImportError(
                "S3 storage backend requires aioboto3. "
                "Install it with: pip install 'streaming-backend[s3]'"
            )
        import aioboto3

        self._session = aioboto3.Session(
            aws_access_key_id=settings.aws_access_key_id or None,
            aws_secret_access_key=settings.aws_secret_access_key or None,
            region_name=settings.aws_region,
        )
        self._bucket = settings.s3_bucket_name
        self._endpoint_url = settings.s3_endpoint_url or None

    def _client_kwargs(self) -> dict:
        kwargs: dict = {}
        if self._endpoint_url:
            kwargs["endpoint_url"] = self._endpoint_url
        return kwargs

    # ── Write ──────────────────────────────────────────────────────────────────

    async def save(self, key: str, data: bytes) -> None:
        content_type = _guess_type(key)
        async with self._session.client("s3", **self._client_kwargs()) as s3:
            await s3.put_object(
                Bucket=self._bucket,
                Key=key,
                Body=data,
                ContentType=content_type,
            )

    async def save_file(self, key: str, file_path: str) -> None:
        content_type = _guess_type(key)
        extra = {"ContentType": content_type}
        async with self._session.client("s3", **self._client_kwargs()) as s3:
            await s3.upload_file(file_path, self._bucket, key, ExtraArgs=extra)

    # ── Read ───────────────────────────────────────────────────────────────────

    async def get(self, key: str) -> bytes:
        async with self._session.client("s3", **self._client_kwargs()) as s3:
            resp = await s3.get_object(Bucket=self._bucket, Key=key)
            return await resp["Body"].read()

    async def get_stream(self, key: str, chunk_size: int = 8192) -> AsyncIterator[bytes]:
        async with self._session.client("s3", **self._client_kwargs()) as s3:
            resp = await s3.get_object(Bucket=self._bucket, Key=key)
            stream = resp["Body"]
            while True:
                chunk = await stream.read(chunk_size)
                if not chunk:
                    break
                yield chunk

    # ── Delete ─────────────────────────────────────────────────────────────────

    async def delete(self, key: str) -> None:
        async with self._session.client("s3", **self._client_kwargs()) as s3:
            await s3.delete_object(Bucket=self._bucket, Key=key)

    async def delete_prefix(self, prefix: str) -> None:
        async with self._session.client("s3", **self._client_kwargs()) as s3:
            paginator = s3.get_paginator("list_objects_v2")
            async for page in paginator.paginate(Bucket=self._bucket, Prefix=prefix):
                objects = page.get("Contents", [])
                if objects:
                    await s3.delete_objects(
                        Bucket=self._bucket,
                        Delete={"Objects": [{"Key": obj["Key"]} for obj in objects]},
                    )

    # ── Query ──────────────────────────────────────────────────────────────────

    async def exists(self, key: str) -> bool:
        async with self._session.client("s3", **self._client_kwargs()) as s3:
            try:
                await s3.head_object(Bucket=self._bucket, Key=key)
                return True
            except s3.exceptions.ClientError:
                return False
            except Exception:
                return False

    async def get_url(self, key: str) -> str:
        # CDN takes priority — relative paths in HLS manifests resolve correctly
        if settings.cdn_url:
            return f"{settings.cdn_url.rstrip('/')}/{key}"
        # Without CDN, presigned URLs break HLS relative paths; use the backend proxy
        return f"/api/v1/media/{key}"

    async def list_keys(self, prefix: str) -> list[str]:
        keys: list[str] = []
        async with self._session.client("s3", **self._client_kwargs()) as s3:
            paginator = s3.get_paginator("list_objects_v2")
            async for page in paginator.paginate(Bucket=self._bucket, Prefix=prefix):
                for obj in page.get("Contents", []):
                    keys.append(obj["Key"])
        return keys

    # ── Presigned URL (for direct downloads, not HLS) ──────────────────────────

    async def get_presigned_url(self, key: str, expiry: int | None = None) -> str:
        """Generate a presigned URL for direct file access.

        Useful for individual file downloads (thumbnails, subtitles).
        NOT suitable for HLS manifests (relative paths won't resolve).
        """
        exp = expiry or settings.s3_presigned_url_expiry
        async with self._session.client("s3", **self._client_kwargs()) as s3:
            url = await s3.generate_presigned_url(
                "get_object",
                Params={"Bucket": self._bucket, "Key": key},
                ExpiresIn=exp,
            )
            return url


def _guess_type(key: str) -> str:
    """Guess content type from file extension."""
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
