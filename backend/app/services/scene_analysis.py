"""Scene analysis service — picks the best preview start timestamp for a video.

Pipeline:
1. FFmpeg scene-change detection → candidate timestamps between 15%–85% of duration
2. AI service (local LLM) → reasons about metadata to pick the most iconic moment
3. Fallback: highest scene-score candidate if LLM is unavailable
"""

import asyncio
import logging
import re
import uuid

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models.video import Video

logger = logging.getLogger(__name__)

# How long to spend on scene detection (cap for very long videos)
_MAX_PROBE_SECONDS = 600


async def _detect_scene_candidates(
    video_path: str, duration: float
) -> list[dict]:
    """Run FFmpeg scene-change detection, returning candidates between 15%–85% of duration.

    Each candidate: {"timestamp": float, "score": float}
    """
    low = duration * 0.15
    high = duration * 0.85

    cmd = [
        settings.ffmpeg_path,
        "-y",
        "-i", video_path,
        "-vf", "select='gt(scene,0.20)',showinfo",
        "-vsync", "vfr",
        "-f", "null", "-",
    ]
    try:
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.PIPE,
        )
        try:
            _, stderr_bytes = await asyncio.wait_for(proc.communicate(), timeout=120)
        except asyncio.TimeoutError:
            proc.kill()
            await proc.communicate()
            logger.warning("Scene detection timed out for %s", video_path)
            stderr_bytes = b""

        stderr = stderr_bytes.decode(errors="replace")

        candidates = []
        # Parse lines like: [Parsed_showinfo_1 @ ...] n:5 pts:... pts_time:44.1234 ...
        for line in stderr.split("\n"):
            if "pts_time:" not in line:
                continue
            ts_match = re.search(r"pts_time:(\d+\.?\d*)", line)
            if not ts_match:
                continue
            ts = float(ts_match.group(1))
            if not (low <= ts <= high):
                continue
            # scene score comes from "scene_score:" if available; default to 0.5
            score_match = re.search(r"scene_score:(\d+\.?\d*)", line)
            score = float(score_match.group(1)) if score_match else 0.5
            candidates.append({"timestamp": round(ts, 1), "score": round(score, 3)})

        # De-duplicate: keep highest score within any 10-second window
        candidates.sort(key=lambda c: c["timestamp"])
        deduped: list[dict] = []
        for c in candidates:
            if deduped and c["timestamp"] - deduped[-1]["timestamp"] < 10:
                if c["score"] > deduped[-1]["score"]:
                    deduped[-1] = c
            else:
                deduped.append(c)

        logger.info("Scene detection found %d candidates in %s", len(deduped), video_path)
        return deduped[:12]

    except Exception:
        logger.exception("FFmpeg scene detection failed for %s", video_path)
        return []


async def _ask_ai_for_timestamp(video: Video, candidates: list[dict]) -> float | None:
    """Call the AI service to pick the best timestamp using the local LLM."""
    url = f"{settings.ai_service_url}/content/preview-timestamp"
    payload = {
        "title": video.title,
        "description": video.description or "",
        "tags": list(video.tags or []),
        "duration_seconds": float(video.duration),
        "candidates": candidates,
    }
    try:
        async with httpx.AsyncClient(timeout=60) as client:
            resp = await client.post(url, json=payload)
            resp.raise_for_status()
            return float(resp.json()["preview_start_time"])
    except Exception:
        logger.warning("AI service preview-timestamp call failed, using heuristic fallback")
        return None


def _heuristic_fallback(candidates: list[dict], duration: float) -> float:
    """Pick highest scene-score candidate, else default to 30% through the video."""
    if candidates:
        return max(candidates, key=lambda c: c["score"])["timestamp"]
    return round(duration * 0.30, 1)


async def compute_preview_timestamp(video_path: str, video: Video) -> float:
    """Full pipeline: FFmpeg scene detection → local LLM → heuristic fallback."""
    candidates = await _detect_scene_candidates(video_path, float(video.duration))

    # Try local LLM
    result = await _ask_ai_for_timestamp(video, candidates)
    if result is not None:
        return result

    # LLM unavailable — use heuristic
    return _heuristic_fallback(candidates, float(video.duration))


async def run_scene_analysis(video_id: uuid.UUID, db: AsyncSession) -> float | None:
    """Load the video, resolve its local path, run analysis, persist result."""
    result = await db.execute(select(Video).where(Video.id == video_id))
    video = result.scalar_one_or_none()
    if not video or not video.source_path:
        logger.warning("Scene analysis skipped: video %s not found or no source_path", video_id)
        return None

    video_path = f"{settings.local_media_path}/{video.source_path}"

    logger.info("Running scene analysis for video %s at %s", video_id, video_path)
    try:
        ts = await compute_preview_timestamp(video_path, video)
        video.preview_start_time = ts
        await db.commit()
        logger.info("preview_start_time=%ss set for video %s", ts, video_id)
        return ts
    except Exception:
        logger.exception("Scene analysis failed for video %s", video_id)
        await db.rollback()
        return None
