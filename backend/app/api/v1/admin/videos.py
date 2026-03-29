import json
import os
import re
import uuid
from datetime import datetime

import redis.asyncio as aioredis

import aiofiles
from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, UploadFile, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.auth.permissions import require_admin
from app.config import settings
from app.database import get_db
from app.models.tenant import TenantVideo
from app.models.user import User
from app.models.video import Video, VideoCategory
from app.schemas.video import VideoListResponse, VideoResponse, VideoUpdateRequest
from app.services.transcode_service import start_transcode
from app.storage.factory import get_storage_backend
from app.utils.filename_parser import parse_filename

router = APIRouter(prefix="/admin/videos", tags=["admin-videos"])


def _slugify(text: str) -> str:
    """Convert text to URL-friendly slug."""
    text = text.lower().strip()
    text = re.sub(r"[^\w\s-]", "", text)
    text = re.sub(r"[\s_]+", "-", text)
    text = re.sub(r"-+", "-", text)
    return text


@router.post("/upload", response_model=VideoResponse, status_code=status.HTTP_201_CREATED)
async def upload_video(
    file: UploadFile = File(...),
    title: str = Form(...),
    description: str = Form(""),
    content_classification: str = Form("safe"),
    tags: str = Form(""),  # comma-separated
    category_ids: str = Form(""),  # comma-separated UUIDs
    tenant_ids: str = Form(""),  # comma-separated tenant UUIDs
    min_tier_level: int = Form(0),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_admin),
):
    """Upload a video file. Creates a Video record with status='uploading'."""
    if not file.filename:
        raise HTTPException(status_code=400, detail="No file provided")

    # Validate content_classification
    if content_classification not in ("safe", "mature", "explicit"):
        raise HTTPException(status_code=400, detail="Invalid content_classification")

    video_id = uuid.uuid4()
    ext = file.filename.rsplit(".", 1)[-1] if "." in file.filename else "mp4"
    storage_key = f"uploads/{video_id}/original.{ext}"

    # Save file to storage via chunked streaming
    storage = get_storage_backend()
    tmp_path = f"/tmp/{video_id}.{ext}"
    file_size = 0
    async with aiofiles.open(tmp_path, "wb") as tmp:
        while chunk := await file.read(1024 * 1024):  # 1MB chunks
            await tmp.write(chunk)
            file_size += len(chunk)

    await storage.save_file(storage_key, tmp_path)

    # Clean up temp file
    os.unlink(tmp_path)

    # Build slug
    base_slug = _slugify(title)
    slug = f"{base_slug}-{str(video_id)[:8]}"

    # Parse tags
    tag_list = [t.strip() for t in tags.split(",") if t.strip()] if tags else []

    # Parse filename for metadata hints
    parsed = parse_filename(file.filename)

    video = Video(
        id=video_id,
        title=title,
        slug=slug,
        description=description,
        original_filename=file.filename,
        source_path=storage_key,
        file_size=file_size,
        content_classification=content_classification,
        tags=tag_list,
        status="uploading",
        uploaded_by=user.id,
        min_tier_level=min_tier_level,
        # Pre-fill episode info from filename (admin can override)
        episode_number=parsed.episode_number,
    )
    db.add(video)
    await db.flush()

    # Link categories
    if category_ids:
        for cid in category_ids.split(","):
            cid = cid.strip()
            if cid:
                try:
                    db.add(VideoCategory(video_id=video_id, category_id=uuid.UUID(cid)))
                except ValueError:
                    pass

    # Link tenants
    if tenant_ids:
        for tid in tenant_ids.split(","):
            tid = tid.strip()
            if tid:
                try:
                    db.add(TenantVideo(tenant_id=uuid.UUID(tid), video_id=video_id))
                except ValueError:
                    pass

    # Mark as processing and kick off transcoding
    video.status = "processing"
    await db.commit()

    # Reload with relationships
    await db.refresh(video, ["categories", "tenant_videos"])

    start_transcode(video_id)

    return VideoResponse.from_video(video)


@router.get("", response_model=VideoListResponse)
async def list_videos(
    page: int = 1,
    page_size: int = 20,
    status_filter: str | None = None,
    search: str | None = None,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_admin),
):
    """List all videos for admin (includes processing/failed)."""
    base = select(Video).where(Video.status != "deleted")

    if status_filter:
        base = base.where(Video.status == status_filter)

    if search:
        base = base.where(Video.title.ilike(f"%{search}%"))

    # Count total
    count_q = select(func.count()).select_from(base.subquery())
    total = (await db.execute(count_q)).scalar() or 0

    # Paginate with eager loading
    query = base.options(selectinload(Video.categories), selectinload(Video.tenant_videos)).order_by(Video.created_at.desc())
    query = query.offset((page - 1) * page_size).limit(page_size)
    result = await db.execute(query)
    videos = result.scalars().all()

    return VideoListResponse(
        items=[VideoResponse.from_video(v) for v in videos],
        total=total,
        page=page,
        page_size=page_size,
    )


