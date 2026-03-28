from pydantic import BaseModel


class LoginRequest(BaseModel):
    identifier: str  # email or username
    password: str | None = None
    otp: str | None = None


class OTPRequest(BaseModel):
    identifier: str  # email or username


class RefreshRequest(BaseModel):
    refresh_token: str


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"


class RegisterRequest(BaseModel):
    email: str
    username: str
    password: str
    display_name: str | None = None


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str


class ProfileUpdateRequest(BaseModel):
    username: str | None = None
    display_name: str | None = None
    avatar_url: str | None = None
