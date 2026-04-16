"""OneDrive (Microsoft Graph) cloud provider."""

from __future__ import annotations

import logging
from urllib.parse import urlencode

import aiofiles
import httpx

from app.services.cloud_providers.base import CloudFile, CloudProvider, TokenSet

logger = logging.getLogger(__name__)

_AUTH_URL = "https://login.microsoftonline.com/common/oauth2/v2.0/authorize"
_TOKEN_URL = "https://login.microsoftonline.com/common/oauth2/v2.0/token"
_GRAPH = "https://graph.microsoft.com/v1.0"
_SCOPES = ["Files.Read.All", "User.Read", "offline_access"]


class OneDriveProvider(CloudProvider):
    name = "onedrive"
    display_name = "OneDrive"

    def get_auth_url(self, redirect_uri: str, state: str = "") -> str:
        params = {
            "client_id": self.client_id,
            "redirect_uri": redirect_uri,
            "response_type": "code",
            "scope": " ".join(_SCOPES),
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

            user_resp = await client.get(
                f"{_GRAPH}/me",
                headers={"Authorization": f"Bearer {data['access_token']}"},
            )
            user = user_resp.json() if user_resp.is_success else {}

        return TokenSet(
            access_token=data["access_token"],
            refresh_token=data.get("refresh_token", ""),
            account_email=user.get("mail") or user.get("userPrincipalName", ""),
            account_name=user.get("displayName", ""),
        )

    async def refresh_access_token(self, refresh_token: str) -> TokenSet:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.post(_TOKEN_URL, data={
                "client_id": self.client_id,
                "client_secret": self.client_secret,
                "refresh_token": refresh_token,
                "grant_type": "refresh_token",
                "scope": " ".join(_SCOPES),
            })
            resp.raise_for_status()
            data = resp.json()
        return TokenSet(
            access_token=data["access_token"],
            refresh_token=data.get("refresh_token", refresh_token),
        )

    async def list_files(
        self,
        access_token: str,
        folder_id: str | None = None,
        video_only: bool = False,
    ) -> list[CloudFile]:
        if folder_id:
            url = f"{_GRAPH}/me/drive/items/{folder_id}/children"
        else:
            url = f"{_GRAPH}/me/drive/root/children"

        params = {
            "$select": "id,name,size,lastModifiedDateTime,folder,file,video",
            "$top": "100",
            "$orderby": "name",
        }

        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.get(
                url, params=params,
                headers={"Authorization": f"Bearer {access_token}"},
            )
            resp.raise_for_status()
            data = resp.json()

        results: list[CloudFile] = []
        for item in data.get("value", []):
            is_folder = "folder" in item
            mime = item.get("file", {}).get("mimeType", "")

            # Filter: only show folders + video files
            if not is_folder and not mime.startswith("video/"):
                if video_only:
                    continue
                # Still skip non-video files to keep the browser clean
                continue

            results.append(CloudFile(
                id=item["id"],
                name=item["name"],
                is_folder=is_folder,
                size=item.get("size"),
                mime_type=mime if not is_folder else None,
                modified_at=item.get("lastModifiedDateTime"),
            ))
        return results

    async def get_download_url(self, access_token: str, file_id: str) -> str:
        return f"{_GRAPH}/me/drive/items/{file_id}/content"

    async def download_file(self, access_token: str, file_id: str, dest_path: str) -> int:
        url = f"{_GRAPH}/me/drive/items/{file_id}/content"
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
