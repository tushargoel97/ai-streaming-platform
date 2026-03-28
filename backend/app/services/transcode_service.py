"""Transcode service — orchestrates background video transcoding."""

import asyncio
import logging
import os
import shutil
import uuid
from datetime import datetime

import redis.asyncio as aioredis
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import async_session
from app.models.transcode import TranscodeJob
from app.models.video import AudioTrack, SubtitleTrack, Video, VideoQuality
from app.storage.factory import get_storage_backend
from app.utils.ffmpeg import QUALITY_PROFILES, build_transcode_command, run_ffmpeg, select_qualities
from app.utils.ffprobe import probe
from app.utils.filename_parser import parse_filename
from app.utils.thumbnails import extract_thumbnails

logger = logging.getLogger(__name__)

# Temporary working directory for transcoding
WORK_DIR = "/tmp/transcode"


async def _publish_progress(video_id: uuid.UUID, percent: float, stage: str) -> None:
    """Store transcode progress in Redis for SSE consumption."""
    r = aioredis.from_url(settings.redis_url)
    try:
        import json

        await r.set(
            f"transcode:progress:{video_id}",
            json.dumps({"percent": round(percent, 1), "stage": stage}),
            ex=3600,  # expire after 1 hour
        )
    finally:
        await r.aclose()


async def start_transcode(video_id: uuid.UUID) -> None:
    """Launch transcoding as a background asyncio task."""
    asyncio.create_task(_transcode_pipeline(video_id))


