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


class SceneCandidate(BaseModel):
    timestamp: float   # seconds into the video
    score: float       # scene-change intensity 0–1


class PreviewTimestampRequest(BaseModel):
    title: str
    description: str = ""
    tags: list[str] = []
    duration_seconds: float
    candidates: list[SceneCandidate]
    # Optional base64 JPEG frames at each candidate timestamp (same order as candidates)
    frames_b64: list[str] = []
    # Vision model to use for frame analysis; falls back to text LLM if not set/not vision
    scene_analysis_model: str | None = None
    llm_config: LLMConfig | None = None


class PreviewTimestampResponse(BaseModel):
    preview_start_time: float
    method: str = "text"  # "vision" | "text" | "heuristic"


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


_PREVIEW_TIMESTAMP_SYSTEM = """You are a film editor for a streaming platform selecting the best 30-second preview clip.

Given a video's title, description, genre tags, duration, and a list of candidate timestamps (detected scene changes), choose the timestamp most likely to show an iconic, visually engaging, or emotionally compelling moment.

Rules:
- Avoid title sequences (usually the first 15% of the video)
- Avoid credits and fade-outs (usually the last 5–10%)
- Prefer action peaks, dramatic confrontations, or visually stunning scenes
- For comedy: prefer a funny payoff moment (usually 30–60% in)
- For drama/fantasy: prefer the emotional climax (usually 55–75% in)
- For documentaries/reviews: prefer the most active demonstration segment

Return valid JSON only: {"index": <0-based index into candidates array>}"""


_PREVIEW_VISION_SYSTEM = """You are a film editor for a streaming platform selecting the best preview moment.
You will be shown frames extracted from a video at candidate scene-change timestamps.
Pick the frame that would make the most compelling 30-second preview clip.

Criteria:
- Most visually striking or emotionally compelling composition
- Avoid dark/blurry frames, title cards, or static shots
- Prefer action, drama, or visually stunning scenes

Return valid JSON only: {"best_frame_index": <1-based index of the best frame>}"""


@router.post("/preview-timestamp", response_model=PreviewTimestampResponse)
async def select_preview_timestamp(body: PreviewTimestampRequest):
    """Pick the best preview timestamp using vision (frames) or text LLM (metadata)."""
    if not body.candidates:
        return PreviewTimestampResponse(
            preview_start_time=round(body.duration_seconds * 0.25, 1),
            method="heuristic",
        )

    # ── Vision path: use actual extracted frames ──
    if body.frames_b64 and body.scene_analysis_model:
        from app.services.local_llm_service import MODEL_CATALOG, chat_vision_json

        if MODEL_CATALOG.get(body.scene_analysis_model, {}).get("vision"):
            try:
                frames = body.frames_b64[: len(body.candidates)]
                n = len(frames)
                prompt = (
                    f'Video: "{body.title}"\n'
                    f"Tags: {', '.join(body.tags) or '(none)'}\n"
                    f"I am showing you {n} frames from candidate scene-change timestamps:\n"
                    + "\n".join(
                        f"Frame {i+1}: {body.candidates[i].timestamp:.1f}s "
                        f"({body.candidates[i].timestamp / body.duration_seconds * 100:.0f}% into the video)"
                        for i in range(n)
                    )
                    + '\n\nReturn JSON: {"best_frame_index": <1-based index>}'
                )
                result = await chat_vision_json(
                    _PREVIEW_VISION_SYSTEM,
                    prompt,
                    frames,
                    model_name=body.scene_analysis_model,
                    max_tokens=64,
                )
                idx = int(result.get("best_frame_index", 1)) - 1
                idx = max(0, min(idx, n - 1))
                chosen = body.candidates[idx].timestamp
                logger.info(
                    "Vision model chose frame %d (%.1fs) for '%s'",
                    idx + 1, chosen, body.title,
                )
                return PreviewTimestampResponse(preview_start_time=round(chosen, 1), method="vision")
            except Exception:
                logger.warning("Vision model failed for preview-timestamp, falling back to text LLM")

    # ── Text LLM path: reason from metadata ──
    duration_min = int(body.duration_seconds // 60)
    duration_sec = int(body.duration_seconds % 60)
    candidate_lines = "\n".join(
        f"{i}. {c.timestamp:.1f}s ({c.timestamp/body.duration_seconds*100:.0f}% in, score: {c.score:.2f})"
        for i, c in enumerate(body.candidates)
    )
    prompt = (
        f'Title: "{body.title}"\n'
        f"Description: {body.description or '(none)'}\n"
        f"Tags: {', '.join(body.tags) or '(none)'}\n"
        f"Duration: {duration_min}m {duration_sec}s\n\n"
        f"Candidate timestamps:\n{candidate_lines}\n\n"
        f'Return JSON: {{"index": <chosen 0-based index>}}'
    )

    try:
        result = await ask_llm_json(
            _PREVIEW_TIMESTAMP_SYSTEM, prompt, max_tokens=64, config=body.llm_config,
        )
        idx = int(result.get("index", 0))
        idx = max(0, min(idx, len(body.candidates) - 1))
        chosen = body.candidates[idx].timestamp
        return PreviewTimestampResponse(preview_start_time=round(chosen, 1), method="text")
    except Exception:
        logger.warning("Preview timestamp LLM failed, using highest scene-score candidate")
        chosen = max(body.candidates, key=lambda c: c.score).timestamp
        return PreviewTimestampResponse(preview_start_time=round(chosen, 1), method="heuristic")


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
