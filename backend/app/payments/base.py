"""Abstract payment gateway interface.

All payment providers (Stripe, Razorpay, PayPal, etc.) implement this interface.
The rest of the codebase only talks to PaymentBackend — never to a specific provider.
"""

from abc import ABC, abstractmethod
from typing import Any


class PaymentBackend(ABC):
    """Abstract base class for payment gateway backends."""

    @property
    @abstractmethod
    def provider_name(self) -> str:
        """Return the provider identifier (e.g. 'stripe', 'razorpay', 'paypal')."""

    @abstractmethod
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
        """Create a checkout session for a subscription.

        Returns dict with at least:
          - checkout_url: str  (redirect the user here)
          - session_id: str    (provider session identifier)
        """

    @abstractmethod
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
        """Create a checkout session for a one-time payment (PPV, season pass).

        `amount` is in the smallest currency unit (cents for USD, paise for INR).

        Returns dict with at least:
          - checkout_url: str
          - session_id: str
        """

    @abstractmethod
    async def verify_webhook(
        self,
        *,
        body: bytes,
        signature: str | None,
        webhook_secret: str,
    ) -> dict | None:
        """Verify and parse an incoming webhook payload.

        Returns the parsed event dict if valid, None if signature invalid.
        """

    @abstractmethod
    def extract_checkout_completed(self, event: dict) -> dict | None:
        """Extract standardized data from a checkout-completed webhook event.

        Returns None if the event is not a checkout completion.
        Returns dict with:
          - metadata: dict          (the metadata set during checkout creation)
          - provider_subscription_id: str | None
          - provider_customer_id: str | None
          - provider_payment_id: str | None
          - amount_total: int       (smallest currency unit)
          - currency: str
        """

    @abstractmethod
    async def create_portal_session(
        self,
        *,
        customer_id: str,
        return_url: str,
    ) -> dict:
        """Create a customer billing portal session (for managing subscriptions).

        Returns dict with:
          - portal_url: str
        """
