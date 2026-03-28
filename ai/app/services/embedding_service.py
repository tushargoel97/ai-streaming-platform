"""Embedding service — generates vector embeddings using sentence-transformers.

Runs the model locally (free, no API key). ~80MB model, <50ms per inference.
Model: all-MiniLM-L6-v2 (384-dim, cosine similarity optimized).
"""

import asyncio
import logging

from app.config import settings

logger = logging.getLogger(__name__)

_model = None


def _get_model():
    """Lazy-load the sentence-transformer model on first use."""
    global _model
    if _model is None:
        from sentence_transformers import SentenceTransformer

        logger.info("Loading embedding model: %s", settings.embedding_model_name)
        _model = SentenceTransformer(settings.embedding_model_name)
        logger.info("Embedding model loaded (dim=%d)", settings.embedding_dimension)
    return _model


def _encode_sync(text: str) -> list[float]:
    model = _get_model()
    embedding = model.encode(text, normalize_embeddings=True)
    return embedding.tolist()


def _encode_batch_sync(texts: list[str]) -> list[list[float]]:
    model = _get_model()
    embeddings = model.encode(texts, normalize_embeddings=True, batch_size=32)
    return embeddings.tolist()


async def generate_embedding(text: str) -> list[float]:
    """Generate embedding for a single text (async-safe)."""
    return await asyncio.to_thread(_encode_sync, text)


async def generate_embeddings(texts: list[str]) -> list[list[float]]:
    """Generate embeddings for a batch of texts (async-safe)."""
    return await asyncio.to_thread(_encode_batch_sync, texts)
