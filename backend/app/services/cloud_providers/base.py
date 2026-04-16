"""Base class for cloud storage providers."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime


@dataclass
class CloudFile:
    """Normalised file/folder entry from any cloud provider."""

    id: str
    name: str
    is_folder: bool
    size: int | None = None
    mime_type: str | None = None
    modified_at: str | None = None
    path: str | None = None
    thumbnail_url: str | None = None

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "name": self.name,
            "is_folder": self.is_folder,
            "size": self.size,
            "mime_type": self.mime_type,
            "modified_at": self.modified_at,
            "path": self.path,
            "thumbnail_url": self.thumbnail_url,
        }


@dataclass
class TokenSet:
    access_token: str
    refresh_token: str = ""
    expires_at: datetime | None = None
    account_email: str = ""
    account_name: str = ""


class CloudProvider:
    """Abstract base for cloud storage OAuth + file operations."""

    name: str = ""
    display_name: str = ""

    # Subclasses set these
    AUTH_URL: str = ""
    TOKEN_URL: str = ""
    SCOPES: list[str] = field(default_factory=list) if False else []

    VIDEO_MIME_PREFIXES = ("video/",)

    def __init__(self, client_id: str, client_secret: str):
        self.client_id = client_id
        self.client_secret = client_secret

    # ── OAuth ──

    def get_auth_url(self, redirect_uri: str, state: str = "") -> str:
        """Return the provider's OAuth2 authorisation URL."""
        raise NotImplementedError

    async def exchange_code(self, code: str, redirect_uri: str) -> TokenSet:
        """Exchange an authorisation code for access + refresh tokens."""
        raise NotImplementedError

    async def refresh_access_token(self, refresh_token: str) -> TokenSet:
        """Use a refresh token to get a new access token."""
        raise NotImplementedError

    # ── File operations ──

    async def list_files(
        self,
        access_token: str,
        folder_id: str | None = None,
        video_only: bool = False,
    ) -> list[CloudFile]:
        """List files/folders inside a folder (root if folder_id is None)."""
        raise NotImplementedError

    async def get_download_url(self, access_token: str, file_id: str) -> str:
        """Get a direct download URL for a file."""
        raise NotImplementedError

    async def download_file(self, access_token: str, file_id: str, dest_path: str) -> int:
        """Download a file to a local path. Returns bytes written."""
        raise NotImplementedError
