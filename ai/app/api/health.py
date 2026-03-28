from fastapi import APIRouter

from app.config import settings

router = APIRouter(tags=["health"])


@router.get("/health")
async def health():
    return {
        "status": "ok",
        "service": "ai",
        "embedding_model": settings.embedding_model_name,
        "llm_provider": settings.llm_provider,
    }
