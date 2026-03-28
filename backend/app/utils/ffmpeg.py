"""FFmpeg command builder for multi-bitrate HLS transcoding."""

import asyncio
import logging
import re
from collections.abc import Callable

from app.config import settings

logger = logging.getLogger(__name__)

# Quality profiles: name → (width, height, bitrate_kbps, audio_bitrate_kbps)
QUALITY_PROFILES = {
    "360p": (640, 360, 800, 96),
    "480p": (854, 480, 1400, 128),
    "720p": (1280, 720, 2800, 128),
    "1080p": (1920, 1080, 5000, 192),
    "1440p": (2560, 1440, 9000, 192),
    "2160p": (3840, 2160, 18000, 256),
}


def select_qualities(source_height: int) -> list[str]:
    """Pick which quality profiles to transcode based on source resolution.

    Never upscale — only include profiles ≤ source height.
    """
    selected = []
    for name, (_, h, _, _) in QUALITY_PROFILES.items():
        if h <= source_height:
            selected.append(name)
    # Always include at least the lowest quality
    if not selected:
        selected.append("360p")
    return selected


def build_transcode_command(
    input_path: str,
    output_dir: str,
    qualities: list[str],
    segment_duration: int | None = None,
    segment_type: str | None = None,
) -> list[str]:
    """Build a single FFmpeg command that produces multi-bitrate HLS using split filter.

    Uses -filter_complex split to read the source once and output all variants.
    Produces fMP4/CMAF segments with H.264 High profile.
    """
    seg_dur = segment_duration or settings.transcode_segment_duration
    seg_type = segment_type or settings.hls_segment_type

    n = len(qualities)

    # Build filter_complex: split input into N streams, scale each
    split_labels = " ".join(f"[v{i}]" for i in range(n))
    filter_parts = [f"[0:v]split={n}{split_labels}"]
    for i, q_name in enumerate(qualities):
        w, h, _, _ = QUALITY_PROFILES[q_name]
        # scale to target keeping aspect ratio, ensure even dimensions
        filter_parts.append(
            f"[v{i}]scale={w}:{h}:force_original_aspect_ratio=decrease,"
            f"pad={w}:{h}:(ow-iw)/2:(oh-ih)/2[out{i}]"
        )

    filter_complex = "; ".join(filter_parts)

    cmd = [
        settings.ffmpeg_path,
        "-y",
        "-i", input_path,
        "-filter_complex", filter_complex,
    ]

    # Map all streams first (all video, then pair with audio)
    for i in range(n):
        cmd.extend(["-map", f"[out{i}]"])
        cmd.extend(["-map", "0:a?"])

    # Per-stream video encoding options
    # H.264 levels: 4.1 supports up to 1080p, 5.1 supports up to 2160p (4K)
    for i, q_name in enumerate(qualities):
        _, h, v_bitrate, _ = QUALITY_PROFILES[q_name]
        level = "5.1" if h > 1080 else "4.1"
        cmd.extend([
            f"-c:v:{i}", "libx264",
            f"-b:v:{i}", f"{v_bitrate}k",
            f"-maxrate:v:{i}", f"{int(v_bitrate * 1.2)}k",
            f"-bufsize:v:{i}", f"{v_bitrate * 2}k",
            f"-profile:v:{i}", "high",
            f"-level:v:{i}", level,
        ])

    # Global video encoding options
    cmd.extend([
        "-pix_fmt", "yuv420p",
        "-preset", "slow",
        "-sc_threshold", "0",
        "-g", str(seg_dur * 24),
        "-keyint_min", str(seg_dur * 24),
    ])

    # Audio encoding (AAC, per-stream bitrate from quality profiles)
    cmd.extend(["-c:a", "aac", "-ac", "2"])
    for i, q_name in enumerate(qualities):
        _, _, _, a_bitrate = QUALITY_PROFILES[q_name]
        cmd.extend([f"-b:a:{i}", f"{a_bitrate}k"])

    # HLS output settings — use var_stream_map for multi-bitrate
    stream_map = " ".join(f"v:{i},a:{i}" for i in range(n))

    hls_flags = "independent_segments"
    if seg_type == "fmp4":
        hls_flags += "+program_date_time"

    cmd.extend([
        "-f", "hls",
        "-hls_time", str(seg_dur),
        "-hls_list_size", "0",
        "-hls_segment_type", seg_type,
        "-hls_flags", hls_flags,
        "-hls_segment_filename", f"{output_dir}/%v/segment_%03d.{'m4s' if seg_type == 'fmp4' else 'ts'}",
        "-hls_fmp4_init_filename", "init.mp4",
        "-master_pl_name", "master.m3u8",
        "-var_stream_map", stream_map,
        f"{output_dir}/%v/playlist.m3u8",
    ])

    return cmd


async def run_ffmpeg(
    cmd: list[str],
    duration: float,
    on_progress: Callable | None = None,
) -> None:
    """Execute an FFmpeg command, parse progress from stderr, and call on_progress callback.

    Args:
        cmd: The full FFmpeg command as a list of strings.
        duration: Total video duration in seconds (for calculating percentage).
        on_progress: Optional async callback(percent: float) called as progress updates.
    """
    logger.info("Running FFmpeg: %s", " ".join(cmd))

    proc = await asyncio.create_subprocess_exec(
        *cmd,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )

    # Parse FFmpeg progress from stderr
    # FFmpeg outputs "time=HH:MM:SS.mm" lines to stderr
    time_pattern = re.compile(r"time=(\d+):(\d+):(\d+)\.(\d+)")
    last_percent = 0.0

    async def read_stderr():
        nonlocal last_percent
        buffer = b""
        while True:
            chunk = await proc.stderr.read(4096)
            if not chunk:
                break
            buffer += chunk
            # Process complete lines
            while b"\r" in buffer or b"\n" in buffer:
                sep = b"\r" if b"\r" in buffer else b"\n"
                line, buffer = buffer.split(sep, 1)
                line_str = line.decode(errors="replace")
                match = time_pattern.search(line_str)
                if match and duration > 0:
                    h, m, s, cs = match.groups()
                    current_time = int(h) * 3600 + int(m) * 60 + int(s) + int(cs) / 100
                    percent = min((current_time / duration) * 100, 99.9)
                    if percent - last_percent >= 1.0:
                        last_percent = percent
                        if on_progress:
                            await on_progress(percent)

    await read_stderr()
    await proc.wait()

    if proc.returncode != 0:
        raise RuntimeError(f"FFmpeg failed with exit code {proc.returncode}")

    if on_progress:
        await on_progress(100.0)
