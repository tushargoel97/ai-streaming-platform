from app.config import settings
from app.storage.base import StorageBackend
from app.storage.local import LocalStorageBackend

_instance: StorageBackend | None = None


def get_storage_backend() -> StorageBackend:
    """Return the configured storage backend (singleton)."""
    global _instance
    if _instance is not None:
        return _instance

    if settings.storage_backend == "local":
        _instance = LocalStorageBackend(settings.local_media_path)
    elif settings.storage_backend == "s3":
        from app.storage.s3 import S3StorageBackend

        _instance = S3StorageBackend()
    elif settings.storage_backend == "azure":
        from app.storage.azure_blob import AzureBlobStorageBackend

        _instance = AzureBlobStorageBackend()
    elif settings.storage_backend == "gcs":
        from app.storage.gcs import GCSStorageBackend

        _instance = GCSStorageBackend()
    else:
        raise ValueError(f"Unknown storage backend: {settings.storage_backend}")

    return _instance
