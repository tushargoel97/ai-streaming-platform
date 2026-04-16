"""Dropbox cloud provider."""

from __future__ import annotations

import json
import logging
from urllib.parse import urlencode

import aiofiles
import httpx

from app.services.cloud_providers.base import CloudFile, CloudProvider, TokenSet

logger = logging.getLogger(__name__)

_AUTH_URL = "https://www.dropbox.com/oauth2/authorize"
_TOKEN_URL = "https://api.dropboxapi.com/2/oauth2/token"
_API = "https://api.dropboxapi.com/2"
_CONTENT_API = "https://content.dropboxapi.com/2"

_VIDEO_EXTENSIONS = {
    ".mp4", ".mkv", ".avi", ".mov", ".wmv", ".flv", ".webm", ".m4v", ".ts", ".mts",
}


class DropboxProvider(CloudProvider):
    name = "dropbox"
    display_name = "Dropbox"

    def get_auth_url(self, redirect_uri: str, state: str = "") -> str:
        params = {
            "client_id": self.client_id,
            "redirect_uri": redirect_uri,
            "response_type": "code",
            "token_access_type": "offline",
        }
        if state:
            params["state"] = state
        return f"{_AUTH_URL}?{urlencode(params)}"

    async def exchange_code(self, code: str, redirect_uri: str) -> TokenSet:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.post(_TOKEN_URL, data={
                "code": code,
                "grant_type": "authorization_code",
                "redirect_uri": redirect_uri,
                "client_id": self.client_id,
                "client_secret": self.client_secret,
            })
            resp.raise_for_status()
            data = resp.json()

            # Fetch account info
            acct_resp = await client.post(
                f"{_API}/users/get_current_account",
                headers={"Authorization": f"Bearer {data['access_token']}"},
            )
            acct = acct_resp.json() if acct_resp.is_success else {}

        return TokenSet(
            access_token=data["access_token"],
            refresh_token=data.get("refresh_token", ""),
            account_email=acct.get("email", ""),
            account_name=acct.get("name", {}).get("display_name", ""),
        )

    async def refresh_access_token(self, refresh_token: str) -> TokenSet:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.post(_TOKEN_URL, data={
                "refresh_token": refresh_token,
                "grant_type": "refresh_token",
                "client_id": self.client_id,
                "client_secret": self.client_secret,
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
        path = folder_id or ""
        headers = {
            "Authorization": f"Bearer {access_token}",
            "Content-Type": "application/json",
        }

        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.post(
                f"{_API}/files/list_folder",
                headers=headers,
                json={"path": path, "limit": 200},
            )
            resp.raise_for_status()
            data = resp.json()

        results: list[CloudFile] = []
        for entry in data.get("entries", []):
            is_folder = entry[".tag"] == "folder"
            name = entry["name"]

            # Filter non-video files
            if not is_folder:
                ext = ("." + name.rsplit(".", 1)[-1]).lower() if "." in name else ""
                if ext not in _VIDEO_EXTENSIONS:
                    continue

            results.append(CloudFile(
                id=entry.get("path_lower", entry.get("id", "")),
                name=name,
                is_folder=is_folder,
                size=entry.get("size"),
                modified_at=entry.get("client_modified"),
                path=entry.get("path_lower"),
            ))
        return results

    async def get_download_url(self, access_token: str, file_id: str) -> str:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.post(
                f"{_API}/files/get_temporary_link",
                headers={
                    "Authorization": f"Bearer {access_token}",
                    "Content-Type": "application/json",
                },
                json={"path": file_id},
            )
            resp.raise_for_status()
            return resp.json()["link"]

    async def download_file(self, access_token: str, file_id: str, dest_path: str) -> int:
        headers = {
            "Authorization": f"Bearer {access_token}",
            "Dropbox-API-Arg": json.dumps({"path": file_id}),
        }
        written = 0
        async with httpx.AsyncClient(timeout=600, follow_redirects=True) as client:
            async with client.stream(
                "POST", f"{_CONTENT_API}/files/download", headers=headers,
            ) as resp:
                resp.raise_for_status()
                async with aiofiles.open(dest_path, "wb") as f:
                    async for chunk in resp.aiter_bytes(chunk_size=1024 * 1024):
                        await f.write(chunk)
                        written += len(chunk)
        return written
