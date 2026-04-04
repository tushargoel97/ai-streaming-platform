"""Intro detection service — finds the opening title sequence for the Skip Intro button.

Two detection strategies:
1. Audio fingerprinting (series): extracts raw PCM audio from the first 3 min of each
   episode in the same season, hashes 2-second windows, finds the longest common run
   of matching windows across ALL episodes → that's the intro.
2. AI vision (all videos): samples frames every 10s from the first 4 min, sends to the
   AI service which uses a vision model (or text LLM) to find where the intro ends.
3. Heuristic fallback: 0s if detection fails or returns 0.

Results are stored as (intro_start, intro_end) in seconds on the Video record.
"""

import asyncio
import hashlib
import logging
import struct
import uuid

import httpx
import base64
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models.ai_settings import AISettings
from app.models.series import Season
from app.models.video import Video

logger = logging.getLogger(__name__)

# ── Constants ────────────────────────────────────────────────────────────────

_SAMPLE_RATE = 8000          # Hz — low sample rate is fine for fingerprinting
_WINDOW_SEC = 2              # seconds per fingerprint window
_WINDOW_BYTES = _SAMPLE_RATE * _WINDOW_SEC * 2   # 16-bit PCM = 2 bytes/sample
_MAX_INTRO_SEC = 300         # cap at 5 min
_AUDIO_EXTRACT_SEC = 300     # extract first 5 min of audio
_FRAME_INTERVAL_SEC = 10     # seconds between sampled frames for AI
_MAX_FRAMES = 25             # max frames to send to AI (covers 0-240s)
_FRAME_EXTRACT_SEC = 240     # extract frames from first 4 min


# ── Audio fingerprinting ─────────────────────────────────────────────────────

