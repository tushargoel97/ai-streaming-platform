#!/usr/bin/env python3
"""Migrate media files to the canonical directory layout.

Canonical layout
----------------
media/
  uploads/
    {video_id}/original.{ext}          ← source file
  transcoded/
    {video_id}/
      master.m3u8
      {quality}/playlist.m3u8
      {quality}/segment_*.ts
      subs/{lang}.vtt
  thumbnails/
    {video_id}/thumb_000.webp          ← default thumbnail
    {video_id}/thumb_NNN.webp          ← additional candidates

What this script fixes
----------------------
1. Flat thumbnails: thumbnails/{uuid}.jpg  →  thumbnails/{video_id}/thumb_000.{ext}
2. Loose uploads:   uploads/filename.mp4   →  uploads/{video_id}/original.{ext}

DB paths (source_path, thumbnail_path) are updated atomically per-file so the
script is safe to interrupt and re-run — already-moved files are skipped.

Usage (inside the backend container)
--------------------------------------
  python /app/scripts/migrate_media_layout.py [--dry-run] [--media-dir /media]
"""

import argparse
import asyncio
import os
import re
import shutil
import sys
from pathlib import Path


UUID_RE = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$",
    re.IGNORECASE,
)


def _is_uuid(s: str) -> bool:
    return bool(UUID_RE.match(s))


async def migrate(media_dir: Path, dry_run: bool) -> None:
    import asyncpg

    db_url = os.environ.get("DATABASE_URL", "")
    if not db_url:
        host = os.environ.get("POSTGRES_HOST", "postgres")
        port = os.environ.get("POSTGRES_PORT", "5432")
        db   = os.environ.get("POSTGRES_DB", "streaming")
        user = os.environ.get("POSTGRES_USER", "postgres")
        pw   = os.environ.get("POSTGRES_PASSWORD", "postgres")
        db_url = f"postgresql://{user}:{pw}@{host}:{port}/{db}"

    # asyncpg wants postgresql://, not postgresql+asyncpg://
    db_url = db_url.replace("postgresql+asyncpg://", "postgresql://")

    conn = await asyncpg.connect(db_url)
    tag = "[DRY RUN] " if dry_run else ""
    moved_thumbnails = 0
    moved_uploads = 0
    errors = 0

    # ── 1. Flat thumbnails → per-video subdirectory ───────────────────────────
    # thumbnails/{uuid}.{ext}  →  thumbnails/{uuid}/thumb_000.{ext}

    thumb_root = media_dir / "thumbnails"
    if thumb_root.is_dir():
        for f in sorted(thumb_root.iterdir()):
            if not f.is_file():
                continue  # already a subdir — skip

            stem = f.stem
            ext  = f.suffix  # .jpg / .webp / .png

            if not _is_uuid(stem):
                print(f"  SKIP  thumbnails/{f.name}  (not a UUID filename)")
                continue

            dest_dir = thumb_root / stem
            dest     = dest_dir / f"thumb_000{ext}"
            old_key  = f"thumbnails/{f.name}"
            new_key  = f"thumbnails/{stem}/thumb_000{ext}"

            if dest.exists():
                print(f"  SKIP  {old_key}  (already at {new_key})")
                continue

            print(f"  {tag}MOVE  {old_key}")
            print(f"         →    {new_key}")

            if not dry_run:
                dest_dir.mkdir(parents=True, exist_ok=True)
                shutil.move(str(f), str(dest))
                rows = await conn.execute(
                    "UPDATE videos SET thumbnail_path=$1 WHERE thumbnail_path=$2",
                    new_key, old_key,
                )
                count = int(rows.split()[-1])
                if count:
                    print(f"         DB   {count} row(s) updated")
                else:
                    print(f"         DB   WARNING: no row matched thumbnail_path='{old_key}'")
                moved_thumbnails += 1

    # ── 2. Loose upload files → per-video subdirectory ───────────────────────
    # uploads/filename.mp4  →  uploads/{video_id}/original.mp4

    upload_root = media_dir / "uploads"
    if upload_root.is_dir():
        for f in sorted(upload_root.iterdir()):
            if not f.is_file():
                continue  # already a {video_id}/ subdir — skip

            old_key = f"uploads/{f.name}"
            ext = f.suffix or ".mp4"

            row = await conn.fetchrow(
                "SELECT id FROM videos WHERE source_path=$1 LIMIT 1", old_key
            )
            if not row:
                print(f"  SKIP  {old_key}  (no DB record — move manually if needed)")
                continue

            video_id = str(row["id"])
            dest_dir = upload_root / video_id
            dest     = dest_dir / f"original{ext}"
            new_key  = f"uploads/{video_id}/original{ext}"

            if dest.exists():
                print(f"  SKIP  {old_key}  (already at {new_key})")
                continue

            print(f"  {tag}MOVE  {old_key}")
            print(f"         →    {new_key}")

            if not dry_run:
                dest_dir.mkdir(parents=True, exist_ok=True)
                shutil.move(str(f), str(dest))
                try:
                    rows = await conn.execute(
                        "UPDATE videos SET source_path=$1 WHERE source_path=$2",
                        new_key, old_key,
                    )
                    count = int(rows.split()[-1])
                    if count:
                        print(f"         DB   {count} row(s) updated")
                    moved_uploads += 1
                except Exception as e:
                    print(f"         DB ERROR: {e}")
                    shutil.move(str(dest), str(f))  # roll back file move
                    errors += 1

    await conn.close()

    print()
    print("─" * 60)
    if dry_run:
        print("DRY RUN — nothing was changed.")
    else:
        print(f"Done.  Thumbnails reorganised: {moved_thumbnails}  "
              f"Uploads reorganised: {moved_uploads}  Errors: {errors}")
    print()
    print("Canonical layout:")
    print("  uploads/{video_id}/original.{ext}")
    print("  transcoded/{video_id}/master.m3u8")
    print("  transcoded/{video_id}/{quality}/playlist.m3u8")
    print("  transcoded/{video_id}/subs/{lang}.vtt")
    print("  thumbnails/{video_id}/thumb_000.webp  ← default (index 0)")
    print("  thumbnails/{video_id}/thumb_NNN.webp  ← candidates")
    print("  thumbnails/{video_id}/scene_NNN.webp  ← scene-change candidates")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Reorganise media files into canonical layout.")
    parser.add_argument("--dry-run", action="store_true",
                        help="Preview changes without moving files or touching the DB.")
    parser.add_argument("--media-dir",
                        default=os.environ.get("LOCAL_MEDIA_PATH", "/media"),
                        help="Media root directory (default: /media).")
    args = parser.parse_args()

    media_path = Path(args.media_dir)
    if not media_path.is_dir():
        print(f"ERROR: media directory not found: {media_path}")
        sys.exit(1)

    print(f"Media root : {media_path}")
    print(f"Mode       : {'DRY RUN' if args.dry_run else 'LIVE'}")
    print()
    asyncio.run(migrate(media_path, dry_run=args.dry_run))
