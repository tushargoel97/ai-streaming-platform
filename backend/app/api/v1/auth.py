import uuid
from datetime import datetime, timezone
from urllib.parse import urlencode

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import RedirectResponse
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.auth import create_access_token, create_refresh_token, decode_token
from app.auth.oauth_facebook import exchange_facebook_code, get_facebook_auth_url
from app.auth.oauth_google import exchange_google_code, get_google_auth_url
from app.auth.password import hash_password, verify_password
from app.auth.permissions import get_current_user
from app.config import settings
from app.database import get_db
from app.models.user import User
from app.schemas.auth import (
    ChangePasswordRequest,
    LoginRequest,
    OTPRequest,
    ProfileUpdateRequest,
    RefreshRequest,
    RegisterRequest,
    TokenResponse,
)
from app.schemas.user import UserResponse
from app.services.otp_service import generate_otp, send_otp_email, verify_otp

router = APIRouter(prefix="/auth")


def _find_user_query(identifier: str):
    """Build a query that matches by email or username."""
    return select(User).where(
        or_(User.email == identifier, User.username == identifier)
    )


@router.post("/register", response_model=TokenResponse, status_code=status.HTTP_201_CREATED)
async def register(body: RegisterRequest, db: AsyncSession = Depends(get_db)):
    """Register a new viewer account with email + password.

    If the email already exists from an SSO sign-in (no password set),
    we link a password to that existing account instead of rejecting.
    """
    if len(body.password) < 6:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Password must be at least 6 characters")

    # Check if email already exists
    result = await db.execute(select(User).where(User.email == body.email))
    existing_user = result.scalar_one_or_none()

    if existing_user:
        # If they already have a password, this is a true duplicate
        if existing_user.password_hash:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Email already registered")

        # SSO-only account — link a password to it so they can sign in both ways
        existing_user.password_hash = hash_password(body.password)
        if body.display_name:
            existing_user.display_name = body.display_name
        existing_user.last_login_at = datetime.now(timezone.utc)
        existing_user.updated_at = datetime.now(timezone.utc)
        db.add(existing_user)

        return TokenResponse(
            access_token=create_access_token(existing_user.id, existing_user.role),
            refresh_token=create_refresh_token(existing_user.id),
        )

    # Check username uniqueness
    result = await db.execute(select(User).where(User.username == body.username))
    if result.scalar_one_or_none():
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Username already taken")

    user = User(
        email=body.email,
        username=body.username,
        password_hash=hash_password(body.password),
        display_name=body.display_name or body.username,
        role="viewer",
        auth_provider="local",
        last_login_at=datetime.now(timezone.utc),
    )
    db.add(user)
    await db.flush()

    return TokenResponse(
        access_token=create_access_token(user.id, user.role),
        refresh_token=create_refresh_token(user.id),
    )


@router.post("/login", response_model=TokenResponse)
async def login(body: LoginRequest, db: AsyncSession = Depends(get_db)):
    result = await db.execute(_find_user_query(body.identifier))
    user = result.scalar_one_or_none()

    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")

    if not user.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Account disabled")

    # OTP login
    if body.otp:
        if not user.email:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="OTP login requires an email address on the account",
            )
        valid = await verify_otp(user.email, body.otp)
        if not valid:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired OTP")
    # Password login
    elif body.password:
        if not user.password_hash:
            # Account exists via SSO but has no password set
            provider = user.auth_provider if user.auth_provider != "local" else "SSO"
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"This account uses {provider} sign-in. Use that to log in, or sign up to set a password.",
            )
        if not verify_password(body.password, user.password_hash):
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")
    else:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Provide either password or otp",
        )

    user.last_login_at = datetime.now(timezone.utc)

    return TokenResponse(
        access_token=create_access_token(user.id, user.role),
        refresh_token=create_refresh_token(user.id),
    )


@router.post("/otp/request")
async def request_otp(body: OTPRequest, db: AsyncSession = Depends(get_db)):
    """Send an OTP to the user's email."""
    result = await db.execute(_find_user_query(body.identifier))
    user = result.scalar_one_or_none()

    if not user or not user.email:
        # Don't reveal if user exists
        return {"message": "If an account with that identifier exists, an OTP has been sent."}

    code = await generate_otp(user.email)
    await send_otp_email(user.email, code)

    return {"message": "If an account with that identifier exists, an OTP has been sent."}


@router.post("/refresh", response_model=TokenResponse)
async def refresh(body: RefreshRequest, db: AsyncSession = Depends(get_db)):
    payload = decode_token(body.refresh_token)
    if not payload or payload.get("type") != "refresh":
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid refresh token")

    user_id = payload.get("sub")
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()

    if not user or not user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")

    return TokenResponse(
        access_token=create_access_token(user.id, user.role),
        refresh_token=create_refresh_token(user.id),
    )


@router.get("/me", response_model=UserResponse)
async def get_me(user: User = Depends(get_current_user)):
    return user


