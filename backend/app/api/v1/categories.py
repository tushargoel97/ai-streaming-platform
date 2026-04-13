from fastapi import APIRouter, Depends, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.category import Category

router = APIRouter(prefix="/categories", tags=["categories"])


@router.get("")
async def list_categories(
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """List all categories (public)."""
    query = select(Category)
    tenant = getattr(request.state, "tenant", None)
    if tenant:
        query = query.where(Category.tenant_id == tenant.id)
    query = query.order_by(Category.sort_order.asc(), Category.name.asc())
    result = await db.execute(query)
    categories = result.scalars().all()
    return [
        {
            "id": str(c.id),
            "parent_id": str(c.parent_id) if c.parent_id else None,
            "name": c.name,
            "slug": c.slug,
            "description": c.description,
        }
        for c in categories
    ]
