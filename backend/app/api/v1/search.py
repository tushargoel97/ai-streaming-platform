"""AI-powered search endpoint — semantic search via AI microservice + pgvector."""

import logging

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.services import ai_search_service
from app.services.ai_config import build_llm_config, get_ai_settings

router = APIRouter(prefix="/search", tags=["search"])
logger = logging.getLogger(__name__)


class AISearchRequest(BaseModel):
    query: str


class AISearchResult(BaseModel):
    video_id: str
    title: str
    reason: str


class AISearchResponse(BaseModel):
    summary: str
    results: list[AISearchResult]
    suggestions: list[str] = []


@router.post("/ai", response_model=AISearchResponse)
async def ai_search(
    body: AISearchRequest,
    db: AsyncSession = Depends(get_db),
):
    """Semantic search: embed a natural language query and find matching videos via pgvector."""
    if not body.query.strip():
        raise HTTPException(status_code=400, detail="Query cannot be empty")

    try:
        ai = await get_ai_settings(db)
        llm_config = build_llm_config(ai) if ai.smart_search_enabled else None
        result = await ai_search_service.ai_search(body.query.strip(), db, llm_config)
        return AISearchResponse(
            summary=result.get("summary", ""),
            results=[
                AISearchResult(**r)
                for r in result.get("results", [])
                if "video_id" in r and "title" in r
            ],
            suggestions=result.get("suggestions", []),
        )
    except Exception:
        logger.exception("AI search failed")
        raise HTTPException(status_code=500, detail="AI search encountered an error")
