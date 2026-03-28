"""AI search — calls the AI microservice for query parsing + embedding,
then runs pgvector similarity search locally.

Flow:
1. POST query to AI service → get cleaned_query, filters, embedding
2. Use embedding for pgvector cosine similarity search
3. Supplement with keyword fallback
4. Merge and return results
"""

import logging

import httpx
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models.recommendation import VideoEmbedding
from app.models.video import Video

logger = logging.getLogger(__name__)


def _ai_url(path: str) -> str:
    return f"{settings.ai_service_url}{path}"


async def _parse_query(query: str, llm_config: dict | None = None) -> dict:
    """Call AI service to parse the query and get embedding + filters."""
    body: dict = {"query": query}
    if llm_config:
        body["llm_config"] = llm_config
    async with httpx.AsyncClient(timeout=60) as client:
        resp = await client.post(_ai_url("/search/parse"), json=body)
        resp.raise_for_status()
        return resp.json()


def _build_summary(query: str, total: int, filters: dict) -> str:
    """Build a human-readable summary of the search."""
    if total == 0:
        return f'No videos found matching "{query}". Try broadening your search.'

    parts = [f"Found {total} video{'s' if total != 1 else ''} matching your search"]

    filter_descs = []
    if "min_duration" in filters:
        mins = int(filters["min_duration"] / 60)
        filter_descs.append(f"longer than {mins} min")
    if "max_duration" in filters:
        mins = int(filters["max_duration"] / 60)
        filter_descs.append(f"shorter than {mins} min")
    if "min_quality" in filters:
        h = filters["min_quality"]
        label = "4K" if h >= 2160 else f"{h}p+"
        filter_descs.append(f"in {label}")
    if "content_classification" in filters:
        filter_descs.append(f"rated {filters['content_classification']}")

    if filter_descs:
        parts.append(f" ({', '.join(filter_descs)})")

    return "".join(parts) + "."


def _generate_suggestions(query: str, total: int) -> list[str]:
    """Generate follow-up search suggestions based on the query."""
    suggestions = []
    q_lower = query.lower()

    if total == 0:
        suggestions.append("Try simpler keywords")
        suggestions.append("Browse by genre instead")
    elif total < 5:
        if "hd" not in q_lower and "4k" not in q_lower:
            suggestions.append(f"{query} in HD")
        if "short" not in q_lower and "long" not in q_lower:
            suggestions.append(f"short {query}")

    if "action" not in q_lower:
        suggestions.append("action movies")
    if "comedy" not in q_lower:
        suggestions.append("something funny")
    if "thriller" not in q_lower:
        suggestions.append("thriller")

    return suggestions[:3]


def _build_reason(video: Video, similarity: float | None, is_semantic: bool) -> str:
    """Build a reason string explaining why this video matched."""
    parts = []

    if is_semantic and similarity is not None:
        pct = int(similarity * 100)
        parts.append(f"{pct}% match")

    if video.tags:
        parts.append(f"Tags: {', '.join(video.tags[:4])}")

    if video.duration:
        mins = int(video.duration // 60)
        if mins >= 60:
            parts.append(f"{mins // 60}h {mins % 60}m")
        else:
            parts.append(f"{mins}m")

    if video.source_height:
        if video.source_height >= 2160:
            parts.append("4K")
        elif video.source_height >= 1080:
            parts.append("1080p")
        elif video.source_height >= 720:
            parts.append("HD")

    if video.imdb_rating:
        parts.append(f"IMDb {video.imdb_rating}")

    return " · ".join(parts) if parts else "Matches your search"


async def ai_search(query: str, db: AsyncSession, llm_config: dict | None = None) -> dict:
    """Semantic search: parse query via AI service, search pgvector locally.

    Returns dict with: summary, results [{video_id, title, reason}], suggestions
    """
    # 1. Call AI service for query parsing + embedding
    parsed = await _parse_query(query, llm_config)
    filters = parsed.get("filters", {})
    query_embedding = parsed.get("embedding", [])
    cleaned_query = parsed.get("cleaned_query", query)

    if not query_embedding:
        # AI service didn't return an embedding — fall back to keyword-only
        logger.warning("AI service returned no embedding, keyword search only")
        return await _keyword_only_search(query, db, filters)

    # 2. Build the semantic search query
    stmt = (
        select(
            Video,
            VideoEmbedding.embedding.cosine_distance(query_embedding).label("distance"),
        )
        .join(VideoEmbedding, VideoEmbedding.video_id == Video.id)
        .where(Video.status == "ready")
    )

    # Apply extracted filters
    if "min_duration" in filters:
        stmt = stmt.where(Video.duration >= filters["min_duration"])
    if "max_duration" in filters:
        stmt = stmt.where(Video.duration <= filters["max_duration"])
    if "min_quality" in filters:
        stmt = stmt.where(Video.source_height >= filters["min_quality"])
    if "content_classification" in filters:
        stmt = stmt.where(Video.content_classification == filters["content_classification"])

    stmt = stmt.order_by("distance").limit(20)
    result = await db.execute(stmt)
    semantic_rows = result.all()

    # 3. Keyword fallback
    keyword_stmt = (
        select(Video)
        .where(Video.status == "ready")
        .where(
            or_(
                Video.title.ilike(f"%{cleaned_query}%"),
                Video.description.ilike(f"%{cleaned_query}%"),
            )
        )
        .order_by(Video.view_count.desc())
        .limit(10)
    )
    keyword_result = await db.execute(keyword_stmt)
    keyword_videos = keyword_result.scalars().all()

    # 4. Merge results
    seen_ids: set = set()
    merged: list[dict] = []

    for row in semantic_rows:
        video = row[0]
        distance = row[1]
        similarity = 1.0 - (distance / 2.0)
        if similarity < 0.15:
            continue

        seen_ids.add(video.id)
        merged.append({
            "video_id": str(video.id),
            "title": video.title,
            "reason": _build_reason(video, similarity, is_semantic=True),
        })

    for video in keyword_videos:
        if video.id not in seen_ids:
            seen_ids.add(video.id)
            merged.append({
                "video_id": str(video.id),
                "title": video.title,
                "reason": _build_reason(video, None, is_semantic=False),
            })

    merged = merged[:15]

    return {
        "summary": _build_summary(query, len(merged), filters),
        "results": merged,
        "suggestions": _generate_suggestions(query, len(merged)),
    }


async def _keyword_only_search(query: str, db: AsyncSession, filters: dict) -> dict:
    """Fallback when embedding is unavailable."""
    stmt = (
        select(Video)
        .where(Video.status == "ready")
        .where(
            or_(
                Video.title.ilike(f"%{query}%"),
                Video.description.ilike(f"%{query}%"),
            )
        )
    )

    if "min_duration" in filters:
        stmt = stmt.where(Video.duration >= filters["min_duration"])
    if "max_duration" in filters:
        stmt = stmt.where(Video.duration <= filters["max_duration"])
    if "content_classification" in filters:
        stmt = stmt.where(Video.content_classification == filters["content_classification"])

    stmt = stmt.order_by(Video.view_count.desc()).limit(15)
    result = await db.execute(stmt)
    videos = result.scalars().all()

    merged = [
        {"video_id": str(v.id), "title": v.title, "reason": _build_reason(v, None, False)}
        for v in videos
    ]
    return {
        "summary": _build_summary(query, len(merged), filters),
        "results": merged,
        "suggestions": _generate_suggestions(query, len(merged)),
    }
