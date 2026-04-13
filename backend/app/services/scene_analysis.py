"""Scene analysis service — picks the best preview start timestamp for a video.

Pipeline:
1. FFmpeg scene-change detection → candidate timestamps between 15%–85% of duration
2. Extract JPEG frames at top candidates (for vision model)
3. AI service: vision model (if configured) → reasons over actual frames
   Fallback: text LLM → reasons over metadata
4. Fallback: highest scene-score candidate if AI is unavailable
"""

import asyncio
import base64
import json
import logging
import re
import uuid

import httpx
from app.database import redis_pool
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models.ai_settings import AISettings
from app.models.video import Video

logger = logging.getLogger(__name__)


async def _publish_scene_progress(video_id: uuid.UUID, percent: float, stage: str) -> None:
    """Store scene-analysis progress in Redis for SSE consumption."""
    await redis_pool.set(
        f"analyze:progress:{video_id}",
        json.dumps({"percent": round(percent, 1), "stage": stage}),
        ex=3600,
    )

# Max frames to extract and send to the vision model
_MAX_VISION_FRAMES = 5


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
        "-threads", "2",
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
        for line in stderr.split("\n"):
            if "pts_time:" not in line:
                continue
            ts_match = re.search(r"pts_time:(\d+\.?\d*)", line)
            if not ts_match:
                continue
            ts = float(ts_match.group(1))
            if not (low <= ts <= high):
                continue
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


async def _extract_frame_b64(video_path: str, timestamp: float) -> str | None:
    """Extract a single JPEG frame at the given timestamp, return as base64."""
    cmd = [
        settings.ffmpeg_path,
        "-y",
        "-threads", "1",
        "-ss", str(timestamp),
        "-i", video_path,
        "-vframes", "1",
        "-vf", "scale=640:-1",
        "-q:v", "5",
        "-f", "image2pipe",
        "-vcodec", "mjpeg",
        "pipe:1",
    ]
    try:
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.DEVNULL,
        )
        stdout, _ = await asyncio.wait_for(proc.communicate(), timeout=30)
        if stdout:
            return base64.b64encode(stdout).decode()
    except Exception:
        logger.warning("Failed to extract frame at %.1fs from %s", timestamp, video_path)
    return None


async def _extract_frames_for_candidates(
    video_path: str, candidates: list[dict], max_frames: int = _MAX_VISION_FRAMES
) -> tuple[list[str], list[dict]]:
    """Extract JPEG frames for a spread of candidates.

    Returns (frames_b64, matching_candidates) — only pairs where extraction succeeded.
    """
    if not candidates:
        return [], []

    # Pick evenly-spaced subset if we have more candidates than max_frames
    if len(candidates) > max_frames:
        step = len(candidates) / max_frames
        indices = [int(i * step) for i in range(max_frames)]
        selected = [candidates[i] for i in indices]
    else:
        selected = candidates

    raw_frames = await asyncio.gather(
        *[_extract_frame_b64(video_path, c["timestamp"]) for c in selected]
    )

    frames_out: list[str] = []
    cands_out: list[dict] = []
    for frame, cand in zip(raw_frames, selected):
        if frame:
            frames_out.append(frame)
            cands_out.append(cand)

    return frames_out, cands_out


async def _get_scene_analysis_model(db: AsyncSession) -> str | None:
    """Read the scene_analysis_model from admin AI settings."""
    try:
        row = await db.execute(select(AISettings))
        ai = row.scalar_one_or_none()
        if ai:
            return ai.scene_analysis_model or None
    except Exception:
        logger.warning("Could not read AI settings for scene analysis model")
    return None


