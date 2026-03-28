from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.requests import Request
from starlette.responses import Response
from sqlalchemy import select

from app.database import async_session
from app.models.tenant import Tenant
from app.tenant.context import current_tenant


class TenantMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        host = request.headers.get("host", "").split(":")[0]

        tenant = None
        async with async_session() as db:
            # Try exact domain match first
            if host:
                result = await db.execute(
                    select(Tenant).where(Tenant.domain == host, Tenant.is_active == True)
                )
                tenant = result.scalar_one_or_none()

            # Fallback to default tenant
            if not tenant:
                result = await db.execute(
                    select(Tenant).where(Tenant.slug == "default", Tenant.is_active == True)
                )
                tenant = result.scalar_one_or_none()

        request.state.tenant = tenant
        token = current_tenant.set(tenant)
        try:
            return await call_next(request)
        finally:
            current_tenant.reset(token)
