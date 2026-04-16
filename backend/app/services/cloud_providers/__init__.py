"""Cloud storage provider integrations — Google Drive, OneDrive, Dropbox."""

from app.services.cloud_providers.base import CloudProvider, CloudFile
from app.services.cloud_providers.google_drive import GoogleDriveProvider
from app.services.cloud_providers.onedrive import OneDriveProvider
from app.services.cloud_providers.dropbox_provider import DropboxProvider

PROVIDERS: dict[str, type[CloudProvider]] = {
    "google_drive": GoogleDriveProvider,
    "onedrive": OneDriveProvider,
    "dropbox": DropboxProvider,
}


def get_provider(name: str) -> type[CloudProvider]:
    if name not in PROVIDERS:
        raise ValueError(f"Unknown cloud provider: {name}")
    return PROVIDERS[name]


__all__ = [
    "CloudProvider", "CloudFile", "PROVIDERS", "get_provider",
    "GoogleDriveProvider", "OneDriveProvider", "DropboxProvider",
]
