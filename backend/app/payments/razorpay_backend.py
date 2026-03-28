"""Razorpay payment backend implementation."""

import hashlib
import hmac
import json

from app.payments.base import PaymentBackend


class RazorpayBackend(PaymentBackend):
    """Razorpay payment gateway."""

    def __init__(self, key_id: str, key_secret: str):
        self._key_id = key_id
        self._key_secret = key_secret

    def _get_client(self):
        import razorpay
        return razorpay.Client(auth=(self._key_id, self._key_secret))

    @property
    def provider_name(self) -> str:
        return "razorpay"

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
        client = self._get_client()

        # Razorpay uses plan_id for subscriptions
        subscription = client.subscription.create({
            "plan_id": price_id,
            "total_count": 12 if billing_period == "monthly" else 1,
            "notes": {
                "user_id": user_id,
                "tenant_id": tenant_id,
                "tier_id": tier_id,
                "billing_period": billing_period,
                **(metadata or {}),
            },
        })

        return {
            "checkout_url": subscription.get("short_url", ""),
            "session_id": subscription["id"],
            "provider": "razorpay",
            "key_id": self._key_id,
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
        client = self._get_client()

        order = client.order.create({
            "amount": amount,
            "currency": currency.upper(),
            "notes": {
                "user_id": user_id,
                "tenant_id": tenant_id,
                **(metadata or {}),
            },
        })

        return {
            "checkout_url": "",
            "session_id": order["id"],
            "provider": "razorpay",
            "key_id": self._key_id,
            "amount": amount,
            "currency": currency.upper(),
            "description": description,
        }

    async def verify_webhook(
        self,
        *,
        body: bytes,
        signature: str | None,
        webhook_secret: str,
    ) -> dict | None:
        if not signature or not webhook_secret:
            return None
        expected = hmac.new(
            webhook_secret.encode(),
            body,
            hashlib.sha256,
        ).hexdigest()
        if not hmac.compare_digest(expected, signature):
            return None
        return json.loads(body)

    def extract_checkout_completed(self, event: dict) -> dict | None:
        event_type = event.get("event", "")

        if event_type == "payment.captured":
            payload = event.get("payload", {}).get("payment", {}).get("entity", {})
            return {
                "metadata": payload.get("notes", {}),
                "provider_subscription_id": None,
                "provider_customer_id": payload.get("customer_id"),
                "provider_payment_id": payload.get("id"),
                "amount_total": payload.get("amount", 0),
                "currency": (payload.get("currency") or "inr").upper(),
            }

        if event_type == "subscription.activated":
            payload = event.get("payload", {}).get("subscription", {}).get("entity", {})
            return {
                "metadata": payload.get("notes", {}),
                "provider_subscription_id": payload.get("id"),
                "provider_customer_id": payload.get("customer_id"),
                "provider_payment_id": None,
                "amount_total": 0,
                "currency": "INR",
            }

        return None

    async def create_portal_session(
        self,
        *,
        customer_id: str,
        return_url: str,
    ) -> dict:
        # Razorpay doesn't have a customer portal — return empty
        return {"portal_url": ""}