async def _transcode_pipeline(video_id: uuid.UUID) -> None:
    """Full transcode pipeline: probe → transcode → thumbnails → upload → update DB."""
    job_id: uuid.UUID | None = None
    async with async_session() as db:
        try:
            # Load video
            result = await db.execute(select(Video).where(Video.id == video_id))
            video = result.scalar_one_or_none()
            if not video:
                logger.error("Video %s not found, skipping transcode", video_id)
                return

            # Create transcode job record
            job = TranscodeJob(video_id=video_id, status="processing", started_at=datetime.utcnow())
            db.add(job)
            await db.flush()
            job_id = job.id

            video.status = "processing"
            await db.commit()

            await _publish_progress(video_id, 0, "starting")

            storage = get_storage_backend()

            # 1. Download source file to local working dir
            work_path = os.path.join(WORK_DIR, str(video_id))
            os.makedirs(work_path, exist_ok=True)

            source_ext = video.source_path.rsplit(".", 1)[-1] if video.source_path else "mp4"
            local_source = os.path.join(work_path, f"source.{source_ext}")

            await _publish_progress(video_id, 2, "downloading")

            # For local storage, resolve the actual file path
            if settings.storage_backend == "local":
                from app.storage.local import LocalStorageBackend

                backend = storage
                if isinstance(backend, LocalStorageBackend):
                    local_source = str(backend._resolve(video.source_path))
            else:
                # For cloud storage, download the file
                data = await storage.get(video.source_path)
                with open(local_source, "wb") as f:
                    f.write(data)

            # 2. Probe source file
            await _publish_progress(video_id, 5, "probing")
            probe_result = await probe(local_source)

            # Update video with probe metadata
            video.duration = probe_result.duration
            video.source_width = probe_result.width
            video.source_height = probe_result.height
            video.source_codec = probe_result.codec
            await db.commit()

            source_height = probe_result.height or 720

            # 3. Select quality profiles
            qualities = select_qualities(source_height)
            logger.info(
                "Video %s: %dx%d, %.1fs, codec=%s → transcoding %s",
                video_id,
                probe_result.width or 0,
                probe_result.height or 0,
                probe_result.duration,
                probe_result.codec,
                qualities,
            )

            # 4. Build and run FFmpeg transcode command
            transcode_output = os.path.join(work_path, "hls")
            os.makedirs(transcode_output, exist_ok=True)

            # Create subdirectories for each quality variant
            # var_stream_map uses numeric indices: 0, 1, 2...
            for i, q_name in enumerate(qualities):
                os.makedirs(os.path.join(transcode_output, str(i)), exist_ok=True)

            cmd = build_transcode_command(
                input_path=local_source,
                output_dir=transcode_output,
                qualities=qualities,
            )

            await _publish_progress(video_id, 10, "transcoding")

            async def on_transcode_progress(percent: float) -> None:
                # Transcode is 10%-80% of total progress
                overall = 10 + (percent * 0.7)
                await _publish_progress(video_id, overall, "transcoding")
                # Update job progress
                async with async_session() as progress_db:
                    result = await progress_db.execute(
                        select(TranscodeJob).where(TranscodeJob.id == job_id)
                    )
                    j = result.scalar_one_or_none()
                    if j:
                        j.progress = overall
                        await progress_db.commit()

            await run_ffmpeg(cmd, probe_result.duration, on_progress=on_transcode_progress)

            # 5. Rename numeric dirs to quality names and upload HLS output to storage
            await _publish_progress(video_id, 82, "uploading")
            storage_prefix = f"transcoded/{video_id}"

            for i, q_name in enumerate(qualities):
                variant_dir = os.path.join(transcode_output, str(i))
                if not os.path.isdir(variant_dir):
                    continue

                for fname in os.listdir(variant_dir):
                    local_file = os.path.join(variant_dir, fname)
                    storage_key = f"{storage_prefix}/{q_name}/{fname}"
                    await storage.save_file(storage_key, local_file)

                # Create VideoQuality record
                w, h, bitrate, _ = QUALITY_PROFILES[q_name]
                segment_count = len([f for f in os.listdir(variant_dir) if f.startswith("segment_")])
                quality = VideoQuality(
                    video_id=video_id,
                    quality_name=q_name,
                    width=w,
                    height=h,
                    bitrate=bitrate,
                    playlist_path=f"{storage_prefix}/{q_name}/playlist.m3u8",
                    segment_count=segment_count,
                )
                db.add(quality)

            # Upload master playlist
            master_m3u8_path = os.path.join(transcode_output, "master.m3u8")
            if os.path.exists(master_m3u8_path):
                # Rewrite master playlist to use quality-name dirs instead of numeric
                master_content = _rewrite_master_playlist(master_m3u8_path, qualities)
                await storage.save(f"{storage_prefix}/master.m3u8", master_content.encode())
                video.manifest_path = f"{storage_prefix}/master.m3u8"

            # 6. Create audio track records
            for track in probe_result.audio_tracks:
                lang = track["language"] if track["language"] != "und" else "en"
                label = track["title"] or _language_label(lang)
                audio = AudioTrack(
                    video_id=video_id,
                    language=lang,
                    label=label,
                    is_default=track["is_default"],
                    track_index=track["index"],
                )
                db.add(audio)

            # 7. Extract and upload subtitle tracks from source
            for track in probe_result.subtitle_tracks:
                lang = track["language"] if track["language"] != "und" else "en"
                label = track["title"] or _language_label(lang)
                vtt_path = os.path.join(work_path, f"sub_{lang}.vtt")

                # Extract subtitle to VTT
                extract_cmd = [
                    settings.ffmpeg_path,
                    "-y",
                    "-i", local_source,
                    "-map", f"0:{track['index']}",
                    "-c:s", "webvtt",
                    vtt_path,
                ]
                proc = await asyncio.create_subprocess_exec(
                    *extract_cmd,
                    stdout=asyncio.subprocess.DEVNULL,
                    stderr=asyncio.subprocess.PIPE,
                )
                await proc.communicate()

                if os.path.exists(vtt_path):
                    sub_storage_key = f"transcoded/{video_id}/subs/{lang}.vtt"
                    await storage.save_file(sub_storage_key, vtt_path)
                    subtitle = SubtitleTrack(
                        video_id=video_id,
                        language=lang,
                        label=label,
                        format="vtt",
                        file_path=sub_storage_key,
                        is_default=track["is_default"],
                    )
                    db.add(subtitle)

            # 8. Extract thumbnails
            await _publish_progress(video_id, 88, "thumbnails")
            thumb_dir = os.path.join(work_path, "thumbnails")
            thumb_paths = await extract_thumbnails(local_source, thumb_dir, probe_result.duration)

            if thumb_paths:
                # Upload all thumbnail candidates
                for idx, thumb_path in enumerate(thumb_paths):
                    thumb_key = f"thumbnails/{video_id}/thumb_{idx:03d}.webp"
                    await storage.save_file(thumb_key, thumb_path)

                # Auto-select first as default thumbnail
                default_thumb_key = f"thumbnails/{video_id}/thumb_000.webp"
                video.thumbnail_path = default_thumb_key

            # 9. Generate embedding for recommendation engine
            await _publish_progress(video_id, 92, "embedding")
            try:
                from app.services.embedding_service import generate_and_store_embedding

                await generate_and_store_embedding(video_id, db)
                logger.info("Embedding generated for video %s", video_id)
            except Exception:
                logger.warning("Failed to generate embedding for video %s", video_id, exc_info=True)

            # 9b. Metadata enrichment from external APIs (OMDB/TMDB)
            await _publish_progress(video_id, 94, "enriching")
            try:
                await _enrich_video_metadata(video, db)
            except Exception:
                logger.warning("Metadata enrichment failed for video %s", video_id, exc_info=True)

            # 9c. AI scene analysis — pick best preview start timestamp
            await _publish_progress(video_id, 96, "scene_analysis")
            try:
                from app.services.scene_analysis import compute_preview_timestamp
                if video.source_path:
                    video_path = f"{settings.local_media_path}/{video.source_path}"
                    ts = await compute_preview_timestamp(video_path, video)
                    video.preview_start_time = ts
                    logger.info("preview_start_time=%ss for video %s", ts, video_id)
            except Exception:
                logger.warning("Scene analysis failed for video %s", video_id, exc_info=True)

            # 10. Mark video as ready
            await _publish_progress(video_id, 95, "finalizing")
            video.status = "ready"
            video.published_at = datetime.utcnow()

            # Update job
            result = await db.execute(select(TranscodeJob).where(TranscodeJob.id == job_id))
            job = result.scalar_one_or_none()
            if job:
                job.status = "completed"
                job.progress = 100
                job.completed_at = datetime.utcnow()

            await db.commit()
            await _publish_progress(video_id, 100, "completed")
            logger.info("Transcode completed for video %s", video_id)

        except Exception as exc:
            logger.exception("Transcode failed for video %s", video_id)
            try:
                # Mark video and job as failed
                async with async_session() as err_db:
                    result = await err_db.execute(select(Video).where(Video.id == video_id))
                    v = result.scalar_one_or_none()
                    if v:
                        v.status = "failed"

                    if job_id:
                        result = await err_db.execute(
                            select(TranscodeJob).where(TranscodeJob.id == job_id)
                        )
                        j = result.scalar_one_or_none()
                        if j:
                            j.status = "failed"
                            j.error_message = str(exc)
                            j.completed_at = datetime.utcnow()

                    await err_db.commit()

                await _publish_progress(video_id, -1, "failed")
            except Exception:
                logger.exception("Failed to update error status for video %s", video_id)

        finally:
            # Clean up working directory
            work_path = os.path.join(WORK_DIR, str(video_id))
            if os.path.exists(work_path):
                shutil.rmtree(work_path, ignore_errors=True)


