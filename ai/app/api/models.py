"""Model management API — download, list, delete, and activate local LLM models."""

import logging

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.services.local_llm_service import (
    MODEL_CATALOG,
    delete_model,
    download_model,
    get_available_models,
    get_downloaded_models,
    load_model,
)

router = APIRouter(prefix="/models", tags=["models"])
logger = logging.getLogger(__name__)


class DownloadRequest(BaseModel):
    model_name: str


class DownloadResponse(BaseModel):
    name: str
    status: str
    path: str = ""


@router.get("")
async def list_models():
    """List all models with download status and which is active."""
    return {
        "downloaded": get_downloaded_models(),
        "available": get_available_models(),
        "catalog_models": list(MODEL_CATALOG.keys()),
    }


@router.post("/download", response_model=DownloadResponse)
async def download(body: DownloadRequest):
    """Download a model from HuggingFace."""
    try:
        result = await download_model(body.model_name)
        return DownloadResponse(
            name=result["name"],
            status=result["status"],
            path=result.get("path", ""),
        )
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception:
        logger.exception("Model download failed: %s", body.model_name)
        raise HTTPException(500, f"Failed to download model: {body.model_name}")


@router.post("/load")
async def activate_model(body: DownloadRequest):
    """Load a model into memory (downloads first if needed)."""
    try:
        await load_model(body.model_name)
        return {"status": "loaded", "model": body.model_name}
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception:
        logger.exception("Model load failed: %s", body.model_name)
        raise HTTPException(500, f"Failed to load model: {body.model_name}")


@router.delete("/{model_name}")
async def remove_model(model_name: str):
    """Delete a downloaded model."""
    if model_name not in MODEL_CATALOG:
        raise HTTPException(404, f"Unknown model: {model_name}")
    deleted = await delete_model(model_name)
    if not deleted:
        raise HTTPException(404, f"Model not downloaded: {model_name}")
    return {"status": "deleted", "model": model_name}
