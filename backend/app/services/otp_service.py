import secrets
import smtplib
import string
from email.message import EmailMessage

from app.config import settings
from app.database import redis_pool


async def generate_otp(email: str) -> str:
    """Generate OTP, store in Redis, and return it."""
    code = "".join(secrets.choice(string.digits) for _ in range(settings.otp_length))
    await redis_pool.setex(f"otp:{email}", settings.otp_expire_minutes * 60, code)
    return code


async def verify_otp(email: str, code: str) -> bool:
    """Verify OTP against Redis store."""
    stored = await redis_pool.get(f"otp:{email}")
    if stored and stored == code:
        await redis_pool.delete(f"otp:{email}")
        return True
    return False


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
