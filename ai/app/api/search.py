"""Search API — smart query parsing with LLM + embedding generation."""

import logging
import re

from fastapi import APIRouter
from pydantic import BaseModel

from app.services.embedding_service import generate_embedding
from app.services.llm_service import LLMConfig, ask_llm_json

router = APIRouter(prefix="/search", tags=["search"])
logger = logging.getLogger(__name__)

_SEARCH_SYSTEM_PROMPT = """You are a search query parser for a video streaming platform.
Given a user's natural language search query, extract structured filters and a cleaned search query.

Return valid JSON with these fields:
{
  "cleaned_query": "the core search terms without filter words",
  "filters": {
    "min_duration": null or seconds (e.g. 3600 for 1 hour minimum),
    "max_duration": null or seconds (e.g. 1200 for 20 min maximum),
    "min_quality": null or height in pixels (720, 1080, 2160),
    "content_classification": null or "safe" or "mature" or "explicit"
  },
  "intent": "brief description of what the user is looking for"
}

Examples:
- "short action movies in 4K" -> {"cleaned_query": "action movies", "filters": {"max_duration": 1800, "min_quality": 2160}, "intent": "short action films in 4K quality"}
- "family friendly anime" -> {"cleaned_query": "anime", "filters": {"content_classification": "safe"}, "intent": "anime suitable for all ages"}
- "something to watch tonight under 2 hours" -> {"cleaned_query": "", "filters": {"max_duration": 7200}, "intent": "general entertainment under 2 hours"}

Only include filter keys that are explicitly or implicitly mentioned. Omit null values.
Always return valid JSON only, no markdown fences."""


# ── Regex fallback (used when LLM is unavailable) ──

_DURATION_PATTERNS: list[tuple[re.Pattern, float | None, float | None]] = [
    (re.compile(r"\bshort\b", re.I), None, 1200),
    (re.compile(r"\bquick\b", re.I), None, 600),
    (re.compile(r"\blong\b", re.I), 3600, None),
    (re.compile(r"\bfull[- ]?length\b", re.I), 3600, None),
    (re.compile(r"\bmovie\b", re.I), 3600, None),
    (re.compile(r"\bunder\s+(\d+)\s*min", re.I), None, None),
    (re.compile(r"\bover\s+(\d+)\s*min", re.I), None, None),
    (re.compile(r"\bunder\s+(\d+)\s*h", re.I), None, None),
    (re.compile(r"\bover\s+(\d+)\s*h", re.I), None, None),
]

_QUALITY_PATTERNS = [
    (re.compile(r"\b4[kK]\b"), 2160),
    (re.compile(r"\b2160p?\b"), 2160),
    (re.compile(r"\b1080p?\b"), 1080),
    (re.compile(r"\b[hH][dD]\b"), 720),
    (re.compile(r"\b720p?\b"), 720),
    (re.compile(r"\bhigh\s*quality\b", re.I), 1080),
]

_RATING_PATTERNS = [
    (re.compile(r"\bexplicit\b", re.I), "explicit"),
    (re.compile(r"\bmature\b", re.I), "mature"),
    (re.compile(r"\b18\+\b"), "explicit"),
    (re.compile(r"\bfamily[- ]?friendly\b", re.I), "safe"),
    (re.compile(r"\bsafe\b", re.I), "safe"),
    (re.compile(r"\bkids?\b", re.I), "safe"),
]


def _extract_filters_regex(query: str) -> dict:
    filters: dict = {}

    for pattern, default_min, default_max in _DURATION_PATTERNS:
        m = pattern.search(query)
        if m:
            groups = m.groups()
            if groups:
                val = float(groups[0])
                if "under" in m.group().lower() or "less" in m.group().lower():
                    filters["max_duration"] = val * 3600 if "h" in m.group().lower() else val * 60
                elif "over" in m.group().lower() or "more" in m.group().lower():
                    filters["min_duration"] = val * 3600 if "h" in m.group().lower() else val * 60
            else:
                if default_min is not None:
                    filters["min_duration"] = default_min
                if default_max is not None:
                    filters["max_duration"] = default_max
            break

    for pattern, min_height in _QUALITY_PATTERNS:
        if pattern.search(query):
            filters["min_quality"] = min_height
            break

    for pattern, classification in _RATING_PATTERNS:
        if pattern.search(query):
            filters["content_classification"] = classification
            break

    return filters


# ── Request/Response models ──

class ParseQueryRequest(BaseModel):
    query: str
    llm_config: LLMConfig | None = None


class ParseQueryResponse(BaseModel):
    cleaned_query: str
    filters: dict
    embedding: list[float]
    intent: str


@router.post("/parse", response_model=ParseQueryResponse)
async def parse_search_query(body: ParseQueryRequest):
    """Parse a search query: extract filters via LLM (or regex fallback), generate embedding."""
    query = body.query.strip()
    config = body.llm_config

    filters = {}
    cleaned_query = query
    intent = ""

    # Try LLM-based parsing
    try:
        result = await ask_llm_json(
            _SEARCH_SYSTEM_PROMPT,
            f"Parse this search query: {query}",
            max_tokens=256,
            config=config,
        )
        if result:
            cleaned_query = result.get("cleaned_query", query) or query
            filters = result.get("filters", {})
            intent = result.get("intent", "")
            filters = {k: v for k, v in filters.items() if v is not None}
    except Exception:
        logger.warning("LLM query parsing failed, falling back to regex")
        filters = _extract_filters_regex(query)

    # Generate embedding for the cleaned query
    embed_text = cleaned_query if cleaned_query else query
    embedding = await generate_embedding(embed_text)

    return ParseQueryResponse(
        cleaned_query=cleaned_query,
        filters=filters,
        embedding=embedding,
        intent=intent,
    )
