"""Seed script: creates complete demo data for the streaming platform.

Creates tenants, users, categories, subscription tiers, videos (downloaded
from public domain sources), series, competitions, and events.
"""
import asyncio
import os
import uuid
import urllib.request
from datetime import datetime, timedelta
from decimal import Decimal
from pathlib import Path

from sqlalchemy import select

from app.config import settings
from app.database import async_session
from app.models.user import User
from app.models.tenant import Tenant, TenantVideo, TenantSeries
from app.models.category import Category
from app.models.video import Video, VideoCategory, VideoTalent
from app.models.series import Series, Season
from app.models.talent import Talent
from app.models.subscription import SubscriptionTier, UserSubscription
from app.models.tournament import Competition
from app.models.match import Event
from app.auth.password import hash_password


MEDIA_ROOT = Path(settings.local_media_path)
UPLOADS_DIR = MEDIA_ROOT / "uploads"

# ---------------------------------------------------------------------------
# Sample videos — Blender Foundation open movies + Google sample bucket
# These are actual films/content, NOT Chromecast promo clips.
# ---------------------------------------------------------------------------
SAMPLE_VIDEOS = [
    {
        "title": "Big Buck Bunny",
        "slug": "big-buck-bunny",
        "description": (
            "Big Buck Bunny tells the story of a giant rabbit with a heart "
            "bigger than himself. When one sunny day three bullies — Frank, "
            "Rinky, and Gamera — cross his path, he decides to teach them a "
            "lesson. Award-winning animated short by Blender Foundation."
        ),
        "url": "http://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4",
        "filename": "big_buck_bunny.mp4",
        "duration": 596.0,
        "tags": ["animation", "comedy", "blender", "award-winning"],
        "content_classification": "safe",
        "min_tier_level": 0,
        "is_featured": True,
    },
    {
        "title": "Elephant's Dream",
        "slug": "elephants-dream",
        "description": (
            "Elephant's Dream is the world's first open movie, created entirely "
            "with open-source tools. It follows two characters, Proog and Emo, "
            "through a surreal mechanical world that challenges their "
            "perceptions of reality."
        ),
        "url": "http://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ElephantsDream.mp4",
        "filename": "elephants_dream.mp4",
        "duration": 653.0,
        "tags": ["animation", "sci-fi", "blender", "surreal"],
        "content_classification": "safe",
        "min_tier_level": 0,
        "is_featured": False,
    },
    {
        "title": "Sintel",
        "slug": "sintel",
        "description": (
            "Sintel is an independently produced short film by the Blender "
            "Foundation. It follows a young woman named Sintel who is searching "
            "for a baby dragon she calls Scales. A visually stunning tale of "
            "love, loss, and the passage of time."
        ),
        "url": "http://commondatastorage.googleapis.com/gtv-videos-bucket/sample/Sintel.mp4",
        "filename": "sintel.mp4",
        "duration": 888.0,
        "tags": ["animation", "fantasy", "drama", "blender"],
        "content_classification": "safe",
        "min_tier_level": 1,
        "is_featured": True,
    },
    {
        "title": "Tears of Steel",
        "slug": "tears-of-steel",
        "description": (
            "Tears of Steel is a short film by Blender Foundation featuring "
            "live-action combined with CG effects. In a dystopian future, a "
            "group of warriors and scientists try to save the world using a "
            "time machine and robots."
        ),
        "url": "http://commondatastorage.googleapis.com/gtv-videos-bucket/sample/TearsOfSteel.mp4",
        "filename": "tears_of_steel.mp4",
        "duration": 734.0,
        "tags": ["sci-fi", "action", "blender", "live-action"],
        "content_classification": "safe",
        "min_tier_level": 1,
        "is_featured": False,
    },
    {
        "title": "Volkswagen GTI Review",
        "slug": "volkswagen-gti-review",
        "description": (
            "An in-depth review of the Volkswagen GTI, covering performance, "
            "handling, interior quality, and driving experience. A must-watch "
            "for automotive enthusiasts."
        ),
        "url": "http://commondatastorage.googleapis.com/gtv-videos-bucket/sample/VolkswagenGTIReview.mp4",
        "filename": "volkswagen_gti_review.mp4",
        "duration": 42.0,
        "tags": ["automotive", "review", "cars"],
        "content_classification": "safe",
        "min_tier_level": 2,
        "is_featured": False,
    },
    {
        "title": "Subaru Outback: Street and Dirt Adventure",
        "slug": "subaru-outback-adventure",
        "description": (
            "Experience the Subaru Outback conquering both street and dirt "
            "terrain. A thrilling automotive adventure showcasing off-road "
            "capabilities."
        ),
        "url": "http://commondatastorage.googleapis.com/gtv-videos-bucket/sample/SubaruOutbackOnStreetAndDirt.mp4",
        "filename": "subaru_outback.mp4",
        "duration": 596.0,
        "tags": ["automotive", "sports", "adventure", "offroad"],
        "content_classification": "safe",
        "min_tier_level": 0,
        "is_featured": False,
    },
]

