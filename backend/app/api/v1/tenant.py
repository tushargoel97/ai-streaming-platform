from fastapi import APIRouter, Request

router = APIRouter()

DEFAULTS = {
    "slug": "default",
    "site_name": "StreamPlatform",
    "description": "Your streaming platform",
    "logo_url": "",
    "favicon_url": "",
    "primary_color": "#E50914",
    "secondary_color": "#141414",
    "background_color": "#000000",
    "features": {
        "live_streaming": True,
        "live_chat": True,
        "recommendations": True,
        "search": True,
        "watch_history": True,
    },
    "max_content_level": "safe",
    "age_verification": "none",
}


@router.get("/tenant/config")
async def get_tenant_config(request: Request):
    tenant = getattr(request.state, "tenant", None)
    if not tenant:
        return DEFAULTS

    return {
        "id": str(tenant.id),
        "slug": tenant.slug,
        "site_name": tenant.site_name,
        "description": tenant.description,
        "logo_url": tenant.logo_url,
        "favicon_url": tenant.favicon_url,
        "primary_color": tenant.primary_color,
        "secondary_color": tenant.secondary_color,
        "background_color": tenant.background_color,
        "features": tenant.features,
        "max_content_level": tenant.max_content_level,
        "age_verification": tenant.age_verification,
    }