def _rewrite_master_playlist(master_path: str, qualities: list[str]) -> str:
    """Rewrite FFmpeg's master.m3u8 to use quality-name directories instead of numeric."""
    with open(master_path) as f:
        content = f.read()

    for i, q_name in enumerate(qualities):
        content = content.replace(f"{i}/playlist.m3u8", f"{q_name}/playlist.m3u8")

    return content


async def _enrich_video_metadata(video: Video, db: AsyncSession) -> None:
    """Attempt to enrich video metadata from OMDB/TMDB APIs.

    Uses the filename parser to extract title/season/episode hints,
    then queries external APIs. Only fills fields that are empty.
    """
    from app.services.metadata_enrichment import enrich_metadata

    parsed = parse_filename(video.original_filename or video.title)
    search_title = parsed.series_hint or parsed.title or video.title

    result = await enrich_metadata(
        title=search_title,
        year=parsed.year,
        season=parsed.season_number,
        episode=parsed.episode_number,
    )
    if not result:
        return

    # Only fill empty fields — never overwrite admin-set values
    if not video.description and result.description:
        video.description = result.description
    if result.imdb_rating and not video.imdb_rating:
        video.imdb_rating = result.imdb_rating
    if result.rotten_tomatoes_score and not video.rotten_tomatoes_score:
        video.rotten_tomatoes_score = result.rotten_tomatoes_score
    if result.metacritic_score and not video.metacritic_score:
        video.metacritic_score = result.metacritic_score
    if result.raw:
        video.external_metadata = result.raw

    await db.flush()
    logger.info("Enriched metadata for video %s from external APIs", video.id)


def _language_label(lang_code: str) -> str:
    """Map ISO 639-1 language code to human label."""
    labels = {
        "en": "English",
        "ja": "Japanese",
        "es": "Spanish",
        "fr": "French",
        "de": "German",
        "pt": "Portuguese",
        "it": "Italian",
        "ko": "Korean",
        "zh": "Chinese",
        "ru": "Russian",
        "ar": "Arabic",
        "hi": "Hindi",
    }
    return labels.get(lang_code, lang_code.upper())
