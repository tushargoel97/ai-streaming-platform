import random
import smtplib
import string
from email.message import EmailMessage

import redis.asyncio as aioredis

from app.config import settings


async def generate_otp(email: str) -> str:
    """Generate OTP, store in Redis, and return it."""
    code = "".join(random.choices(string.digits, k=settings.otp_length))
    r = aioredis.from_url(settings.redis_url)
    try:
        await r.setex(f"otp:{email}", settings.otp_expire_minutes * 60, code)
    finally:
        await r.aclose()
    return code


async def verify_otp(email: str, code: str) -> bool:
    """Verify OTP against Redis store."""
    r = aioredis.from_url(settings.redis_url)
    try:
        stored = await r.get(f"otp:{email}")
        if stored and stored.decode() == code:
            await r.delete(f"otp:{email}")
            return True
        return False
    finally:
        await r.aclose()


async def send_otp_email(email: str, code: str) -> None:
    """Send OTP via SMTP. Falls back to logging if SMTP is not configured."""
    if not settings.smtp_host:
        # Dev mode: print to stdout so it shows in docker logs
        print(f"[DEV] OTP for {email}: {code}", flush=True)
        return

    msg = EmailMessage()
    msg["Subject"] = f"Your login code: {code}"
    msg["From"] = settings.smtp_from_email or settings.smtp_user
    msg["To"] = email
    msg.set_content(
        f"Your one-time login code is: {code}\n\n"
        f"This code expires in {settings.otp_expire_minutes} minutes.\n"
        f"If you did not request this, please ignore this email."
    )

    # Run blocking SMTP in thread
    import asyncio
    await asyncio.to_thread(_send_smtp, msg)


def _send_smtp(msg: EmailMessage) -> None:
    with smtplib.SMTP(settings.smtp_host, settings.smtp_port) as server:
        if settings.smtp_use_tls:
            server.starttls()
        if settings.smtp_user:
            server.login(settings.smtp_user, settings.smtp_password)
        server.send_message(msg)
