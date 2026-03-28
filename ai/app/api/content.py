"""Content analysis API — LLM-powered content understanding and enrichment."""

import logging

from fastapi import APIRouter
from pydantic import BaseModel

from app.services.llm_service import LLMConfig, ask_llm_json

router = APIRouter(prefix="/content", tags=["content"])
logger = logging.getLogger(__name__)

_ANALYZE_SYSTEM_PROMPT = """You are a content analyst for a video streaming platform.
Given video metadata, suggest tags, a concise description, and a content classification.

Return valid JSON:
{
  "suggested_tags": ["tag1", "tag2", ...],
  "short_description": "A concise 1-2 sentence description for the video card",
  "classification_hint": "safe" or "mature" or "explicit",
  "genre_hints": ["genre1", "genre2"],
  "mood": "exciting" or "relaxing" or "dramatic" or "funny" or "dark" or "uplifting" or "suspenseful"
}

Content classification guide:
- "safe": appropriate for all audiences (G/PG equivalent)
- "mature": may contain violence, language, or themes for older teens (PG-13/R equivalent)
- "explicit": adult content (NC-17 equivalent)

Return valid JSON only, no markdown fences."""

_RECOMMEND_REASON_PROMPT = """You are a recommendation engine for a video streaming platform.
Given a source video and a list of recommended videos, generate a brief, engaging reason
why each recommendation matches the source.

Return valid JSON array:
[
  {"video_id": "...", "reason": "Short engaging reason (max 15 words)"},
  ...
]

Make reasons conversational and specific, not generic. Reference shared themes, genres, or vibes.
Return valid JSON only, no markdown fences."""


class AnalyzeRequest(BaseModel):
    title: str
    description: str = ""
    tags: list[str] = []
    duration_seconds: float | None = None
    llm_config: LLMConfig | None = None


class AnalyzeResponse(BaseModel):
    suggested_tags: list[str] = []
    short_description: str = ""
    classification_hint: str = "safe"
    genre_hints: list[str] = []
    mood: str = ""


class RecommendReasonRequest(BaseModel):
    source_title: str
    source_tags: list[str] = []
    recommendations: list[dict]
    llm_config: LLMConfig | None = None


class RecommendReasonResponse(BaseModel):
    reasons: list[dict]


@router.post("/analyze", response_model=AnalyzeResponse)
async def analyze_content(body: AnalyzeRequest):
    """Analyze video metadata and suggest tags, description, classification."""
    prompt = f"Title: {body.title}\nDescription: {body.description}\nExisting tags: {', '.join(body.tags)}"
    if body.duration_seconds:
        mins = int(body.duration_seconds / 60)
        prompt += f"\nDuration: {mins} minutes"

    try:
        result = await ask_llm_json(
            _ANALYZE_SYSTEM_PROMPT, prompt, max_tokens=512, config=body.llm_config,
        )
        return AnalyzeResponse(
            suggested_tags=result.get("suggested_tags", []),
            short_description=result.get("short_description", ""),
            classification_hint=result.get("classification_hint", "safe"),
            genre_hints=result.get("genre_hints", []),
            mood=result.get("mood", ""),
        )
    except Exception:
        logger.exception("Content analysis failed")
        return AnalyzeResponse()


@router.post("/recommend-reasons", response_model=RecommendReasonResponse)
async def generate_recommendation_reasons(body: RecommendReasonRequest):
    """Generate human-readable reasons for why videos are recommended."""
    prompt = (
        f"Source video: \"{body.source_title}\" (tags: {', '.join(body.source_tags)})\n\n"
        f"Recommended videos:\n"
    )
    for r in body.recommendations[:10]:
        prompt += f"- ID: {r.get('video_id')}, Title: \"{r.get('title')}\", Tags: {', '.join(r.get('tags', []))}\n"

    try:
        result = await ask_llm_json(
            _RECOMMEND_REASON_PROMPT, prompt, max_tokens=512, config=body.llm_config,
        )
        if isinstance(result, list):
            return RecommendReasonResponse(reasons=result)
        return RecommendReasonResponse(reasons=result.get("reasons", []))
    except Exception:
        logger.exception("Recommendation reason generation failed")
        return RecommendReasonResponse(reasons=[])
