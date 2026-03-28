import os
import shutil
from pathlib import Path
from typing import AsyncIterator

import aiofiles

from app.storage.base import StorageBackend


class LocalStorageBackend(StorageBackend):
    """Store files on the local filesystem."""

    def __init__(self, base_path: str) -> None:
        self.base_path = Path(base_path)
        self.base_path.mkdir(parents=True, exist_ok=True)

    def _resolve(self, key: str) -> Path:
        return self.base_path / key

    async def save(self, key: str, data: bytes) -> None:
        path = self._resolve(key)
        path.parent.mkdir(parents=True, exist_ok=True)
        async with aiofiles.open(path, "wb") as f:
            await f.write(data)

    async def save_file(self, key: str, file_path: str) -> None:
        dest = self._resolve(key)
        dest.parent.mkdir(parents=True, exist_ok=True)
        # Use shutil for efficiency on local filesystem
        shutil.copy2(file_path, dest)

    async def get(self, key: str) -> bytes:
        async with aiofiles.open(self._resolve(key), "rb") as f:
            return await f.read()

    async def get_stream(self, key: str, chunk_size: int = 8192) -> AsyncIterator[bytes]:
        async with aiofiles.open(self._resolve(key), "rb") as f:
            while chunk := await f.read(chunk_size):
                yield chunk

    async def delete(self, key: str) -> None:
        path = self._resolve(key)
        if path.is_file():
            path.unlink()

    async def delete_prefix(self, prefix: str) -> None:
        path = self._resolve(prefix)
        if path.is_dir():
            shutil.rmtree(path)

    async def exists(self, key: str) -> bool:
        return self._resolve(key).exists()

    async def get_url(self, key: str) -> str:
        return f"/media/{key}"

    async def list_keys(self, prefix: str) -> list[str]:
        path = self._resolve(prefix)
        if not path.is_dir():
            return []
        base = str(self.base_path)
        return [
            os.path.relpath(str(p), base)
            for p in path.rglob("*")
            if p.is_file()
        ]
