"""Filename parser — extract metadata hints from video filenames.

Extracts title, series name, season/episode numbers, quality hints, and year
from common naming conventions.

Examples:
    "Breaking_Bad_S03E23_720p.mkv"     → series="Breaking Bad", S=3, E=23, quality="720p"
    "Naruto.Shippuden.S01E05.1080p.mp4" → series="Naruto Shippuden", S=1, E=5
    "The.Matrix.2003.BluRay.1080p.mp4"  → title="The Matrix", year=2003
    "my_cool_video.mp4"                 → title="my cool video"
"""

import re
from dataclasses import dataclass, field


@dataclass
class ParsedFilename:
    """Result of parsing a video filename."""

    title: str = ""
    series_hint: str = ""
    season_number: int | None = None
    episode_number: int | None = None
    year: int | None = None
    source_quality_hint: str = ""
    extra_tags: list[str] = field(default_factory=list)


# Common patterns for season/episode extraction
_SEASON_EP_PATTERNS = [
    # S01E05, s01e05, S1E5
    re.compile(r"[Ss](\d{1,2})\s*[Ee](\d{1,3})"),
    # Season.1.Episode.5, Season 1 Episode 5
    re.compile(r"[Ss]eason[\s._-]*(\d{1,2})[\s._-]*[Ee]pisode[\s._-]*(\d{1,3})"),
    # 1x05
    re.compile(r"(\d{1,2})x(\d{2,3})"),
]

# Quality hints
_QUALITY_PATTERN = re.compile(
    r"\b(2160p|4[Kk]|1080p|720p|480p|360p)\b"
)

# Year in common formats (1920-2039)
_YEAR_PATTERN = re.compile(r"\b((?:19|20)\d{2})\b")

# Tags to strip from titles
_NOISE_TAGS = re.compile(
    r"\b(BluRay|BDRip|WEB[-.]?DL|WEB[-.]?Rip|HDRip|DVDRip|HDTV|"
    r"HEVC|H\.?264|H\.?265|x264|x265|AAC|DTS|AC3|FLAC|"
    r"10bit|HDR|REMUX|REPACK|PROPER|EXTENDED|UNRATED|"
    r"AMZN|NF|HULU|DSNP|ATVP)\b",
    re.IGNORECASE,
)

# Release group in brackets
_GROUP_PATTERN = re.compile(r"\[([^\]]+)\]|\(([^)]+)\)")


def parse_filename(filename: str) -> ParsedFilename:
    """Parse a video filename and extract metadata hints.

    Args:
        filename: Original filename (e.g., "Breaking_Bad_S03E23_720p.mkv")

    Returns:
        ParsedFilename with extracted hints. All fields are best-effort.
    """
    result = ParsedFilename()

    # Strip extension
    name = filename.rsplit(".", 1)[0] if "." in filename else filename

    # Remove release group tags in brackets
    name = _GROUP_PATTERN.sub(" ", name)

    # Extract quality hint
    quality_match = _QUALITY_PATTERN.search(name)
    if quality_match:
        result.source_quality_hint = quality_match.group(1).lower()

    # Extract season/episode
    for pattern in _SEASON_EP_PATTERNS:
        match = pattern.search(name)
        if match:
            result.season_number = int(match.group(1))
            result.episode_number = int(match.group(2))
            # Everything before the match is the series name
            before = name[: match.start()].strip()
            if before:
                result.series_hint = _clean_title(before)
            break

    # Extract year
    year_match = _YEAR_PATTERN.search(name)
    if year_match:
        year = int(year_match.group(1))
        # Sanity check: year should be reasonable
        if 1920 <= year <= 2039:
            result.year = year

    # Clean noise tags before building title
    cleaned = _NOISE_TAGS.sub(" ", name)

    # Remove quality hint from cleaned title
    if quality_match:
        cleaned = _QUALITY_PATTERN.sub(" ", cleaned)

    # Remove year from cleaned title (only if not part of a longer number)
    if result.year:
        cleaned = re.sub(rf"\b{result.year}\b", " ", cleaned)

    # Remove season/episode pattern from cleaned title
    for pattern in _SEASON_EP_PATTERNS:
        cleaned = pattern.sub(" ", cleaned)

    # Build title from remaining text
    title = _clean_title(cleaned)

    if result.series_hint:
        result.title = result.series_hint
    elif title:
        result.title = title

    return result


def _clean_title(text: str) -> str:
    """Normalize separators and whitespace to produce a clean title."""
    # Replace common separators with spaces
    text = re.sub(r"[._-]+", " ", text)
    # Collapse whitespace
    text = re.sub(r"\s+", " ", text).strip()
    # Title case
    if text and text == text.lower():
        text = text.title()
    return text
