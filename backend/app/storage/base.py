from abc import ABC, abstractmethod
from typing import AsyncIterator


class StorageBackend(ABC):
    """Abstract base class for storage backends."""

    @abstractmethod
    async def save(self, key: str, data: bytes) -> None:
        """Save raw bytes to storage."""

    @abstractmethod
    async def save_file(self, key: str, file_path: str) -> None:
        """Save a local file to storage by path."""

    @abstractmethod
    async def get(self, key: str) -> bytes:
        """Retrieve raw bytes from storage."""

    @abstractmethod
    async def get_stream(self, key: str, chunk_size: int = 8192) -> AsyncIterator[bytes]:
        """Stream file contents in chunks."""

    @abstractmethod
    async def delete(self, key: str) -> None:
        """Delete a single key from storage."""

    @abstractmethod
    async def delete_prefix(self, prefix: str) -> None:
        """Delete all keys matching a prefix."""

    @abstractmethod
    async def exists(self, key: str) -> bool:
        """Check if a key exists in storage."""

    @abstractmethod
    async def get_url(self, key: str) -> str:
        """Get a URL for accessing the stored file."""

    @abstractmethod
    async def list_keys(self, prefix: str) -> list[str]:
        """List all keys under a prefix."""