@router.patch("/me", response_model=UserResponse)
async def update_profile(
    body: ProfileUpdateRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if body.username is not None and body.username != user.username:
        existing = await db.execute(select(User).where(User.username == body.username))
        if existing.scalar_one_or_none():
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Username already taken")
        user.username = body.username

    if body.display_name is not None:
        user.display_name = body.display_name

    if body.avatar_url is not None:
        user.avatar_url = body.avatar_url

    user.updated_at = datetime.now(timezone.utc)
    db.add(user)

    return user


@router.post("/changePassword")
async def change_password(
    body: ChangePasswordRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if not user.password_hash or not verify_password(body.current_password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Current password is incorrect")

    if len(body.new_password) < 6:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="New password must be at least 6 characters")

    user.password_hash = hash_password(body.new_password)
    user.updated_at = datetime.now(timezone.utc)
    db.add(user)

    return {"message": "Password changed successfully"}


# ── OAuth / SSO ──────────────────────────────────────────────────────────────


async def _handle_oauth_user(
    db: AsyncSession,
    provider: str,
    provider_id: str,
    email: str,
    name: str,
    picture: str,
) -> tuple[str, str]:
    """Find-or-create a user from an OAuth provider and return JWT tokens.

    Account linking rules:
    1. Match by provider + provider_id → existing SSO login
    2. Match by email → link SSO to existing account
    3. No match → create new user
    """
    # 1. Check if this provider_id is already linked
    result = await db.execute(
        select(User).where(User.auth_provider == provider, User.provider_id == provider_id)
    )
    user = result.scalar_one_or_none()

    if not user:
        # 2. Check by email
        if email:
            result = await db.execute(select(User).where(User.email == email))
            user = result.scalar_one_or_none()

        if user:
            # Link this provider to the existing account
            if not user.provider_id:
                user.auth_provider = provider
                user.provider_id = provider_id
            user.provider_data = {
                **(user.provider_data or {}),
                provider: {"id": provider_id, "picture": picture},
            }
            if picture and not user.avatar_url:
                user.avatar_url = picture
        else:
            # 3. Create new user
            base_username = (email.split("@")[0] if email else name.lower().replace(" ", ""))[:50]
            username = base_username

            # Ensure username uniqueness
            existing = await db.execute(select(User).where(User.username == username))
            if existing.scalar_one_or_none():
                username = f"{base_username}-{uuid.uuid4().hex[:4]}"

            user = User(
                email=email,
                username=username,
                display_name=name or username,
                avatar_url=picture,
                role="viewer",
                auth_provider=provider,
                provider_id=provider_id,
                provider_data={provider: {"id": provider_id, "picture": picture}},
            )
            db.add(user)

    if not user.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Account disabled")

    user.last_login_at = datetime.now(timezone.utc)
    await db.flush()

    access_token = create_access_token(user.id, user.role)
    refresh_token = create_refresh_token(user.id)
    return access_token, refresh_token


def _build_frontend_redirect(access_token: str, refresh_token: str) -> RedirectResponse:
    frontend_url = settings.frontend_url.rstrip("/")
    params = urlencode({"access_token": access_token, "refresh_token": refresh_token})
    return RedirectResponse(url=f"{frontend_url}/login?{params}")


@router.get("/google")
async def google_login():
    """Redirect user to Google OAuth2 consent screen."""
    if not settings.google_client_id:
        raise HTTPException(status_code=501, detail="Google OAuth not configured")
    return RedirectResponse(url=get_google_auth_url())


@router.get("/google/callback")
async def google_callback(
    code: str = Query(...),
    db: AsyncSession = Depends(get_db),
):
    """Handle Google OAuth2 callback — create/link user, redirect with tokens."""
    try:
        info = await exchange_google_code(code)
    except Exception:
        raise HTTPException(status_code=400, detail="Failed to authenticate with Google")

    if not info.get("email"):
        raise HTTPException(status_code=400, detail="Google account has no email")

    access_token, refresh_token = await _handle_oauth_user(
        db, "google", info["provider_id"], info["email"], info["name"], info["picture"]
    )
    return _build_frontend_redirect(access_token, refresh_token)


@router.get("/facebook")
async def facebook_login():
    """Redirect user to Facebook OAuth2 consent screen."""
    if not settings.facebook_client_id:
        raise HTTPException(status_code=501, detail="Facebook OAuth not configured")
    return RedirectResponse(url=get_facebook_auth_url())


@router.get("/facebook/callback")
async def facebook_callback(
    code: str = Query(...),
    db: AsyncSession = Depends(get_db),
):
    """Handle Facebook OAuth2 callback — create/link user, redirect with tokens."""
    try:
        info = await exchange_facebook_code(code)
    except Exception:
        raise HTTPException(status_code=400, detail="Failed to authenticate with Facebook")

    if not info.get("email"):
        raise HTTPException(status_code=400, detail="Facebook account has no email. Please grant email permission.")

    access_token, refresh_token = await _handle_oauth_user(
        db, "facebook", info["provider_id"], info["email"], info["name"], info["picture"]
    )
    return _build_frontend_redirect(access_token, refresh_token)
