from pydantic_settings import BaseSettings
from pydantic import Field


class Settings(BaseSettings):
    # Application
    app_name: str = "StreamPlatform"
    debug: bool = True
    api_host: str = "0.0.0.0"
    api_port: int = 8000
    app_env: str = "local"  # local | production

    # Database
    database_url: str = "postgresql+asyncpg://stream:stream@postgres:5432/streamdb"

    # Redis
    redis_url: str = "redis://redis:6379/0"

    # Storage
    storage_backend: str = "local"  # local | s3 | azure | gcs
    local_media_path: str = "/media"

    # CDN (optional — used for cloud storage in production)
    cdn_url: str = ""  # e.g. https://cdn.example.com

    # AWS S3
    aws_access_key_id: str = ""
    aws_secret_access_key: str = ""
    aws_region: str = "us-east-1"
    s3_bucket_name: str = ""
    s3_endpoint_url: str = ""  # for MinIO / S3-compatible
    s3_presigned_url_expiry: int = 3600  # seconds

    # Azure Blob Storage
    azure_storage_connection_string: str = ""
    azure_container_name: str = "media"

    # Google Cloud Storage
    gcs_bucket_name: str = ""
    gcs_credentials_path: str = ""

    # Transcoding
    ffmpeg_path: str = "ffmpeg"
    ffprobe_path: str = "ffprobe"
    transcode_segment_duration: int = 4
    hls_segment_type: str = "fmp4"

    # Live Streaming
    rtmp_port: int = 1935
    live_hls_path: str = "/media/live"

    # Auth
    jwt_secret_key: str = "change-me-in-production-use-a-strong-random-secret"
    jwt_access_token_expire_minutes: int = 30
    jwt_refresh_token_expire_days: int = 7

    # OTP
    otp_expire_minutes: int = 5
    otp_length: int = 6

    # SMTP (for OTP emails)
    smtp_host: str = ""
    smtp_port: int = 587
    smtp_user: str = ""
    smtp_password: str = ""
    smtp_from_email: str = ""
    smtp_use_tls: bool = True

    # OAuth
    google_client_id: str = ""
    google_client_secret: str = ""
    google_redirect_uri: str = "http://localhost:8080/api/v1/auth/google/callback"
    facebook_client_id: str = ""
    facebook_client_secret: str = ""
    facebook_redirect_uri: str = "http://localhost:8080/api/v1/auth/facebook/callback"
    frontend_url: str = "http://localhost:5173"

    # Payment gateway (platform-level fallback if tenant doesn't have its own)
    payment_provider: str = ""  # stripe | razorpay | paypal
    payment_api_key: str = ""
    payment_api_secret: str = ""  # used by Razorpay & PayPal
    payment_webhook_secret: str = ""

    # Metadata Enrichment (optional)
    omdb_api_key: str = ""
    tmdb_api_key: str = ""


    # AI Service
    ai_service_url: str = "http://ai:8100"

    # Recommendations
    recommendation_cache_ttl: int = 300  # seconds
    recommendation_limit: int = 12

    # Default Admin (seed)
    admin_email: str = "admin@streamplatform.local"
    admin_username: str = "admin"
    admin_password: str = "admin123"

    model_config = {"env_file": ".env", "extra": "ignore"}


settings = Settings()