async def _ask_ai_for_timestamp(
    video: Video,
    candidates: list[dict],
    frames_b64: list[str] | None = None,
    scene_analysis_model: str | None = None,
) -> float | None:
    """Call the AI service to pick the best timestamp."""
    url = f"{settings.ai_service_url}/content/preview-timestamp"
    payload = {
        "title": video.title,
        "description": video.description or "",
        "tags": list(video.tags or []),
        "duration_seconds": float(video.duration),
        "candidates": candidates,
    }
    if frames_b64:
        payload["frames_b64"] = frames_b64
    if scene_analysis_model:
        payload["scene_analysis_model"] = scene_analysis_model

    try:
        async with httpx.AsyncClient(timeout=120) as client:
            resp = await client.post(url, json=payload)
            resp.raise_for_status()
            data = resp.json()
            method = data.get("method", "?")
            ts = float(data["preview_start_time"])
            logger.info("AI service chose %.1fs via %s for '%s'", ts, method, video.title)
            return ts
    except Exception:
        logger.warning("AI service preview-timestamp call failed, using heuristic fallback")
        return None


def _heuristic_fallback(candidates: list[dict], duration: float) -> float:
    """Pick highest scene-score candidate, else default to 30% through the video."""
    if candidates:
        return max(candidates, key=lambda c: c["score"])["timestamp"]
    return round(duration * 0.30, 1)


async def compute_preview_timestamp(
    video_path: str,
    video: Video,
    scene_analysis_model: str | None = None,
    report=None,
) -> float:
    """Full pipeline: FFmpeg scene detection → frame extraction → AI → heuristic fallback.

    `report` is an optional async callable(percent, stage) for progress updates.
    """
    if report:
        await report(10, "detecting")
    candidates = await _detect_scene_candidates(video_path, float(video.duration))

    frames_b64: list[str] = []
    vision_candidates = candidates  # may be subset after frame extraction

    # Extract frames if a vision model is configured
    if scene_analysis_model and candidates:
        if report:
            await report(40, "extracting")
        extracted_frames, vision_candidates = await _extract_frames_for_candidates(
            video_path, candidates
        )
        if extracted_frames:
            frames_b64 = extracted_frames
            logger.info(
                "Extracted %d frames for vision model %s",
                len(frames_b64), scene_analysis_model,
            )

    # Ask AI service (will use vision if frames provided, text LLM otherwise)
    if report:
        await report(70, "asking_ai")
    result = await _ask_ai_for_timestamp(
        video,
        vision_candidates if frames_b64 else candidates,
        frames_b64=frames_b64 or None,
        scene_analysis_model=scene_analysis_model,
    )
    if result is not None:
        return result

    return _heuristic_fallback(candidates, float(video.duration))


async def run_scene_analysis(video_id: uuid.UUID, db: AsyncSession) -> float | None:
    """Load the video, resolve its local path, run analysis, persist result."""
    result = await db.execute(select(Video).where(Video.id == video_id))
    video = result.scalar_one_or_none()
    if not video or not video.source_path:
        logger.warning("Scene analysis skipped: video %s not found or no source_path", video_id)
        return None

    video_path = f"{settings.local_media_path}/{video.source_path}"

    # Load the configured scene analysis model from DB
    scene_analysis_model = await _get_scene_analysis_model(db)

    logger.info(
        "Running scene analysis for video %s (model=%s) at %s",
        video_id, scene_analysis_model, video_path,
    )

    async def report(percent: float, stage: str) -> None:
        await _publish_scene_progress(video_id, percent, stage)

    try:
        await _publish_scene_progress(video_id, 5, "detecting")
        ts = await compute_preview_timestamp(video_path, video, scene_analysis_model, report=report)
        await _publish_scene_progress(video_id, 90, "finalizing")
        video.preview_start_time = ts
        await db.commit()
        await _publish_scene_progress(video_id, 100, "completed")
        logger.info("preview_start_time=%.1fs set for video %s", ts, video_id)
        return ts
    except Exception:
        logger.exception("Scene analysis failed for video %s", video_id)
        await _publish_scene_progress(video_id, -1, "failed")
        await db.rollback()
        return None
