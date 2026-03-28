"""Metadata enrichment — fetch ratings and info from OMDB and TMDB APIs.

Queries external APIs to auto-fill video metadata (ratings, plot, genre, cast).
Both API keys are optional; if not configured the enrichment is silently skipped.

Usage:
    from app.services.metadata_enrichment import enrich_metadata
    result = await enrich_metadata("Breaking Bad", season=3, episode=23)
"""

import logging
from dataclasses import dataclass, field

import httpx

from app.config import settings

logger = logging.getLogger(__name__)

_OMDB_URL = "http://www.omdbapi.com/"
_TMDB_URL = "https://api.themoviedb.org/3"

# Timeout for external API calls (seconds)
_TIMEOUT = 10.0


@dataclass
class EnrichmentResult:
    """Merged metadata from external sources."""

    title: str = ""
    description: str = ""
    year: int | None = None
    genre: str = ""
    rated: str = ""
    runtime: str = ""
    director: str = ""
    actors: str = ""
    poster_url: str = ""

    # Ratings
    imdb_rating: float | None = None
    rotten_tomatoes_score: int | None = None
    metacritic_score: int | None = None

    # Raw API responses for the external_metadata JSONB field
    raw: dict = field(default_factory=dict)


async def enrich_metadata(
    title: str,
    year: int | None = None,
    season: int | None = None,
    episode: int | None = None,
) -> EnrichmentResult | None:
    """Fetch metadata from OMDB and/or TMDB.

    Args:
        title: Video/series title to search for
        year: Optional year hint to narrow results
        season: Season number (for TV episodes)
        episode: Episode number (for TV episodes)

    Returns:
        EnrichmentResult with merged data, or None if no API keys configured.
    """
    if not settings.omdb_api_key and not settings.tmdb_api_key:
        return None

    result = EnrichmentResult()
    raw: dict = {}

    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        # OMDB
        if settings.omdb_api_key:
            try:
                omdb_data = await _fetch_omdb(client, title, year, season, episode)
                if omdb_data:
                    raw["omdb"] = omdb_data
                    _merge_omdb(result, omdb_data)
            except Exception:
                logger.warning("OMDB lookup failed for '%s'", title, exc_info=True)

        # TMDB
        if settings.tmdb_api_key:
            try:
                tmdb_data = await _fetch_tmdb(client, title, year, season, episode)
                if tmdb_data:
                    raw["tmdb"] = tmdb_data
                    _merge_tmdb(result, tmdb_data)
            except Exception:
                logger.warning("TMDB lookup failed for '%s'", title, exc_info=True)

    if not raw:
        return None

    result.raw = raw
    return result


# ─── OMDB ─────────────────────────────────────────────────────────────────────


async def _fetch_omdb(
    client: httpx.AsyncClient,
    title: str,
    year: int | None,
    season: int | None,
    episode: int | None,
) -> dict | None:
    """Query OMDB API."""
    params: dict[str, str] = {
        "apikey": settings.omdb_api_key,
        "t": title,
        "plot": "short",
    }
    if year:
        params["y"] = str(year)
    if season is not None:
        params["Season"] = str(season)
    if episode is not None:
        params["Episode"] = str(episode)

    resp = await client.get(_OMDB_URL, params=params)
    resp.raise_for_status()
    data = resp.json()

    if data.get("Response") == "False":
        return None
    return data


def _merge_omdb(result: EnrichmentResult, data: dict) -> None:
    """Merge OMDB data into EnrichmentResult."""
    if not result.title and data.get("Title"):
        result.title = data["Title"]
    if not result.description and data.get("Plot") and data["Plot"] != "N/A":
        result.description = data["Plot"]
    if not result.year and data.get("Year"):
        try:
            result.year = int(data["Year"].split("–")[0])
        except (ValueError, IndexError):
            pass
    if data.get("Genre") and data["Genre"] != "N/A":
        result.genre = data["Genre"]
    if data.get("Rated") and data["Rated"] != "N/A":
        result.rated = data["Rated"]
    if data.get("Runtime") and data["Runtime"] != "N/A":
        result.runtime = data["Runtime"]
    if data.get("Director") and data["Director"] != "N/A":
        result.director = data["Director"]
    if data.get("Actors") and data["Actors"] != "N/A":
        result.actors = data["Actors"]
    if data.get("Poster") and data["Poster"] != "N/A":
        result.poster_url = data["Poster"]

    # Ratings
    if data.get("imdbRating") and data["imdbRating"] != "N/A":
        try:
            result.imdb_rating = float(data["imdbRating"])
        except ValueError:
            pass
    if data.get("Metascore") and data["Metascore"] != "N/A":
        try:
            result.metacritic_score = int(data["Metascore"])
        except ValueError:
            pass

    # Rotten Tomatoes from Ratings array
    for rating in data.get("Ratings", []):
        if rating.get("Source") == "Rotten Tomatoes":
            try:
                result.rotten_tomatoes_score = int(rating["Value"].rstrip("%"))
            except (ValueError, KeyError):
                pass


# ─── TMDB ─────────────────────────────────────────────────────────────────────


async def _fetch_tmdb(
    client: httpx.AsyncClient,
    title: str,
    year: int | None,
    season: int | None,
    episode: int | None,
) -> dict | None:
    """Query TMDB API. Searches for movie or TV show, optionally fetches episode detail."""
    headers = {
        "Authorization": f"Bearer {settings.tmdb_api_key}",
        "Accept": "application/json",
    }

    is_tv = season is not None or episode is not None

    # Search
    if is_tv:
        search_url = f"{_TMDB_URL}/search/tv"
    else:
        search_url = f"{_TMDB_URL}/search/movie"

    params: dict[str, str] = {"query": title}
    if year:
        key = "first_air_date_year" if is_tv else "year"
        params[key] = str(year)

    resp = await client.get(search_url, params=params, headers=headers)
    resp.raise_for_status()
    search_data = resp.json()

    results = search_data.get("results", [])
    if not results:
        return None

    top = results[0]
    result_data: dict = {"search": top}

    # Fetch episode detail for TV
    if is_tv and season is not None and episode is not None:
        tv_id = top["id"]
        ep_url = f"{_TMDB_URL}/tv/{tv_id}/season/{season}/episode/{episode}"
        try:
            ep_resp = await client.get(ep_url, headers=headers)
            ep_resp.raise_for_status()
            result_data["episode"] = ep_resp.json()
        except Exception:
            pass

    return result_data


def _merge_tmdb(result: EnrichmentResult, data: dict) -> None:
    """Merge TMDB data into EnrichmentResult (fills gaps only)."""
    search = data.get("search", {})
    episode = data.get("episode", {})

    # Prefer episode overview for TV episodes
    overview = episode.get("overview") or search.get("overview", "")
    if not result.description and overview:
        result.description = overview

    # Title
    title = search.get("title") or search.get("name", "")
    if not result.title and title:
        result.title = title

    # Year
    if not result.year:
        date_str = search.get("release_date") or search.get("first_air_date", "")
        if date_str:
            try:
                result.year = int(date_str[:4])
            except (ValueError, IndexError):
                pass

    # Poster
    poster = search.get("poster_path", "")
    if not result.poster_url and poster:
        result.poster_url = f"https://image.tmdb.org/t/p/w500{poster}"

    # TMDB vote as a fallback if no IMDB rating
    if not result.imdb_rating and search.get("vote_average"):
        vote = search["vote_average"]
        if vote > 0:
            result.imdb_rating = round(float(vote), 1)
