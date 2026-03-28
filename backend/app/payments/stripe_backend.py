"""Stripe payment backend implementation."""

from app.payments.base import PaymentBackend


class StripeBackend(PaymentBackend):
    """Stripe payment gateway."""

    def __init__(self, api_key: str):
        self._api_key = api_key

    @property
    def provider_name(self) -> str:
        return "stripe"

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
        import stripe
        stripe.api_key = self._api_key

        merged_meta = {
            "user_id": user_id,
            "tenant_id": tenant_id,
            "tier_id": tier_id,
            "billing_period": billing_period,
            **(metadata or {}),
        }

        session = stripe.checkout.Session.create(
            mode="subscription",
            line_items=[{"price": price_id, "quantity": 1}],
            success_url=success_url,
            cancel_url=cancel_url,
            metadata=merged_meta,
        )
        return {
            "checkout_url": session.url,
            "session_id": session.id,
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
        import stripe
        stripe.api_key = self._api_key

        merged_meta = {
            "user_id": user_id,
            "tenant_id": tenant_id,
            **(metadata or {}),
        }

        session = stripe.checkout.Session.create(
            mode="payment",
            line_items=[{
                "price_data": {
                    "currency": currency.lower(),
                    "unit_amount": amount,
                    "product_data": {"name": description},
                },
                "quantity": 1,
            }],
            success_url=success_url,
            cancel_url=cancel_url,
            metadata=merged_meta,
        )
        return {
            "checkout_url": session.url,
            "session_id": session.id,
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
        import stripe
        try:
            event = stripe.Webhook.construct_event(body, signature, webhook_secret)
            return event
        except Exception:
            return None

    def extract_checkout_completed(self, event: dict) -> dict | None:
        event_type = event.get("type", "")
        if event_type != "checkout.session.completed":
            return None

        session = event.get("data", {}).get("object", {})
        return {
            "metadata": session.get("metadata", {}),
            "provider_subscription_id": session.get("subscription"),
            "provider_customer_id": session.get("customer"),
            "provider_payment_id": session.get("payment_intent"),
            "amount_total": session.get("amount_total", 0),
            "currency": (session.get("currency") or "usd").upper(),
        }

    async def create_portal_session(
        self,
        *,
        customer_id: str,
        return_url: str,
    ) -> dict:
        import stripe
        stripe.api_key = self._api_key

        session = stripe.billing_portal.Session.create(
            customer=customer_id,
            return_url=return_url,
        )
        return {"portal_url": session.url}
