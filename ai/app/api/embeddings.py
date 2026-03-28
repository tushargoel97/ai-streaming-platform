"""Embedding API — generate vector embeddings for text."""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.config import settings
from app.services.embedding_service import generate_embedding, generate_embeddings

router = APIRouter(prefix="/embeddings", tags=["embeddings"])


class EmbeddingRequest(BaseModel):
    text: str | None = None
    texts: list[str] | None = None


class EmbeddingResponse(BaseModel):
    embeddings: list[list[float]]
    model: str
    dimension: int


class SingleEmbeddingResponse(BaseModel):
    embedding: list[float]
    model: str
    dimension: int


@router.post("/generate", response_model=EmbeddingResponse)
async def generate(body: EmbeddingRequest):
    """Generate embeddings for one or more texts."""
    if body.text and body.texts:
        raise HTTPException(400, "Provide either 'text' or 'texts', not both")
    if not body.text and not body.texts:
        raise HTTPException(400, "Provide 'text' or 'texts'")

    if body.text:
        emb = await generate_embedding(body.text)
        return EmbeddingResponse(
            embeddings=[emb],
            model=settings.embedding_model_name,
            dimension=settings.embedding_dimension,
        )

    embeddings = await generate_embeddings(body.texts)
    return EmbeddingResponse(
        embeddings=embeddings,
        model=settings.embedding_model_name,
        dimension=settings.embedding_dimension,
    )


@router.post("/single", response_model=SingleEmbeddingResponse)
async def generate_single(body: EmbeddingRequest):
    """Generate a single embedding — convenience endpoint."""
    if not body.text:
        raise HTTPException(400, "'text' is required")

    emb = await generate_embedding(body.text)
    return SingleEmbeddingResponse(
        embedding=emb,
        model=settings.embedding_model_name,
        dimension=settings.embedding_dimension,
    )
