import re
import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.permissions import require_admin
from app.database import get_db
from app.models.category import Category
from app.models.user import User

router = APIRouter(prefix="/admin/categories", tags=["admin-categories"])


def _slugify(text: str) -> str:
    text = text.lower().strip()
    text = re.sub(r"[^\w\s-]", "", text)
    text = re.sub(r"[\s_]+", "-", text)
    text = re.sub(r"-+", "-", text)
    return text


# ── Schemas ──────────────────────────────────────────────────────────────────

class CategoryCreate(BaseModel):
    name: str
    description: str = ""
    sort_order: int = 0
    parent_id: uuid.UUID | None = None
    tenant_id: uuid.UUID | None = None
    tenant_ids: list[uuid.UUID] | None = None  # Create in multiple tenants


class CategoryUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    sort_order: int | None = None
    parent_id: uuid.UUID | None = None


class CategoryResponse(BaseModel):
    id: uuid.UUID
    tenant_id: uuid.UUID
    name: str
    slug: str
    description: str
    sort_order: int
    created_at: str

    model_config = {"from_attributes": True}


# ── Endpoints ────────────────────────────────────────────────────────────────

@router.get("")
async def list_categories(
    search: str | None = None,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_admin),
):
    query = select(Category).order_by(Category.sort_order.asc(), Category.name.asc())

    if search:
        query = query.where(Category.name.ilike(f"%{search}%"))

    result = await db.execute(query)
    categories = result.scalars().all()
    return [
        {
            "id": str(c.id),
            "tenant_id": str(c.tenant_id),
            "parent_id": str(c.parent_id) if c.parent_id else None,
            "name": c.name,
            "slug": c.slug,
            "description": c.description,
            "sort_order": c.sort_order,
            "created_at": c.created_at.isoformat(),
        }
        for c in categories
    ]


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_category(
    body: CategoryCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_admin),
):
    # Support multi-tenant creation: create one copy per tenant
    target_tenant_ids = body.tenant_ids or ([body.tenant_id] if body.tenant_id else [])
    if not target_tenant_ids:
        raise HTTPException(status_code=400, detail="At least one tenant_id is required")

    created = []
    for tid in target_tenant_ids:
        slug = _slugify(body.name)

        # Check for duplicate slug within the tenant
        existing = await db.execute(
            select(Category).where(Category.tenant_id == tid, Category.slug == slug)
        )
        if existing.scalar_one_or_none():
            # Skip if already exists in this tenant
            continue

        category = Category(
            name=body.name,
            slug=slug,
            description=body.description,
            sort_order=body.sort_order,
            parent_id=body.parent_id,
            tenant_id=tid,
        )
        db.add(category)
        await db.flush()
        created.append({
            "id": str(category.id),
            "tenant_id": str(category.tenant_id),
            "parent_id": str(category.parent_id) if category.parent_id else None,
            "name": category.name,
            "slug": category.slug,
            "description": category.description,
            "sort_order": category.sort_order,
            "created_at": category.created_at.isoformat(),
        })

    if not created:
        raise HTTPException(status_code=409, detail="Category already exists in all selected tenants")

    # Return single object if one tenant, array if multiple
    return created[0] if len(created) == 1 else created


@router.post("/{category_id}/copy-to-tenants", status_code=status.HTTP_201_CREATED)
async def copy_category_to_tenants(
    category_id: uuid.UUID,
    tenant_ids: list[uuid.UUID],
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_admin),
):
    """Copy an existing category to other tenants."""
    result = await db.execute(select(Category).where(Category.id == category_id))
    source = result.scalar_one_or_none()
    if not source:
        raise HTTPException(status_code=404, detail="Category not found")

    created = []
    for tid in tenant_ids:
        if tid == source.tenant_id:
            continue  # Skip source tenant
        slug = source.slug
        existing = await db.execute(
            select(Category).where(Category.tenant_id == tid, Category.slug == slug)
        )
        if existing.scalar_one_or_none():
            continue  # Already exists

        cat = Category(
            name=source.name,
            slug=slug,
            description=source.description,
            sort_order=source.sort_order,
            tenant_id=tid,
        )
        db.add(cat)
        await db.flush()
        created.append({
            "id": str(cat.id),
            "tenant_id": str(cat.tenant_id),
            "name": cat.name,
            "slug": cat.slug,
        })

    return {"copied": created, "count": len(created)}


@router.patch("/{category_id}")
async def update_category(
    category_id: uuid.UUID,
    body: CategoryUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_admin),
):
    result = await db.execute(select(Category).where(Category.id == category_id))
    category = result.scalar_one_or_none()
    if not category:
        raise HTTPException(status_code=404, detail="Category not found")

    update_data = body.model_dump(exclude_unset=True)
    if "name" in update_data:
        category.name = update_data["name"]
        category.slug = _slugify(update_data["name"])
    if "description" in update_data:
        category.description = update_data["description"]
    if "sort_order" in update_data:
        category.sort_order = update_data["sort_order"]
    if "parent_id" in update_data:
        category.parent_id = update_data["parent_id"]

    await db.flush()

    return {
        "id": str(category.id),
        "tenant_id": str(category.tenant_id),
        "parent_id": str(category.parent_id) if category.parent_id else None,
        "name": category.name,
        "slug": category.slug,
        "description": category.description,
        "sort_order": category.sort_order,
        "created_at": category.created_at.isoformat(),
    }


@router.delete("/{category_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_category(
    category_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_admin),
):
    result = await db.execute(select(Category).where(Category.id == category_id))
    category = result.scalar_one_or_none()
    if not category:
        raise HTTPException(status_code=404, detail="Category not found")

    await db.delete(category)
