"""Payment gateway factory.

Resolves the correct backend using:
  1. Per-tenant payment config (from tenant model)
  2. Platform-level config (from settings)
  3. Falls back to MockBackend for development
"""

from app.payments.base import PaymentBackend
from app.payments.mock_backend import MockBackend


def get_payment_backend(
    *,
    provider: str = "",
    api_key: str = "",
    api_secret: str = "",
    sandbox: bool = True,
) -> PaymentBackend:
    """Return a PaymentBackend instance for the given provider.

    Args:
        provider:   'stripe' | 'razorpay' | 'paypal' | '' (auto-detect / mock)
        api_key:    Provider API key / client ID
        api_secret: Provider secret key (used by Razorpay and PayPal)
        sandbox:    Use sandbox/test mode (PayPal)
    """
    provider = provider.lower().strip()

    if not provider or not api_key:
        return MockBackend()

    if provider == "stripe":
        from app.payments.stripe_backend import StripeBackend
        return StripeBackend(api_key=api_key)

    if provider == "razorpay":
        from app.payments.razorpay_backend import RazorpayBackend
        return RazorpayBackend(key_id=api_key, key_secret=api_secret)

    if provider == "paypal":
        from app.payments.paypal_backend import PayPalBackend
        return PayPalBackend(
            client_id=api_key,
            client_secret=api_secret,
            sandbox=sandbox,
        )

    raise ValueError(f"Unknown payment provider: {provider}")


def get_tenant_payment_backend(tenant) -> PaymentBackend:
    """Resolve payment backend for a tenant, falling back to platform defaults."""
    from app.config import settings

    # Per-tenant config takes priority
    provider = getattr(tenant, "payment_provider", "") if tenant else ""
    api_key = getattr(tenant, "payment_api_key", "") if tenant else ""
    api_secret = getattr(tenant, "payment_api_secret", "") if tenant else ""

    if provider and api_key:
        return get_payment_backend(
            provider=provider,
            api_key=api_key,
            api_secret=api_secret,
            sandbox=settings.debug,
        )

    # Fall back to platform-level config
    if settings.payment_provider and settings.payment_api_key:
        return get_payment_backend(
            provider=settings.payment_provider,
            api_key=settings.payment_api_key,
            api_secret=settings.payment_api_secret,
            sandbox=settings.debug,
        )

    return MockBackend()


def get_webhook_secret(tenant) -> str:
    """Get webhook secret — per-tenant if configured, else platform default."""
    from app.config import settings

    if tenant:
        secret = getattr(tenant, "payment_webhook_secret", "")
        if secret:
            return secret
    return settings.payment_webhook_secret