@router.get("/{video_id}", response_model=VideoResponse)
async def get_video(
    video_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_admin),
):
    """Get a single video by ID (admin view)."""
    result = await db.execute(
        select(Video).options(selectinload(Video.categories), selectinload(Video.tenant_videos)).where(Video.id == video_id)
    )
    video = result.scalar_one_or_none()
    if not video:
        raise HTTPException(status_code=404, detail="Video not found")
    return VideoResponse.from_video(video)


@router.patch("/{video_id}", response_model=VideoResponse)
async def update_video(
    video_id: uuid.UUID,
    body: VideoUpdateRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_admin),
):
    """Update video metadata."""
    result = await db.execute(select(Video).where(Video.id == video_id))
    video = result.scalar_one_or_none()
    if not video:
        raise HTTPException(status_code=404, detail="Video not found")

    update_data = body.model_dump(exclude_unset=True)

    # Handle category_ids and tenant_ids separately
    category_ids = update_data.pop("category_ids", None)
    tenant_ids = update_data.pop("tenant_ids", None)

    for field, value in update_data.items():
        if field == "content_classification" and value not in ("safe", "mature", "explicit"):
            raise HTTPException(status_code=400, detail="Invalid content_classification")
        setattr(video, field, value)

    from sqlalchemy import delete as sa_delete

    # Update category links if provided
    if category_ids is not None:
        await db.execute(sa_delete(VideoCategory).where(VideoCategory.video_id == video_id))
        for cid in category_ids:
            db.add(VideoCategory(video_id=video_id, category_id=cid))

    # Update tenant links if provided
    if tenant_ids is not None:
        await db.execute(sa_delete(TenantVideo).where(TenantVideo.video_id == video_id))
        for tid in tenant_ids:
            db.add(TenantVideo(tenant_id=tid, video_id=video_id))

    video.updated_at = datetime.utcnow()

    # Regenerate embedding if title/description/tags changed
    embedding_fields = {"title", "description", "tags"}
    if embedding_fields & set(update_data.keys()):
        try:
            from app.services.embedding_service import generate_and_store_embedding

            await generate_and_store_embedding(video_id, db)
        except Exception:
            pass  # Non-fatal

    await db.flush()
    await db.refresh(video, ["categories", "tenant_videos"])

    return VideoResponse.from_video(video)


@router.delete("/{video_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_video(
    video_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_admin),
):
    """Soft-delete a video and remove its files from storage."""
    result = await db.execute(select(Video).where(Video.id == video_id))
    video = result.scalar_one_or_none()
    if not video:
        raise HTTPException(status_code=404, detail="Video not found")

    # Remove files from storage
    storage = get_storage_backend()
    if video.source_path:
        await storage.delete(video.source_path)
    # Delete transcoded directory
    await storage.delete_prefix(f"transcoded/{video_id}")
    await storage.delete_prefix(f"thumbnails/{video_id}")

    video.status = "deleted"
    video.updated_at = datetime.utcnow()


@router.post("/{video_id}/retranscode", response_model=VideoResponse)
async def retranscode_video(
    video_id: uuid.UUID,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_admin),
):
    """Retry transcoding for a failed video."""
    result = await db.execute(
        select(Video).options(selectinload(Video.categories), selectinload(Video.tenant_videos)).where(Video.id == video_id)
    )
    video = result.scalar_one_or_none()
    if not video:
        raise HTTPException(status_code=404, detail="Video not found")

    video.status = "processing"
    video.updated_at = datetime.utcnow()
    await db.commit()
    await db.refresh(video, ["categories", "tenant_videos"])

    background_tasks.add_task(start_transcode, video_id)

    return VideoResponse.from_video(video)


@router.post("/{video_id}/analyze-preview", response_model=VideoResponse)
async def analyze_preview(
    video_id: uuid.UUID,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_admin),
):
    """Run AI scene analysis to set the optimal preview_start_time for a video."""
    result = await db.execute(
        select(Video).options(selectinload(Video.categories), selectinload(Video.tenant_videos)).where(Video.id == video_id)
    )
    video = result.scalar_one_or_none()
    if not video:
        raise HTTPException(status_code=404, detail="Video not found")
    if not video.source_path:
        raise HTTPException(status_code=400, detail="Video has no source file")

    # Overwrite any stale "completed" key so the SSE client doesn't fire onComplete immediately
    r = aioredis.from_url(settings.redis_url)
    try:
        await r.set(
            f"analyze:progress:{video_id}",
            json.dumps({"percent": 0, "stage": "queued"}),
            ex=3600,
        )
    finally:
        await r.aclose()

    def _enqueue():
        from app.worker.tasks import analyze_scene
        analyze_scene.apply_async((str(video_id),), retry=False)

    background_tasks.add_task(_enqueue)
    return VideoResponse.from_video(video)


@router.post("/{video_id}/feature", response_model=VideoResponse)
async def toggle_featured(
    video_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_admin),
):
    """Toggle the featured flag on a video."""
    result = await db.execute(
        select(Video).options(selectinload(Video.categories), selectinload(Video.tenant_videos)).where(Video.id == video_id)
    )
    video = result.scalar_one_or_none()
    if not video:
        raise HTTPException(status_code=404, detail="Video not found")

    video.is_featured = not video.is_featured
    video.updated_at = datetime.utcnow()
    await db.commit()
    await db.refresh(video, ["categories", "tenant_videos"])
    return VideoResponse.from_video(video)
