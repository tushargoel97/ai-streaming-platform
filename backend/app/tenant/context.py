import uuid
from contextvars import ContextVar
from app.models.tenant import Tenant

current_tenant: ContextVar[Tenant | None] = ContextVar("current_tenant", default=None)


def get_tenant_id() -> uuid.UUID | None:
    tenant = current_tenant.get()
    return tenant.id if tenant else None