# Maps video slug -> list of (tenant_slug, category_slug) for categorization
VIDEO_CATEGORIES = {
    "big-buck-bunny": [("default", "comedy")],
    "elephants-dream": [("default", "sci-fi")],
    "sintel": [("default", "action")],
    "tears-of-steel": [("default", "sci-fi"), ("default", "action")],
    "volkswagen-gti-review": [("default", "documentaries"), ("sportstream", "motorsport")],
    "subaru-outback-adventure": [("default", "documentaries"), ("sportstream", "motorsport")],
}

# Maps video slug -> list of tenant slugs for assignment
VIDEO_TENANTS = {
    "big-buck-bunny": ["default", "animeworld"],
    "elephants-dream": ["default", "animeworld"],
    "sintel": ["default", "animeworld"],
    "tears-of-steel": ["default"],
    "volkswagen-gti-review": ["default", "sportstream"],
    "subaru-outback-adventure": ["default", "sportstream"],
}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def download_video(url: str, filepath: Path) -> bool:
    """Download a video file. Returns True on success."""
    if filepath.exists() and filepath.stat().st_size > 0:
        size_mb = filepath.stat().st_size / (1024 * 1024)
        print(f"  Already exists: {filepath.name} ({size_mb:.1f} MB)")
        return True
    try:
        print(f"  Downloading {filepath.name} ... ", end="", flush=True)
        urllib.request.urlretrieve(url, str(filepath))
        size_mb = filepath.stat().st_size / (1024 * 1024)
        print(f"OK ({size_mb:.1f} MB)")
        return True
    except Exception as e:
        print(f"FAILED: {e}")
        return False


def generate_thumbnail(video_path: Path, thumb_path: Path) -> bool:
    """Extract a thumbnail from the video at ~25% mark using FFmpeg."""
    if thumb_path.exists() and thumb_path.stat().st_size > 0:
        return True
    try:
        import subprocess
        # Get duration via ffprobe
        probe = subprocess.run(
            ["ffprobe", "-v", "error", "-show_entries", "format=duration",
             "-of", "default=noprint_wrappers=1:nokey=1", str(video_path)],
            capture_output=True, text=True, timeout=10,
        )
        dur = float(probe.stdout.strip()) if probe.stdout.strip() else 5.0
        seek = max(1.0, dur * 0.25)
        thumb_path.parent.mkdir(parents=True, exist_ok=True)
        subprocess.run(
            ["ffmpeg", "-y", "-ss", str(seek), "-i", str(video_path),
             "-frames:v", "1", "-vf", "scale=640:-1",
             "-q:v", "3", str(thumb_path)],
            capture_output=True, timeout=15,
        )
        return thumb_path.exists() and thumb_path.stat().st_size > 0
    except Exception:
        return False


async def get_or_create(session, model, filters: dict, defaults: dict | None = None, update: dict | None = None):
    """Get existing row or create new one. Optionally update existing. Returns (instance, created)."""
    stmt = select(model)
    for k, v in filters.items():
        stmt = stmt.where(getattr(model, k) == v)
    result = await session.execute(stmt)
    instance = result.scalar_one_or_none()
    if instance:
        if update:
            for k, v in update.items():
                setattr(instance, k, v)
            await session.flush()
        return instance, False
    data = {**filters, **(defaults or {})}
    instance = model(**data)
    session.add(instance)
    await session.flush()
    return instance, True


# ---------------------------------------------------------------------------
# Seed
# ---------------------------------------------------------------------------

