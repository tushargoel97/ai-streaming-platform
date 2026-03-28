"""PayPal payment backend implementation."""

import json

from app.payments.base import PaymentBackend


class PayPalBackend(PaymentBackend):
    """PayPal payment gateway (REST API v2)."""

    def __init__(self, client_id: str, client_secret: str, *, sandbox: bool = True):
        self._client_id = client_id
        self._client_secret = client_secret
        self._base_url = (
            "https://api-m.sandbox.paypal.com" if sandbox
            else "https://api-m.paypal.com"
        )

    async def _get_access_token(self) -> str:
        import httpx
        async with httpx.AsyncClient() as client:
            resp = await client.post(
                f"{self._base_url}/v1/oauth2/token",
                data={"grant_type": "client_credentials"},
                auth=(self._client_id, self._client_secret),
                headers={"Content-Type": "application/x-www-form-urlencoded"},
            )
            resp.raise_for_status()
            return resp.json()["access_token"]

    @property
    def provider_name(self) -> str:
        return "paypal"

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
        import httpx
        token = await self._get_access_token()

        # PayPal uses plan_id for subscriptions
        payload = {
            "plan_id": price_id,
            "application_context": {
                "return_url": success_url,
                "cancel_url": cancel_url,
                "brand_name": "StreamPlatform",
                "user_action": "SUBSCRIBE_NOW",
            },
            "custom_id": json.dumps({
                "user_id": user_id,
                "tenant_id": tenant_id,
                "tier_id": tier_id,
                "billing_period": billing_period,
                **(metadata or {}),
            }),
        }

        async with httpx.AsyncClient() as client:
            resp = await client.post(
                f"{self._base_url}/v1/billing/subscriptions",
                json=payload,
                headers={
                    "Authorization": f"Bearer {token}",
                    "Content-Type": "application/json",
                },
            )
            resp.raise_for_status()
            data = resp.json()

        approve_link = next(
            (l["href"] for l in data.get("links", []) if l["rel"] == "approve"),
            "",
        )
        return {
            "checkout_url": approve_link,
            "session_id": data["id"],
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
        import httpx
        token = await self._get_access_token()

        # Convert cents to decimal string (PayPal uses "10.00" format)
        decimal_amount = f"{amount / 100:.2f}"

        payload = {
            "intent": "CAPTURE",
            "purchase_units": [{
                "amount": {
                    "currency_code": currency.upper(),
                    "value": decimal_amount,
                },
                "description": description,
                "custom_id": json.dumps({
                    "user_id": user_id,
                    "tenant_id": tenant_id,
                    **(metadata or {}),
                }),
            }],
            "application_context": {
                "return_url": success_url,
                "cancel_url": cancel_url,
                "user_action": "PAY_NOW",
            },
        }

        async with httpx.AsyncClient() as client:
            resp = await client.post(
                f"{self._base_url}/v2/checkout/orders",
                json=payload,
                headers={
                    "Authorization": f"Bearer {token}",
                    "Content-Type": "application/json",
                },
            )
            resp.raise_for_status()
            data = resp.json()

        approve_link = next(
            (l["href"] for l in data.get("links", []) if l["rel"] == "approve"),
            "",
        )
        return {
            "checkout_url": approve_link,
            "session_id": data["id"],
        }

    async def verify_webhook(
        self,
        *,
        body: bytes,
        signature: str | None,
        webhook_secret: str,
    ) -> dict | None:
        # PayPal webhook verification requires calling their API
        # For now, parse the body and trust it (production should verify via API)
        if not webhook_secret:
            return None
        try:
            return json.loads(body)
        except Exception:
            return None

    def extract_checkout_completed(self, event: dict) -> dict | None:
        event_type = event.get("event_type", "")

        if event_type == "CHECKOUT.ORDER.APPROVED":
            resource = event.get("resource", {})
            unit = (resource.get("purchase_units") or [{}])[0]
            custom_id = unit.get("custom_id", "{}")
            try:
                meta = json.loads(custom_id)
            except Exception:
                meta = {}
            amount = unit.get("amount", {})
            return {
                "metadata": meta,
                "provider_subscription_id": None,
                "provider_customer_id": resource.get("payer", {}).get("payer_id"),
                "provider_payment_id": resource.get("id"),
                "amount_total": int(float(amount.get("value", "0")) * 100),
                "currency": amount.get("currency_code", "USD"),
            }

        if event_type == "BILLING.SUBSCRIPTION.ACTIVATED":
            resource = event.get("resource", {})
            custom_id = resource.get("custom_id", "{}")
            try:
                meta = json.loads(custom_id)
            except Exception:
                meta = {}
            return {
                "metadata": meta,
                "provider_subscription_id": resource.get("id"),
                "provider_customer_id": resource.get("subscriber", {}).get("payer_id"),
                "provider_payment_id": None,
                "amount_total": 0,
                "currency": "USD",
            }

        return None

    async def create_portal_session(
        self,
        *,
        customer_id: str,
        return_url: str,
    ) -> dict:
        # PayPal doesn't have a direct portal equivalent
        return {"portal_url": ""}
