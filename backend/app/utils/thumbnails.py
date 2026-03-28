"""Thumbnail extraction from video files using FFmpeg."""

import asyncio
import logging
import os
from pathlib import Path

from app.config import settings

logger = logging.getLogger(__name__)

MAX_CANDIDATES = 12


async def extract_thumbnails(
    input_path: str,
    output_dir: str,
    duration: float,
) -> list[str]:
    """Extract thumbnail candidates from a video file.

    Uses two strategies:
    1. Evenly-spaced frame extraction
    2. Scene-change detection for visually interesting frames

    Returns list of output file paths.
    """
    os.makedirs(output_dir, exist_ok=True)
    paths: list[str] = []

    # Strategy 1: Evenly-spaced frames (every ~10% of duration)
    count = min(10, max(3, int(duration / 10)))
    interval = duration / (count + 1)

    cmd_even = [
        settings.ffmpeg_path,
        "-y",
        "-i", input_path,
        "-vf", f"fps=1/{interval:.2f},scale=640:-1",
        "-frames:v", str(count),
        "-q:v", "2",
        f"{output_dir}/thumb_%03d.webp",
    ]

    proc = await asyncio.create_subprocess_exec(
        *cmd_even,
        stdout=asyncio.subprocess.DEVNULL,
        stderr=asyncio.subprocess.PIPE,
    )
    _, stderr = await proc.communicate()
    if proc.returncode != 0:
        logger.warning("Even-spaced thumbnail extraction failed: %s", stderr.decode(errors="replace"))
    else:
        paths.extend(
            str(p) for p in sorted(Path(output_dir).glob("thumb_*.webp"))
        )

    # Strategy 2: Scene-change detection (bonus candidates)
    scene_count = min(5, MAX_CANDIDATES - len(paths))
    if scene_count > 0:
        cmd_scene = [
            settings.ffmpeg_path,
            "-y",
            "-i", input_path,
            "-vf", "select='gt(scene,0.3)',scale=640:-1",
            "-vsync", "vfn",
            "-frames:v", str(scene_count),
            "-q:v", "2",
            f"{output_dir}/scene_%03d.webp",
        ]

        proc = await asyncio.create_subprocess_exec(
            *cmd_scene,
            stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.PIPE,
        )
        _, stderr = await proc.communicate()
        if proc.returncode != 0:
            logger.warning("Scene-change thumbnail extraction failed: %s", stderr.decode(errors="replace"))
        else:
            paths.extend(
                str(p) for p in sorted(Path(output_dir).glob("scene_*.webp"))
            )

    if not paths:
        # Fallback: extract a single frame at 10% of duration
        seek_to = max(0, duration * 0.1)
        cmd_fallback = [
            settings.ffmpeg_path,
            "-y",
            "-ss", f"{seek_to:.2f}",
            "-i", input_path,
            "-frames:v", "1",
            "-vf", "scale=640:-1",
            "-q:v", "2",
            f"{output_dir}/thumb_001.webp",
        ]
        proc = await asyncio.create_subprocess_exec(
            *cmd_fallback,
            stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.PIPE,
        )
        await proc.communicate()
        fallback_path = f"{output_dir}/thumb_001.webp"
        if os.path.exists(fallback_path):
            paths.append(fallback_path)

    logger.info("Extracted %d thumbnail candidates to %s", len(paths), output_dir)
    return paths