async def seed():
    UPLOADS_DIR.mkdir(parents=True, exist_ok=True)

    async with async_session() as session:
        print("=" * 55)
        print("  StreamPlatform — Seeding Demo Data")
        print("=" * 55)

        # ── 0. Cleanup legacy data ────────────────────────────
        result = await session.execute(select(Tenant).where(Tenant.slug == "adultflix"))
        old_tenant = result.scalar_one_or_none()
        if old_tenant:
            await session.delete(old_tenant)
            await session.commit()
            print("  Removed legacy tenant: adultflix")

        # ── 1. Admin user ──────────────────────────────────────
        print("\n[1/10] Users")
        admin, created = await get_or_create(
            session, User,
            filters={"email": settings.admin_email},
            defaults={
                "username": settings.admin_username,
                "password_hash": hash_password(settings.admin_password),
                "display_name": "Admin",
                "role": "superadmin",
                "auth_provider": "local",
            },
        )
        print(f"  {'Created' if created else 'Exists'}: admin ({settings.admin_email})")

        # ── 2. Viewer users ───────────────────────────────────
        viewer_defs = [
            {
                "email": "john@example.com",
                "username": "john_smith",
                "display_name": "John Smith",
                "password": "viewer123",
            },
            {
                "email": "jane@example.com",
                "username": "jane_doe",
                "display_name": "Jane Doe",
                "password": "viewer123",
            },
        ]
        viewers = []
        for vd in viewer_defs:
            user, created = await get_or_create(
                session, User,
                filters={"email": vd["email"]},
                defaults={
                    "username": vd["username"],
                    "password_hash": hash_password(vd["password"]),
                    "display_name": vd["display_name"],
                    "role": "viewer",
                    "auth_provider": "local",
                },
            )
            print(f"  {'Created' if created else 'Exists'}: {vd['display_name']} ({vd['email']})")
            viewers.append(user)

        await session.commit()

        # ── 3. Tenants ─────────────────────────────────────────
        print("\n[2/10] Tenants")
        tenant_defs = [
            {
                "slug": "default",
                "domain": "localhost",
                "site_name": "StreamPlatform",
                "description": "Your premium streaming platform",
                "primary_color": "#E50914",
                "max_content_level": "safe",
                "age_verification": "none",
                "subscriptions_enabled": True,
                "features": {
                    "live_streaming": True,
                    "live_chat": True,
                    "recommendations": True,
                    "search": True,
                    "watch_history": True,
                },
            },
            {
                "slug": "animeworld",
                "domain": "anime.localhost",
                "site_name": "AnimeWorld",
                "description": "Your gateway to the best anime",
                "primary_color": "#FF6B35",
                "max_content_level": "mature",
                "age_verification": "click_through",
                "subscriptions_enabled": False,
                "features": {
                    "live_streaming": False,
                    "live_chat": False,
                    "recommendations": True,
                    "search": True,
                    "watch_history": True,
                },
            },
            {
                "slug": "sportstream",
                "domain": "sports.localhost",
                "site_name": "SportStream",
                "description": "Live sports streaming and highlights",
                "primary_color": "#00C853",
                "max_content_level": "safe",
                "age_verification": "none",
                "subscriptions_enabled": True,
                "features": {
                    "live_streaming": True,
                    "live_chat": True,
                    "recommendations": False,
                    "search": True,
                    "watch_history": False,
                },
            },
        ]

        tenants = {}
        for td in tenant_defs:
            non_slug = {k: v for k, v in td.items() if k != "slug"}
            tenant, created = await get_or_create(
                session, Tenant,
                filters={"slug": td["slug"]},
                defaults=non_slug,
                update={"subscriptions_enabled": td["subscriptions_enabled"], "features": td["features"]},
            )
            print(f"  {'Created' if created else 'Updated'}: {td['site_name']} ({td['domain']})")
            tenants[td["slug"]] = tenant

        await session.commit()

        # ── 4. Categories ──────────────────────────────────────
        print("\n[3/10] Categories")
        cat_defs = {
            "default": [
                {"name": "Action", "slug": "action", "description": "Action-packed movies and shows", "sort_order": 1},
                {"name": "Comedy", "slug": "comedy", "description": "Funny and lighthearted content", "sort_order": 2},
                {"name": "Sci-Fi", "slug": "sci-fi", "description": "Science fiction adventures", "sort_order": 3},
                {"name": "Documentaries", "slug": "documentaries", "description": "Real-world stories and discoveries", "sort_order": 4},
            ],
            "animeworld": [
                {"name": "Shonen", "slug": "shonen", "description": "Action anime for young adults", "sort_order": 1},
                {"name": "Fantasy", "slug": "fantasy", "description": "Magical and fantastical worlds", "sort_order": 2},
                {"name": "Slice of Life", "slug": "slice-of-life", "description": "Everyday life stories", "sort_order": 3},
            ],
            "sportstream": [
                {"name": "Football", "slug": "football", "description": "The beautiful game", "sort_order": 1},
                {"name": "Motorsport", "slug": "motorsport", "description": "Racing and automotive sports", "sort_order": 2},
                {"name": "Highlights", "slug": "highlights", "description": "Best moments and highlights", "sort_order": 3},
            ],
        }

        categories = {}  # (tenant_slug, cat_slug) -> Category
        for tenant_slug, cats in cat_defs.items():
            tenant = tenants[tenant_slug]
            for cd in cats:
                cat, created = await get_or_create(
                    session, Category,
                    filters={"tenant_id": tenant.id, "slug": cd["slug"]},
                    defaults={"name": cd["name"], "description": cd["description"], "sort_order": cd["sort_order"]},
                )
                tag = "+" if created else "="
                print(f"  {tag} {cd['name']} ({tenant_slug})")
                categories[(tenant_slug, cd["slug"])] = cat

        await session.commit()

        # ── 5. Subscription Tiers ──────────────────────────────
        print("\n[4/10] Subscription Tiers")
        tier_defs = [
            {
                "tenant_slug": "default",
                "name": "Free",
                "slug": "free",
                "tier_level": 0,
                "price_monthly": Decimal("0.00"),
                "price_yearly": Decimal("0.00"),
                "description": "Basic access with ads. Browse free content.",
                "features": {"ads": True, "max_quality": "720p", "downloads": False},
                "sort_order": 0,
            },
            {
                "tenant_slug": "default",
                "name": "Basic",
                "slug": "basic",
                "tier_level": 1,
                "price_monthly": Decimal("4.99"),
                "price_yearly": Decimal("49.99"),
                "description": "Ad-free streaming with access to the basic content library.",
                "features": {"ads": False, "max_quality": "1080p", "downloads": False},
                "sort_order": 1,
            },
            {
                "tenant_slug": "default",
                "name": "Premium",
                "slug": "premium",
                "tier_level": 2,
                "price_monthly": Decimal("9.99"),
                "price_yearly": Decimal("99.99"),
                "description": "Full access to all content. Ad-free, 4K quality, offline downloads.",
                "features": {"ads": False, "max_quality": "4k", "downloads": True},
                "sort_order": 2,
            },
            {
                "tenant_slug": "sportstream",
                "name": "Free",
                "slug": "free",
                "tier_level": 0,
                "price_monthly": Decimal("0.00"),
                "price_yearly": Decimal("0.00"),
                "description": "Watch highlights and free events.",
                "features": {"live_events": False, "replays": False},
                "sort_order": 0,
            },
            {
                "tenant_slug": "sportstream",
                "name": "Sports Pass",
                "slug": "sports-pass",
                "tier_level": 1,
                "price_monthly": Decimal("7.99"),
                "price_yearly": Decimal("79.99"),
                "description": "Full access to live events, replays, and exclusive highlights.",
                "features": {"live_events": True, "replays": True},
                "sort_order": 1,
            },
        ]

        tiers = {}  # (tenant_slug, tier_slug) -> SubscriptionTier
        for td in tier_defs:
            tenant = tenants[td["tenant_slug"]]
            tier, created = await get_or_create(
                session, SubscriptionTier,
                filters={"tenant_id": tenant.id, "slug": td["slug"]},
                defaults={k: v for k, v in td.items() if k not in ("tenant_slug", "slug")},
            )
            tag = "+" if created else "="
            print(f"  {tag} {td['name']} — ${td['price_monthly']}/mo ({td['tenant_slug']})")
            tiers[(td["tenant_slug"], td["slug"])] = tier

        await session.commit()

        # ── 6. User Subscriptions ──────────────────────────────
        print("\n[5/10] User Subscriptions")
        john = viewers[0]
        basic_tier = tiers[("default", "basic")]
        sub, created = await get_or_create(
            session, UserSubscription,
            filters={"user_id": john.id, "tenant_id": tenants["default"].id},
            defaults={
                "tier_id": basic_tier.id,
                "status": "active",
                "billing_period": "monthly",
                "current_period_start": datetime.utcnow(),
                "current_period_end": datetime.utcnow() + timedelta(days=30),
            },
        )
        print(f"  {'Created' if created else 'Exists'}: John Smith -> Basic (StreamPlatform)")
        print(f"  Jane Doe -> no subscription (free tier)")

        await session.commit()

        # ── 7. Talents ─────────────────────────────────────────
        print("\n[6/10] Talents")
        talent_defs = [
            {
                "name": "Blender Foundation",
                "slug": "blender-foundation",
                "bio": "The Blender Foundation creates stunning open-source animated films using Blender 3D software.",
            },
            {
                "name": "Sacha Goedegebure",
                "slug": "sacha-goedegebure",
                "bio": "Director and lead animator of Big Buck Bunny, known for bringing characters to life with expressive animation.",
            },
        ]

        talent_map = {}
        for td in talent_defs:
            talent, created = await get_or_create(
                session, Talent,
                filters={"slug": td["slug"]},
                defaults={"name": td["name"], "bio": td["bio"]},
            )
            print(f"  {'Created' if created else 'Exists'}: {td['name']}")
            talent_map[td["slug"]] = talent

        await session.commit()

        # ── 8. Download & Create Videos ────────────────────────
        print("\n[7/10] Videos")
        print("  Downloading sample videos to /media/uploads/ ...")
        print("  (Blender Foundation open movies — first run may take a few minutes)")

        thumbs_dir = MEDIA_ROOT / "thumbnails"
        thumbs_dir.mkdir(parents=True, exist_ok=True)

        # Clean up old Chromecast promo clips if they exist
        old_slugs = [
            "big-buck-bunny-blazes", "big-buck-bunny-escapes",
            "big-buck-bunny-fun", "big-buck-bunny-joyrides",
            "big-buck-bunny-meltdowns",
        ]
        for old_slug in old_slugs:
            result = await session.execute(select(Video).where(Video.slug == old_slug))
            old_video = result.scalar_one_or_none()
            if old_video:
                await session.delete(old_video)
                print(f"  Removed old clip: {old_slug}")
        await session.flush()

        videos = {}
        for sv in SAMPLE_VIDEOS:
            # Check if video already seeded
            result = await session.execute(select(Video).where(Video.slug == sv["slug"]))
            existing = result.scalar_one_or_none()
            if existing:
                # Back-fill manifest_path / thumbnail if missing
                filepath = UPLOADS_DIR / sv["filename"]
                changed = False
                if not existing.manifest_path and existing.source_path:
                    existing.manifest_path = existing.source_path
                    changed = True
                if not existing.thumbnail_path and filepath.exists():
                    thumb_file = thumbs_dir / f"{existing.id}.jpg"
                    if generate_thumbnail(filepath, thumb_file):
                        existing.thumbnail_path = f"thumbnails/{existing.id}.jpg"
                        changed = True
                if changed:
                    await session.flush()
                    print(f"  ~ {sv['title']} (patched)")
                else:
                    print(f"  = {sv['title']} (exists)")
                videos[sv["slug"]] = existing
                continue

            # Download video file
            filepath = UPLOADS_DIR / sv["filename"]
            downloaded = download_video(sv["url"], filepath)

            file_size = filepath.stat().st_size if downloaded else 0
            source_path = f"uploads/{sv['filename']}" if downloaded else None

            video_id = uuid.uuid4()

            # Generate thumbnail
            thumbnail_path = None
            if downloaded:
                thumb_file = thumbs_dir / f"{video_id}.jpg"
                if generate_thumbnail(filepath, thumb_file):
                    thumbnail_path = f"thumbnails/{video_id}.jpg"

            video = Video(
                id=video_id,
                title=sv["title"],
                slug=sv["slug"],
                description=sv["description"],
                original_filename=sv["filename"],
                source_path=source_path,
                manifest_path=source_path,  # MP4 fallback until HLS transcoded
                thumbnail_path=thumbnail_path,
                duration=sv["duration"],
                file_size=file_size,
                status="ready" if downloaded else "failed",
                content_classification=sv["content_classification"],
                min_tier_level=sv["min_tier_level"],
                is_featured=sv["is_featured"],
                tags=sv["tags"],
                uploaded_by=admin.id,
                published_at=datetime.utcnow(),
            )
            session.add(video)
            await session.flush()

            # Link talents (Blender Foundation films)
            blender_slugs = ["big-buck-bunny", "elephants-dream", "sintel", "tears-of-steel"]
            if sv["slug"] in blender_slugs:
                for talent_slug, talent in talent_map.items():
                    vt = VideoTalent(
                        video_id=video.id,
                        talent_id=talent.id,
                        role="Creator",
                        sort_order=0,
                    )
                    session.add(vt)

            # Link to categories
            for tenant_slug, cat_slug in VIDEO_CATEGORIES.get(sv["slug"], []):
                cat = categories.get((tenant_slug, cat_slug))
                if cat:
                    vc = VideoCategory(video_id=video.id, category_id=cat.id)
                    session.add(vc)

            # Assign to tenants
            for tenant_slug in VIDEO_TENANTS.get(sv["slug"], ["default"]):
                tenant = tenants.get(tenant_slug)
                if tenant:
                    tv = TenantVideo(tenant_id=tenant.id, video_id=video.id)
                    session.add(tv)

            print(f"  + {sv['title']} (tier={sv['min_tier_level']})")
            videos[sv["slug"]] = video

        await session.commit()

        # ── 9. Series ──────────────────────────────────────────
        print("\n[8/10] Series")
        series, created = await get_or_create(
            session, Series,
            filters={"slug": "blender-open-movies"},
            defaults={
                "title": "Blender Open Movies",
                "description": (
                    "A collection of open-source animated short films created by the "
                    "Blender Foundation. These award-winning films showcase the power "
                    "of open-source filmmaking."
                ),
                "content_classification": "safe",
                "status": "ongoing",
                "year_started": 2008,
                "tags": ["animation", "open-source", "blender"],
            },
        )

        if created:
            # Create season
            season = Season(
                series_id=series.id,
                season_number=1,
                title="Blender Foundation Films",
                description="Award-winning animated and live-action short films by the Blender Foundation.",
            )
            session.add(season)
            await session.flush()

            # Assign episodes (the actual Blender films)
            blender_episodes = [
                ("big-buck-bunny", 1),
                ("elephants-dream", 2),
                ("sintel", 3),
                ("tears-of-steel", 4),
            ]
            for slug, ep_num in blender_episodes:
                v = videos.get(slug)
                if v:
                    v.series_id = series.id
                    v.season_id = season.id
                    v.episode_number = ep_num

            # Assign to tenants
            for ts in ["default", "animeworld"]:
                session.add(TenantSeries(tenant_id=tenants[ts].id, series_id=series.id))

            print(f"  Created: Blender Open Movies (S01, 4 episodes)")
        else:
            # Update existing episodes if videos were replaced
            result = await session.execute(
                select(Season).where(Season.series_id == series.id, Season.season_number == 1)
            )
            season = result.scalar_one_or_none()
            if season:
                blender_episodes = [
                    ("big-buck-bunny", 1),
                    ("elephants-dream", 2),
                    ("sintel", 3),
                    ("tears-of-steel", 4),
                ]
                for slug, ep_num in blender_episodes:
                    v = videos.get(slug)
                    if v and not v.series_id:
                        v.series_id = series.id
                        v.season_id = season.id
                        v.episode_number = ep_num
            print(f"  Exists: Blender Open Movies")

        await session.commit()

        # ── 10. Competitions & Events ──────────────────────────
        print("\n[9/10] Competitions & Events")
        sport_football = categories.get(("sportstream", "football"))
        if sport_football:
            comp, created = await get_or_create(
                session, Competition,
                filters={
                    "tenant_id": tenants["sportstream"].id,
                    "slug": "demo-cup-2026",
                },
                defaults={
                    "category_id": sport_football.id,
                    "name": "Demo Football Cup 2026",
                    "description": (
                        "An exciting demonstration football cup tournament "
                        "featuring the best teams from around the world."
                    ),
                    "competition_type": "cup",
                    "season": "2025-26",
                    "year": 2026,
                    "status": "active",
                    "start_date": datetime(2026, 3, 1),
                    "end_date": datetime(2026, 6, 30),
                },
            )

            if created:
                event_defs = [
                    {
                        "title": "Team Alpha vs Team Beta",
                        "slug": "alpha-vs-beta-qf1",
                        "event_type": "match",
                        "round_label": "Quarter-Final 1",
                        "participant_1": "Team Alpha",
                        "participant_2": "Team Beta",
                        "venue": "National Stadium",
                        "scheduled_at": datetime(2026, 3, 20, 19, 0),
                        "status": "completed",
                        "score_1": 2,
                        "score_2": 1,
                    },
                    {
                        "title": "Team Gamma vs Team Delta",
                        "slug": "gamma-vs-delta-qf2",
                        "event_type": "match",
                        "round_label": "Quarter-Final 2",
                        "participant_1": "Team Gamma",
                        "participant_2": "Team Delta",
                        "venue": "Olympic Arena",
                        "scheduled_at": datetime.utcnow() + timedelta(days=3),
                        "status": "scheduled",
                    },
                    {
                        "title": "Team Epsilon vs Team Zeta",
                        "slug": "epsilon-vs-zeta-qf3",
                        "event_type": "match",
                        "round_label": "Quarter-Final 3",
                        "participant_1": "Team Epsilon",
                        "participant_2": "Team Zeta",
                        "venue": "City Stadium",
                        "scheduled_at": datetime.utcnow() + timedelta(days=5),
                        "status": "scheduled",
                    },
                ]
                for ed in event_defs:
                    event = Event(
                        tenant_id=tenants["sportstream"].id,
                        competition_id=comp.id,
                        **ed,
                    )
                    session.add(event)
                print(f"  Created: Demo Football Cup 2026 (3 events)")
            else:
                print(f"  Exists: Demo Football Cup 2026")
        else:
            print(f"  Skipped: no football category found")

        # Motorsport competition
        sport_motor = categories.get(("sportstream", "motorsport"))
        if sport_motor:
            comp2, created2 = await get_or_create(
                session, Competition,
                filters={
                    "tenant_id": tenants["sportstream"].id,
                    "slug": "demo-racing-series-2026",
                },
                defaults={
                    "category_id": sport_motor.id,
                    "name": "Demo Racing Series 2026",
                    "description": "High-speed racing championship featuring elite drivers.",
                    "competition_type": "championship",
                    "season": "2026",
                    "year": 2026,
                    "status": "upcoming",
                    "start_date": datetime(2026, 4, 1),
                    "end_date": datetime(2026, 11, 30),
                },
            )
            if created2:
                race = Event(
                    tenant_id=tenants["sportstream"].id,
                    competition_id=comp2.id,
                    title="Grand Prix of Demo City",
                    slug="gp-demo-city-r1",
                    event_type="race",
                    round_label="Round 1",
                    participant_1="",
                    participant_2="",
                    venue="Demo City Street Circuit",
                    scheduled_at=datetime(2026, 4, 15, 14, 0),
                    status="scheduled",
                )
                session.add(race)
                print(f"  Created: Demo Racing Series 2026 (1 event)")
            else:
                print(f"  Exists: Demo Racing Series 2026")

        await session.commit()

        # ── Summary ────────────────────────────────────────────
        print("\n[10/10] Done!")
        print("=" * 55)
        print()
        print("  TENANTS")
        print("  -------")
        print("  StreamPlatform  http://localhost:8080        (subscriptions ON)")
        print("  AnimeWorld      http://anime.localhost:8080")
        print("  SportStream     http://sports.localhost:8080 (subscriptions ON)")
        print()
        print("  ACCOUNTS")
        print("  --------")
        print(f"  Admin:  {settings.admin_email} / {settings.admin_password}")
        print("  John:   john@example.com / viewer123  (Basic subscriber)")
        print("  Jane:   jane@example.com / viewer123  (Free tier)")
        print()
        print("  SUBSCRIPTION GATING (StreamPlatform)")
        print("  ------------------------------------")
        print("  Free    ($0)     -> Big Buck Bunny, Elephant's Dream, Subaru")
        print("  Basic   ($4.99)  -> + Sintel, Tears of Steel")
        print("  Premium ($9.99)  -> + VW GTI Review (all content)")
        print()
        print("  CONTENT")
        print("  -------")
        total_ok = sum(1 for v in videos.values() if v.status == "ready")
        print(f"  Videos: {total_ok}/{len(SAMPLE_VIDEOS)} downloaded")
        print(f"  Series: Blender Open Movies (S01, 4 episodes)")
        print(f"  Competitions: 2 (Football Cup, Racing Series)")
        print(f"  Events: 4 total")
        print()
        print("  NOTE: Videos are raw MP4. Run transcoding from the admin")
        print("  panel to enable adaptive HLS playback.")
        print()


if __name__ == "__main__":
    asyncio.run(seed())
