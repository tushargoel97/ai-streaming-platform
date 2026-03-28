import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.password import hash_password
from app.auth.permissions import require_admin, require_superadmin
from app.database import get_db
from app.models.user import User

router = APIRouter(prefix="/admin/users", tags=["admin-users"])


# ── Schemas ──────────────────────────────────────────────────────────────────


class UserCreate(BaseModel):
    email: str
    username: str
    password: str
    display_name: str = ""
    role: str = "viewer"


class UserUpdate(BaseModel):
    display_name: str | None = None
    role: str | None = None
    is_active: bool | None = None


# ── Helpers ──────────────────────────────────────────────────────────────────


def _serialize_user(u: User) -> dict:
    return {
        "id": str(u.id),
        "email": u.email,
        "username": u.username,
        "display_name": u.display_name,
        "avatar_url": u.avatar_url,
        "role": u.role,
        "auth_provider": u.auth_provider,
        "is_active": u.is_active,
        "last_login_at": u.last_login_at.isoformat() if u.last_login_at else None,
        "created_at": u.created_at.isoformat() if u.created_at else None,
    }


# ── Endpoints ────────────────────────────────────────────────────────────────


@router.get("")
async def list_users(
    search: str | None = None,
    role: str | None = None,
    is_active: bool | None = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_admin),
):
    query = select(User)

    if search:
        query = query.where(
            or_(
                User.email.ilike(f"%{search}%"),
                User.username.ilike(f"%{search}%"),
                User.display_name.ilike(f"%{search}%"),
            )
        )
    if role:
        query = query.where(User.role == role)
    if is_active is not None:
        query = query.where(User.is_active == is_active)

    count_q = select(func.count()).select_from(query.subquery())
    total = (await db.execute(count_q)).scalar() or 0

    query = query.order_by(User.created_at.desc())
    query = query.offset((page - 1) * page_size).limit(page_size)
    result = await db.execute(query)
    users = result.scalars().all()

    return {
        "items": [_serialize_user(u) for u in users],
        "total": total,
        "page": page,
        "page_size": page_size,
    }


@router.get("/{user_id}")
async def get_user(
    user_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_admin),
):
    result = await db.execute(select(User).where(User.id == user_id))
    target = result.scalar_one_or_none()
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    return _serialize_user(target)


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_user(
    body: UserCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_admin),
):
    if body.role == "superadmin" and user.role != "superadmin":
        raise HTTPException(status_code=403, detail="Only superadmins can create superadmin accounts")

    if len(body.password) < 6:
        raise HTTPException(status_code=400, detail="Password must be at least 6 characters")

    # Check uniqueness
    existing = await db.execute(select(User).where(User.email == body.email))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="Email already registered")

    existing = await db.execute(select(User).where(User.username == body.username))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="Username already taken")

    new_user = User(
        email=body.email,
        username=body.username,
        password_hash=hash_password(body.password),
        display_name=body.display_name or body.username,
        role=body.role,
        auth_provider="local",
    )
    db.add(new_user)
    await db.flush()
    return _serialize_user(new_user)


@router.patch("/{user_id}")
async def update_user(
    user_id: uuid.UUID,
    body: UserUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_admin),
):
    result = await db.execute(select(User).where(User.id == user_id))
    target = result.scalar_one_or_none()
    if not target:
        raise HTTPException(status_code=404, detail="User not found")

    # Guard: can't modify yourself
    if target.id == user.id:
        if body.role is not None and body.role != user.role:
            raise HTTPException(status_code=400, detail="Cannot change your own role")
        if body.is_active is not None and not body.is_active:
            raise HTTPException(status_code=400, detail="Cannot deactivate yourself")

    # Guard: only superadmin can promote to superadmin
    if body.role == "superadmin" and user.role != "superadmin":
        raise HTTPException(status_code=403, detail="Only superadmins can assign superadmin role")

    # Guard: only superadmin can modify another superadmin
    if target.role == "superadmin" and user.role != "superadmin":
        raise HTTPException(status_code=403, detail="Only superadmins can modify superadmin accounts")

    update_data = body.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(target, field, value)

    target.updated_at = datetime.utcnow()
    await db.flush()
    return _serialize_user(target)


@router.delete("/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def deactivate_user(
    user_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_admin),
):
    result = await db.execute(select(User).where(User.id == user_id))
    target = result.scalar_one_or_none()
    if not target:
        raise HTTPException(status_code=404, detail="User not found")

    if target.id == user.id:
        raise HTTPException(status_code=400, detail="Cannot deactivate yourself")

    if target.role == "superadmin" and user.role != "superadmin":
        raise HTTPException(status_code=403, detail="Only superadmins can deactivate superadmin accounts")

    target.is_active = False
    target.updated_at = datetime.utcnow()
