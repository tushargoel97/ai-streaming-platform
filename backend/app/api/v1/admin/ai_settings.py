"""Admin AI settings — configure LLM provider, models, and AI features."""

import logging
from datetime import datetime

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.permissions import require_admin
from app.config import settings
from app.database import get_db
from app.models.ai_settings import AISettings
from app.models.user import User

router = APIRouter(prefix="/admin/ai", dependencies=[Depends(require_admin)])
logger = logging.getLogger(__name__)


# ── Schemas ──

class AISettingsResponse(BaseModel):
    use_external_llm: bool
    external_provider: str
    external_api_key_set: bool  # don't expose the actual key
    external_model: str
    local_model: str
    scene_analysis_model: str
    embedding_model: str
    auto_analyze_uploads: bool
    smart_search_enabled: bool
    recommendation_reasons: bool


class AISettingsUpdate(BaseModel):
    use_external_llm: bool | None = None
    external_provider: str | None = None
    external_api_key: str | None = None
    external_model: str | None = None
    local_model: str | None = None
    scene_analysis_model: str | None = None
    auto_analyze_uploads: bool | None = None
    smart_search_enabled: bool | None = None
    recommendation_reasons: bool | None = None


class ModelInfo(BaseModel):
    name: str
    description: str
    size_mb: int
    downloaded: bool
    active: bool
    file_size_mb: float | None = None
    context_length: int | None = None


class ModelsResponse(BaseModel):
    downloaded: list[ModelInfo]
    available: list[dict]


class DownloadModelRequest(BaseModel):
    model_name: str


# ── Helpers ──

def _ai_url(path: str) -> str:
    return f"{settings.ai_service_url}{path}"


async def _get_or_create_settings(db: AsyncSession) -> AISettings:
    """Get the singleton AI settings row, creating it with defaults if missing."""
    result = await db.execute(select(AISettings))
    ai = result.scalar_one_or_none()
    if ai is None:
        ai = AISettings(updated_at=datetime.utcnow())
        db.add(ai)
        await db.flush()
    return ai


def _serialize(ai: AISettings) -> dict:
    return {
        "use_external_llm": ai.use_external_llm,
        "external_provider": ai.external_provider,
        "external_api_key_set": bool(ai.external_api_key),
        "external_model": ai.external_model,
        "local_model": ai.local_model,
        "scene_analysis_model": ai.scene_analysis_model,
        "embedding_model": ai.embedding_model,
        "auto_analyze_uploads": ai.auto_analyze_uploads,
        "smart_search_enabled": ai.smart_search_enabled,
        "recommendation_reasons": ai.recommendation_reasons,
    }


# ── Endpoints ──

@router.get("/settings", response_model=AISettingsResponse)
async def get_settings(db: AsyncSession = Depends(get_db)):
    """Get current AI configuration."""
    ai = await _get_or_create_settings(db)
    await db.commit()
    return _serialize(ai)


@router.patch("/settings", response_model=AISettingsResponse)
async def update_settings(
    body: AISettingsUpdate,
    db: AsyncSession = Depends(get_db),
):
    """Update AI configuration."""
    ai = await _get_or_create_settings(db)

    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(ai, field, value)

    ai.updated_at = datetime.utcnow()
    await db.commit()

    # If a model changed, tell the AI service to pre-load it
    for changed_model in (body.local_model, body.scene_analysis_model):
        if changed_model is not None:
            try:
                async with httpx.AsyncClient(timeout=120) as client:
                    await client.post(_ai_url("/models/load"), json={"model_name": changed_model})
            except Exception:
                logger.warning("Failed to pre-load model %s in AI service", changed_model)

    return _serialize(ai)


@router.get("/models", response_model=ModelsResponse)
async def list_models():
    """List local LLM models (downloaded and available)."""
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(_ai_url("/models"))
            resp.raise_for_status()
            data = resp.json()
            return {
                "downloaded": data.get("downloaded", []),
                "available": data.get("available", []),
            }
    except Exception:
        logger.exception("Failed to fetch models from AI service")
        raise HTTPException(502, "AI service unavailable")


@router.post("/models/download")
async def download_model(body: DownloadModelRequest):
    """Download a local LLM model."""
    try:
        async with httpx.AsyncClient(timeout=600) as client:
            resp = await client.post(
                _ai_url("/models/download"),
                json={"model_name": body.model_name},
            )
            resp.raise_for_status()
            return resp.json()
    except httpx.HTTPStatusError as e:
        raise HTTPException(e.response.status_code, e.response.text)
    except Exception:
        logger.exception("Model download failed")
        raise HTTPException(502, "AI service unavailable")


@router.post("/models/load")
async def load_model(body: DownloadModelRequest):
    """Load a model into memory."""
    try:
        async with httpx.AsyncClient(timeout=120) as client:
            resp = await client.post(
                _ai_url("/models/load"),
                json={"model_name": body.model_name},
            )
            resp.raise_for_status()
            return resp.json()
    except httpx.HTTPStatusError as e:
        raise HTTPException(e.response.status_code, e.response.text)
    except Exception:
        logger.exception("Model load failed")
        raise HTTPException(502, "AI service unavailable")


@router.delete("/models/{model_name}")
async def delete_model(model_name: str):
    """Delete a downloaded model."""
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.delete(_ai_url(f"/models/{model_name}"))
            resp.raise_for_status()
            return resp.json()
    except httpx.HTTPStatusError as e:
        raise HTTPException(e.response.status_code, e.response.text)
    except Exception:
        logger.exception("Model delete failed")
        raise HTTPException(502, "AI service unavailable")


@router.get("/health")
async def ai_health():
    """Check AI service health."""
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            resp = await client.get(_ai_url("/health"))
            resp.raise_for_status()
            return resp.json()
    except Exception:
        raise HTTPException(502, "AI service unavailable")