async def _extract_audio_windows(video_path: str) -> list[str]:
    """Extract raw audio from first _AUDIO_EXTRACT_SEC, return list of window hashes.

    Each hash covers a _WINDOW_SEC window of audio.  We use SHA-256 truncated to 8 bytes
    so window comparison is fast.  Returns empty list on failure.
    """
    cmd = [
        settings.ffmpeg_path,
        "-y",
        "-i", video_path,
        "-t", str(_AUDIO_EXTRACT_SEC),
        "-vn",
        "-acodec", "pcm_s16le",
        "-ar", str(_SAMPLE_RATE),
        "-ac", "1",
        "-f", "s16le",
        "pipe:1",
    ]
    try:
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.DEVNULL,
        )
        try:
            stdout, _ = await asyncio.wait_for(proc.communicate(), timeout=60)
        except asyncio.TimeoutError:
            proc.kill()
            await proc.communicate()
            logger.warning("Audio extraction timed out for %s", video_path)
            return []

        windows: list[str] = []
        for offset in range(0, len(stdout) - _WINDOW_BYTES + 1, _WINDOW_BYTES):
            chunk = stdout[offset: offset + _WINDOW_BYTES]
            # Compute a simple energy-aware hash:
            # sum abs(sample) in 8 sub-bands, then hash the resulting 8 int32 values
            band = _WINDOW_BYTES // 8
            energies = []
            for b in range(8):
                seg = chunk[b * band: (b + 1) * band]
                # Unpack as signed 16-bit LE ints and sum absolute values
                n_samples = len(seg) // 2
                if n_samples == 0:
                    energies.append(0)
                    continue
                total = sum(abs(v) for v in struct.unpack_from(f"<{n_samples}h", seg))
                energies.append(total // n_samples)
            raw = struct.pack("<8I", *energies)
            digest = hashlib.sha256(raw).digest()[:8]
            windows.append(digest.hex())
        return windows
    except Exception:
        logger.exception("Audio extraction failed for %s", video_path)
        return []


def _find_common_run(
    all_windows: list[list[str]],
) -> tuple[int, int]:
    """Find the longest run of windows that appears in ALL episode fingerprints.

    Returns (start_window, end_window) indices (end exclusive).
    Returns (0, 0) if no common run found.
    """
    if not all_windows or len(all_windows) < 2:
        return (0, 0)

    # Build a set of windows for each episode for O(1) lookup
    sets = [set(w) for w in all_windows]
    ref = all_windows[0]
    n = len(ref)

    best_start = 0
    best_len = 0
    i = 0
    while i < n:
        # Check if ref[i] appears in all other episodes
        if all(ref[i] in s for s in sets[1:]):
            j = i
            while j < n and all(ref[j] in s for s in sets[1:]):
                j += 1
            run_len = j - i
            if run_len > best_len:
                best_len = run_len
                best_start = i
            i = j
        else:
            i += 1

    return (best_start, best_start + best_len)


async def _detect_via_fingerprint(
    video: Video, db: AsyncSession
) -> tuple[float, float] | None:
    """Audio fingerprint cross-episode detection for series episodes.

    Returns (intro_start, intro_end) in seconds, or None if not enough episodes.
    """
    if not video.season_id:
        return None

    # Load sibling episodes in same season
    result = await db.execute(
        select(Video)
        .where(
            Video.season_id == video.season_id,
            Video.status == "ready",
            Video.source_path.isnot(None),
        )
        .order_by(Video.episode_number)
        .limit(5)  # compare up to 5 episodes to save time
    )
    siblings = result.scalars().all()

    if len(siblings) < 2:
        logger.info("Fingerprint: only %d episode(s) in season, skipping", len(siblings))
        return None

    logger.info(
        "Fingerprint: extracting audio from %d episodes for season %s",
        len(siblings), video.season_id,
    )

    # Extract fingerprints in parallel
    paths = [f"{settings.local_media_path}/{ep.source_path}" for ep in siblings]
    all_windows = await asyncio.gather(*[_extract_audio_windows(p) for p in paths])
    all_windows = [w for w in all_windows if w]  # drop failures

    if len(all_windows) < 2:
        return None

    start_win, end_win = _find_common_run(list(all_windows))
    if end_win - start_win < 1:
        logger.info("Fingerprint: no common audio segment found")
        return None

    intro_start = round(start_win * _WINDOW_SEC, 1)
    intro_end = round(min(end_win * _WINDOW_SEC, _MAX_INTRO_SEC), 1)

    # Sanity check: must be a reasonable intro length
    if intro_end - intro_start < 5:
        return None
    if intro_start > 30:  # intro shouldn't start more than 30s in
        return None

    logger.info(
        "Fingerprint: detected intro %.1f–%.1fs for video '%s'",
        intro_start, intro_end, video.title,
    )
    return (intro_start, intro_end)


# ── AI frame analysis ────────────────────────────────────────────────────────

async def _extract_frame_b64(video_path: str, timestamp: float) -> str | None:
    """Extract a JPEG frame at timestamp, return as base64 string."""
    cmd = [
        settings.ffmpeg_path,
        "-y",
        "-threads", "1",
        "-ss", str(timestamp),
        "-i", video_path,
        "-vframes", "1",
        "-vf", "scale=480:-1",
        "-q:v", "6",
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
        stdout, _ = await asyncio.wait_for(proc.communicate(), timeout=20)
        if stdout:
            return base64.b64encode(stdout).decode()
    except Exception:
        logger.debug("Frame extraction failed at %.1fs from %s", timestamp, video_path)
    return None


async def _detect_via_ai(
    video_path: str,
    video: Video,
    scene_analysis_model: str | None,
) -> tuple[float, float] | None:
    """Ask the AI service to detect the intro using vision frames or text LLM.

    Returns (intro_start, intro_end) or None on failure.
    """
    # Sample frames from 0 to min(_FRAME_EXTRACT_SEC, 35% of duration)
    max_ts = min(_FRAME_EXTRACT_SEC, video.duration * 0.35)
    timestamps = [
        round(i * _FRAME_INTERVAL_SEC, 1)
        for i in range(_MAX_FRAMES)
        if i * _FRAME_INTERVAL_SEC <= max_ts
    ]

    if not timestamps:
        return None

    # Extract frames in parallel (limit concurrency)
    sem = asyncio.Semaphore(4)

    async def _safe_extract(ts: float) -> str | None:
        async with sem:
            return await _extract_frame_b64(video_path, ts)

    raw_frames = await asyncio.gather(*[_safe_extract(ts) for ts in timestamps])
    frames_b64 = [f for f in raw_frames if f]

    url = f"{settings.ai_service_url}/content/detect-intro"
    payload = {
        "title": video.title,
        "duration_seconds": float(video.duration),
        "frames_b64": frames_b64,
        "frame_interval_seconds": float(_FRAME_INTERVAL_SEC),
    }
    if scene_analysis_model:
        payload["scene_analysis_model"] = scene_analysis_model

    try:
        async with httpx.AsyncClient(timeout=120) as client:
            resp = await client.post(url, json=payload)
            resp.raise_for_status()
            data = resp.json()
            intro_end = float(data.get("intro_end", 0))
            method = data.get("method", "?")
            logger.info(
                "AI service detected intro end at %.1fs (method=%s) for '%s'",
                intro_end, method, video.title,
            )
            if intro_end > 0:
                return (0.0, intro_end)
            return (0.0, 0.0)
    except Exception:
        logger.warning("AI service detect-intro call failed for '%s'", video.title)
        return None


# ── Public entry point ───────────────────────────────────────────────────────

async def run_intro_detection(video_id: uuid.UUID, db: AsyncSession) -> tuple[float, float] | None:
    """Full intro detection pipeline for a video.

    1. For series episodes: audio fingerprint cross-episode comparison
    2. AI vision/text model (frames from first 4 min)
    3. On failure: stores (0, 0) meaning no intro detected

    Returns (intro_start, intro_end) or None if the video doesn't exist.
    """
    result = await db.execute(select(Video).where(Video.id == video_id))
    video = result.scalar_one_or_none()
    if not video or not video.source_path:
        logger.warning("Intro detection skipped: video %s not found or no source_path", video_id)
        return None

    video_path = f"{settings.local_media_path}/{video.source_path}"

    # Load scene_analysis_model setting
    scene_model: str | None = None
    try:
        ai_row = await db.execute(select(AISettings))
        ai = ai_row.scalar_one_or_none()
        if ai:
            scene_model = ai.scene_analysis_model or None
    except Exception:
        pass

    intro: tuple[float, float] | None = None

    # Strategy 1: audio fingerprinting (series only)
    if video.season_id:
        try:
            intro = await _detect_via_fingerprint(video, db)
        except Exception:
            logger.exception("Fingerprint detection failed for video %s", video_id)

    # Strategy 2: AI vision/text
    if intro is None:
        try:
            intro = await _detect_via_ai(video_path, video, scene_model)
        except Exception:
            logger.exception("AI detection failed for video %s", video_id)

    # Store result
    if intro is None:
        intro = (0.0, 0.0)

    video.intro_start = intro[0]
    video.intro_end = intro[1]
    await db.commit()

    logger.info(
        "Intro detection complete for '%s': start=%.1fs end=%.1fs",
        video.title, intro[0], intro[1],
    )
    return intro
