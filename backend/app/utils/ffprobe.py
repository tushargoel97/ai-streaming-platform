"""FFprobe wrapper — extract media metadata from video files."""

import asyncio
import json
import logging

from app.config import settings

logger = logging.getLogger(__name__)


class ProbeResult:
    """Parsed ffprobe output."""

    def __init__(self, data: dict) -> None:
        self._data = data
        self._video_stream = next(
            (s for s in data.get("streams", []) if s.get("codec_type") == "video"),
            None,
        )
        self._audio_streams = [
            s for s in data.get("streams", []) if s.get("codec_type") == "audio"
        ]
        self._subtitle_streams = [
            s for s in data.get("streams", []) if s.get("codec_type") == "subtitle"
        ]
        fmt = data.get("format", {})
        self.duration: float = float(fmt.get("duration", 0))
        self.file_size: int = int(fmt.get("size", 0))
        self.format_name: str = fmt.get("format_name", "")

    @property
    def width(self) -> int | None:
        if self._video_stream:
            return int(self._video_stream.get("width", 0)) or None
        return None

    @property
    def height(self) -> int | None:
        if self._video_stream:
            return int(self._video_stream.get("height", 0)) or None
        return None

    @property
    def codec(self) -> str | None:
        if self._video_stream:
            return self._video_stream.get("codec_name")
        return None

    @property
    def fps(self) -> float | None:
        if self._video_stream:
            r_frame_rate = self._video_stream.get("r_frame_rate", "0/1")
            try:
                num, den = r_frame_rate.split("/")
                return round(int(num) / int(den), 2) if int(den) else None
            except (ValueError, ZeroDivisionError):
                return None
        return None

    @property
    def audio_tracks(self) -> list[dict]:
        """Return list of audio tracks with index, language, and codec."""
        tracks = []
        for i, s in enumerate(self._audio_streams):
            tags = s.get("tags", {})
            tracks.append(
                {
                    "index": s.get("index", i),
                    "codec": s.get("codec_name", "unknown"),
                    "language": tags.get("language", "und"),
                    "title": tags.get("title", ""),
                    "channels": s.get("channels", 2),
                    "is_default": s.get("disposition", {}).get("default", 0) == 1,
                }
            )
        return tracks

    @property
    def subtitle_tracks(self) -> list[dict]:
        """Return list of subtitle tracks with index, language, and codec."""
        tracks = []
        for i, s in enumerate(self._subtitle_streams):
            tags = s.get("tags", {})
            tracks.append(
                {
                    "index": s.get("index", i),
                    "codec": s.get("codec_name", "unknown"),
                    "language": tags.get("language", "und"),
                    "title": tags.get("title", ""),
                    "is_default": s.get("disposition", {}).get("default", 0) == 1,
                }
            )
        return tracks


async def probe(file_path: str) -> ProbeResult:
    """Run ffprobe on a file and return parsed metadata."""
    cmd = [
        settings.ffprobe_path,
        "-v", "quiet",
        "-print_format", "json",
        "-show_format",
        "-show_streams",
        file_path,
    ]
    logger.info("Running ffprobe: %s", " ".join(cmd))

    proc = await asyncio.create_subprocess_exec(
        *cmd,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    stdout, stderr = await proc.communicate()

    if proc.returncode != 0:
        err = stderr.decode(errors="replace")
        raise RuntimeError(f"ffprobe failed (exit {proc.returncode}): {err}")

    data = json.loads(stdout.decode())
    return ProbeResult(data)
