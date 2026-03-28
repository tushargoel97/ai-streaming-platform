"""AI microservice — embeddings, semantic search, content analysis, and local LLM.

Local LLM runs via llama-cpp-python (no API key needed).
External providers (Claude, OpenAI) available as fallback/override via admin panel.
Embeddings always run locally via sentence-transformers (free).
"""

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import content, embeddings, health, models, search
from app.config import settings

logging.basicConfig(level=logging.INFO if not settings.debug else logging.DEBUG)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info(
        "AI service starting — embedding_model=%s, default_llm=%s, llm_provider=%s",
        settings.embedding_model_name,
        settings.default_local_model,
        settings.llm_provider,
    )
    # Pre-load embedding model on startup
    from app.services.embedding_service import generate_embedding

    await generate_embedding("warmup")
    logger.info("Embedding model warmed up")
    yield
    logger.info("AI service shutting down")


app = FastAPI(
    title="Streaming AI Service",
    description="Embeddings, semantic search, content analysis, and local LLM",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router)
app.include_router(embeddings.router)
app.include_router(search.router)
app.include_router(content.router)
app.include_router(models.router)
