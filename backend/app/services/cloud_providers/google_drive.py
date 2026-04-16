"""Google Drive cloud provider."""

from __future__ import annotations

import logging
from urllib.parse import urlencode

import aiofiles
import httpx

from app.services.cloud_providers.base import CloudFile, CloudProvider, TokenSet

logger = logging.getLogger(__name__)

_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
_TOKEN_URL = "https://oauth2.googleapis.com/token"
_API = "https://www.googleapis.com/drive/v3"
_SCOPES = ["https://www.googleapis.com/auth/drive.readonly"]


class GoogleDriveProvider(CloudProvider):
    name = "google_drive"
    display_name = "Google Drive"

    def get_auth_url(self, redirect_uri: str, state: str = "") -> str:
        params = {
            "client_id": self.client_id,
            "redirect_uri": redirect_uri,
            "response_type": "code",
            "scope": " ".join(_SCOPES),
            "access_type": "offline",
            "prompt": "consent",
        }
        if state:
            params["state"] = state
        return f"{_AUTH_URL}?{urlencode(params)}"

    async def exchange_code(self, code: str, redirect_uri: str) -> TokenSet:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.post(_TOKEN_URL, data={
                "client_id": self.client_id,
                "client_secret": self.client_secret,
                "code": code,
                "grant_type": "authorization_code",
                "redirect_uri": redirect_uri,
            })
            resp.raise_for_status()
            data = resp.json()

            # Fetch user info
            user_resp = await client.get(
                "https://www.googleapis.com/oauth2/v2/userinfo",
                headers={"Authorization": f"Bearer {data['access_token']}"},
            )
            user = user_resp.json() if user_resp.is_success else {}

        return TokenSet(
            access_token=data["access_token"],
            refresh_token=data.get("refresh_token", ""),
            account_email=user.get("email", ""),
            account_name=user.get("name", ""),
        )

    async def refresh_access_token(self, refresh_token: str) -> TokenSet:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.post(_TOKEN_URL, data={
                "client_id": self.client_id,
                "client_secret": self.client_secret,
                "refresh_token": refresh_token,
                "grant_type": "refresh_token",
            })
            resp.raise_for_status()
            data = resp.json()
        return TokenSet(
            access_token=data["access_token"],
            refresh_token=refresh_token,
        )

    async def list_files(
        self,
        access_token: str,
        folder_id: str | None = None,
        video_only: bool = False,
    ) -> list[CloudFile]:
        parent = folder_id or "root"
        q_parts = [f"'{parent}' in parents", "trashed = false"]
        if video_only:
            q_parts.append("mimeType contains 'video/'")
        else:
            q_parts.append(
                "(mimeType contains 'video/' or mimeType = 'application/vnd.google-apps.folder')"
            )

        params = {
            "q": " and ".join(q_parts),
            "fields": "files(id,name,mimeType,size,modifiedTime,thumbnailLink)",
            "pageSize": "100",
            "orderBy": "folder,name",
        }

        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.get(
                f"{_API}/files",
                params=params,
                headers={"Authorization": f"Bearer {access_token}"},
            )
            resp.raise_for_status()
            data = resp.json()

        results: list[CloudFile] = []
        for f in data.get("files", []):
            is_folder = f["mimeType"] == "application/vnd.google-apps.folder"
            results.append(CloudFile(
                id=f["id"],
                name=f["name"],
                is_folder=is_folder,
                size=int(f["size"]) if f.get("size") else None,
                mime_type=f.get("mimeType"),
                modified_at=f.get("modifiedTime"),
                thumbnail_url=f.get("thumbnailLink"),
            ))
        return results

    async def get_download_url(self, access_token: str, file_id: str) -> str:
        return f"{_API}/files/{file_id}?alt=media"

    async def download_file(self, access_token: str, file_id: str, dest_path: str) -> int:
        url = f"{_API}/files/{file_id}?alt=media"
        written = 0
        async with httpx.AsyncClient(timeout=600, follow_redirects=True) as client:
            async with client.stream(
                "GET", url, headers={"Authorization": f"Bearer {access_token}"},
            ) as resp:
                resp.raise_for_status()
                async with aiofiles.open(dest_path, "wb") as f:
                    async for chunk in resp.aiter_bytes(chunk_size=1024 * 1024):
                        await f.write(chunk)
                        written += len(chunk)
        return written
