"""Facebook OAuth2 helpers — build auth URL and exchange authorization code."""

from urllib.parse import urlencode

import httpx

from app.config import settings

FACEBOOK_AUTH_URL = "https://www.facebook.com/v19.0/dialog/oauth"
FACEBOOK_TOKEN_URL = "https://graph.facebook.com/v19.0/oauth/access_token"
FACEBOOK_USERINFO_URL = "https://graph.facebook.com/v19.0/me"


def get_facebook_auth_url(state: str = "") -> str:
    params = {
        "client_id": settings.facebook_client_id,
        "redirect_uri": settings.facebook_redirect_uri,
        "response_type": "code",
        "scope": "email,public_profile",
        "state": state,
    }
    return f"{FACEBOOK_AUTH_URL}?{urlencode(params)}"


async def exchange_facebook_code(code: str) -> dict:
    """Exchange authorization code for user info.

    Returns dict with keys: email, name, picture, provider_id.
    """
    async with httpx.AsyncClient() as client:
        # Exchange code for access token
        token_resp = await client.get(
            FACEBOOK_TOKEN_URL,
            params={
                "client_id": settings.facebook_client_id,
                "client_secret": settings.facebook_client_secret,
                "code": code,
                "redirect_uri": settings.facebook_redirect_uri,
            },
        )
        token_resp.raise_for_status()
        token_data = token_resp.json()

        # Fetch user info
        userinfo_resp = await client.get(
            FACEBOOK_USERINFO_URL,
            params={
                "access_token": token_data["access_token"],
                "fields": "id,name,email,picture.type(large)",
            },
        )
        userinfo_resp.raise_for_status()
        info = userinfo_resp.json()

    picture_url = ""
    if "picture" in info and "data" in info["picture"]:
        picture_url = info["picture"]["data"].get("url", "")

    return {
        "email": info.get("email", ""),
        "name": info.get("name", ""),
        "picture": picture_url,
        "provider_id": str(info["id"]),
    }
