import json
import logging

from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.requests import Request
from starlette.responses import Response
from sqlalchemy import select

from app.database import async_session, redis_pool
from app.models.tenant import Tenant
from app.tenant.context import current_tenant

logger = logging.getLogger(__name__)

_TENANT_CACHE_TTL = 60  # seconds


class TenantMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        host = request.headers.get("host", "").split(":")[0]

        tenant = await self._resolve_tenant(host)

        request.state.tenant = tenant
        token = current_tenant.set(tenant)
        try:
            return await call_next(request)
        finally:
            current_tenant.reset(token)

    async def _resolve_tenant(self, host: str) -> Tenant | None:
        cache_key = f"tenant:{host}"

        # Try Redis cache first
        try:
            cached = await redis_pool.get(cache_key)
            if cached:
                if cached == "__none__":
                    return None
                data = json.loads(cached)
                # Reconstruct a detached Tenant from cached data
                tenant = Tenant.__new__(Tenant)
                for k, v in data.items():
                    setattr(tenant, k, v)
                return tenant
        except Exception:
            pass  # Redis down, fall through to DB

        # Cache miss: query DB
        tenant = None
        async with async_session() as db:
            if host:
                result = await db.execute(
                    select(Tenant).where(Tenant.domain == host, Tenant.is_active == True)
                )
                tenant = result.scalar_one_or_none()

            if not tenant:
                result = await db.execute(
                    select(Tenant).where(Tenant.slug == "default", Tenant.is_active == True)
                )
                tenant = result.scalar_one_or_none()

            # Expunge so the object is detached from the session
            if tenant:
                db.expunge(tenant)

        # Cache the result
        try:
            if tenant:
                data = {c.key: getattr(tenant, c.key) for c in Tenant.__table__.columns}
                # Convert non-serializable types
                for k, v in data.items():
                    if hasattr(v, "isoformat"):
                        data[k] = v.isoformat()
                    elif hasattr(v, "hex"):
                        data[k] = str(v)
                await redis_pool.set(cache_key, json.dumps(data), ex=_TENANT_CACHE_TTL)
            else:
                await redis_pool.set(cache_key, "__none__", ex=_TENANT_CACHE_TTL)
        except Exception:
            pass  # Redis down, no caching

        return tenant
