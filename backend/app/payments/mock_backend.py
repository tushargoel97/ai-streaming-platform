"""Mock payment backend for development without any payment provider configured."""

import json

from app.payments.base import PaymentBackend


class MockBackend(PaymentBackend):
    """Returns fake checkout URLs for local development."""

    @property
    def provider_name(self) -> str:
        return "mock"

    async def create_subscription_checkout(
        self,
        *,
        user_id: str,
        tenant_id: str,
        tier_id: str,
        price_id: str,
        billing_period: str,
        success_url: str,
        cancel_url: str,
        metadata: dict[str, str] | None = None,
    ) -> dict:
        return {
            "checkout_url": f"{success_url}?session_id=mock_sub_session",
            "session_id": "mock_sub_session",
            "mode": "development",
        }

    async def create_one_time_checkout(
        self,
        *,
        user_id: str,
        tenant_id: str,
        amount: int,
        currency: str,
        description: str,
        success_url: str,
        cancel_url: str,
        metadata: dict[str, str] | None = None,
    ) -> dict:
        return {
            "checkout_url": f"{success_url}?session_id=mock_ppv_session",
            "session_id": "mock_ppv_session",
            "mode": "development",
        }

    async def verify_webhook(
        self,
        *,
        body: bytes,
        signature: str | None,
        webhook_secret: str,
    ) -> dict | None:
        try:
            return json.loads(body)
        except Exception:
            return None

    def extract_checkout_completed(self, event: dict) -> dict | None:
        # In dev, parse directly
        event_type = event.get("type", "")
        if event_type == "checkout.session.completed":
            session = event.get("data", {}).get("object", {})
            return {
                "metadata": session.get("metadata", {}),
                "provider_subscription_id": session.get("subscription"),
                "provider_customer_id": session.get("customer"),
                "provider_payment_id": session.get("payment_intent"),
                "amount_total": session.get("amount_total", 0),
                "currency": (session.get("currency") or "usd").upper(),
            }
        return None

    async def create_portal_session(
        self,
        *,
        customer_id: str,
        return_url: str,
    ) -> dict:
        return {"portal_url": return_url}
