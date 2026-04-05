"""initial_schema

Revision ID: 0001
Revises:
Create Date: 2026-03-28 12:00:00.000000

Consolidated migration covering the full schema.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql
from sqlalchemy.dialects.postgresql import UUID
import pgvector.sqlalchemy.vector

# revision identifiers, used by Alembic.
revision: str = "0001"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Extensions
    op.execute("CREATE EXTENSION IF NOT EXISTS vector")

    # ── Standalone tables (no FKs) ─────────────────────────────────────

    op.create_table(
        "series",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("title", sa.String(500), nullable=False),
        sa.Column("slug", sa.String(500), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("poster_url", sa.String(500), nullable=False),
        sa.Column("banner_url", sa.String(500), nullable=False),
        sa.Column("content_classification", sa.String(10), nullable=False),
        sa.Column("status", sa.String(20), nullable=False),
        sa.Column("year_started", sa.Integer(), nullable=True),
        sa.Column("tags", postgresql.ARRAY(sa.String()), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("slug"),
    )

    op.create_table(
        "talents",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("slug", sa.String(255), nullable=False),
        sa.Column("bio", sa.Text(), nullable=False),
        sa.Column("photo_url", sa.String(500), nullable=False),
        sa.Column("birth_date", sa.Date(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("slug"),
    )

    op.create_table(
        "tenants",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("slug", sa.String(100), nullable=False),
        sa.Column("domain", sa.String(255), nullable=False),
        sa.Column("site_name", sa.String(255), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("logo_url", sa.String(500), nullable=False),
        sa.Column("favicon_url", sa.String(500), nullable=False),
        sa.Column("primary_color", sa.String(7), nullable=False),
        sa.Column("secondary_color", sa.String(7), nullable=False),
        sa.Column("background_color", sa.String(7), nullable=False),
        sa.Column("features", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("max_content_level", sa.String(10), nullable=False),
        sa.Column("age_verification", sa.String(20), nullable=False),
        sa.Column("content_rating_system", sa.String(20), nullable=False),
        sa.Column("default_content_rating", sa.String(10), nullable=False),
        sa.Column("payment_provider", sa.String(20), server_default="", nullable=False),
        sa.Column("payment_api_key", sa.String(255), server_default="", nullable=False),
        sa.Column("payment_api_secret", sa.String(255), server_default="", nullable=False),
        sa.Column("payment_webhook_secret", sa.String(255), server_default="", nullable=False),
        sa.Column("subscriptions_enabled", sa.Boolean(), server_default="false", nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False),
        sa.Column("maintenance_mode", sa.Boolean(), server_default="false", nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("domain"),
        sa.UniqueConstraint("slug"),
    )

    op.create_table(
        "users",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("email", sa.String(255), nullable=False),
        sa.Column("username", sa.String(100), nullable=False),
        sa.Column("password_hash", sa.String(255), nullable=True),
        sa.Column("display_name", sa.String(200), nullable=False),
        sa.Column("avatar_url", sa.String(500), nullable=False),
        sa.Column("role", sa.String(20), nullable=False),
        sa.Column("auth_provider", sa.String(20), nullable=False),
        sa.Column("provider_id", sa.String(255), nullable=True),
        sa.Column("provider_data", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False),
        sa.Column("last_login_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("email"),
        sa.UniqueConstraint("username"),
    )

    # ── Tables with tenant/user FKs ────────────────────────────────────

    op.create_table(
        "categories",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("tenant_id", sa.UUID(), nullable=False),
        sa.Column("parent_id", sa.UUID(), nullable=True),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("slug", sa.String(100), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("sort_order", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["parent_id"], ["categories.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("tenant_id", "slug"),
    )
    op.create_index("idx_categories_parent", "categories", ["parent_id"])

    op.create_table(
        "live_streams",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("tenant_id", sa.UUID(), nullable=False),
        sa.Column("created_by", sa.UUID(), nullable=True),
        sa.Column("category_id", sa.UUID(), nullable=True),
        sa.Column("title", sa.String(500), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("is_ppv", sa.Boolean(), server_default="false", nullable=False),
        sa.Column("ppv_price", sa.Numeric(10, 2), nullable=True),
        sa.Column("ppv_currency", sa.String(3), server_default="USD", nullable=False),
        sa.Column("stream_key", sa.String(100), nullable=False),
        sa.Column("status", sa.String(20), nullable=False),
        sa.Column("manifest_path", sa.String(1000), nullable=True),
        sa.Column("thumbnail_path", sa.String(500), nullable=True),
        sa.Column("viewer_count", sa.Integer(), nullable=False),
        sa.Column("peak_viewers", sa.Integer(), nullable=False),
        sa.Column("started_at", sa.DateTime(), nullable=True),
        sa.Column("ended_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["category_id"], ["categories.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("stream_key"),
    )
    op.create_index("idx_live_streams_category", "live_streams", ["category_id"])

    op.create_table(
        "seasons",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("series_id", sa.UUID(), nullable=False),
        sa.Column("season_number", sa.Integer(), nullable=False),
        sa.Column("title", sa.String(500), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("poster_url", sa.String(500), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["series_id"], ["series.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("series_id", "season_number"),
    )

    op.create_table(
        "tenant_series",
        sa.Column("tenant_id", sa.UUID(), nullable=False),
        sa.Column("series_id", sa.UUID(), nullable=False),
        sa.ForeignKeyConstraint(["series_id"], ["series.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("tenant_id", "series_id"),
    )

    # ── Videos ─────────────────────────────────────────────────────────

    op.create_table(
        "videos",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("category_id", sa.UUID(), nullable=True),
        sa.Column("uploaded_by", sa.UUID(), nullable=True),
        sa.Column("series_id", sa.UUID(), nullable=True),
        sa.Column("season_id", sa.UUID(), nullable=True),
        sa.Column("episode_number", sa.Integer(), nullable=True),
        sa.Column("title", sa.String(500), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("slug", sa.String(500), nullable=False),
        sa.Column("original_filename", sa.String(500), nullable=True),
        sa.Column("source_path", sa.String(1000), nullable=True),
        sa.Column("duration", sa.Float(), nullable=False),
        sa.Column("source_width", sa.Integer(), nullable=True),
        sa.Column("source_height", sa.Integer(), nullable=True),
        sa.Column("source_codec", sa.String(50), nullable=True),
        sa.Column("file_size", sa.BigInteger(), nullable=False),
        sa.Column("manifest_path", sa.String(1000), nullable=True),
        sa.Column("thumbnail_path", sa.String(500), nullable=True),
        sa.Column("status", sa.String(20), nullable=False),
        sa.Column("content_classification", sa.String(10), nullable=False),
        sa.Column("min_tier_level", sa.Integer(), server_default="0", nullable=False),
        sa.Column("imdb_rating", sa.Float(), nullable=True),
        sa.Column("rotten_tomatoes_score", sa.Integer(), nullable=True),
        sa.Column("metacritic_score", sa.Integer(), nullable=True),
        sa.Column("external_metadata", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("view_count", sa.BigInteger(), nullable=False),
        sa.Column("is_featured", sa.Boolean(), nullable=False),
        sa.Column("tags", postgresql.ARRAY(sa.String()), nullable=False),
        sa.Column("published_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["category_id"], ["categories.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["season_id"], ["seasons.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["series_id"], ["series.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["uploaded_by"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("slug"),
    )

    # ── Video child tables ─────────────────────────────────────────────

    op.create_table(
        "audio_tracks",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("video_id", sa.UUID(), nullable=False),
        sa.Column("language", sa.String(10), nullable=False),
        sa.Column("label", sa.String(100), nullable=False),
        sa.Column("is_default", sa.Boolean(), nullable=False),
        sa.Column("track_index", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["video_id"], ["videos.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )

    op.create_table(
        "subtitle_tracks",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("video_id", sa.UUID(), nullable=False),
        sa.Column("language", sa.String(10), nullable=False),
        sa.Column("label", sa.String(100), nullable=False),
        sa.Column("format", sa.String(10), nullable=False),
        sa.Column("file_path", sa.String(1000), nullable=False),
        sa.Column("is_default", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["video_id"], ["videos.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )

    op.create_table(
        "tenant_videos",
        sa.Column("tenant_id", sa.UUID(), nullable=False),
        sa.Column("video_id", sa.UUID(), nullable=False),
        sa.Column("content_rating", sa.String(10), nullable=False),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["video_id"], ["videos.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("tenant_id", "video_id"),
    )

    # ── Competitions / Events ─────────────────────────────────────────

    op.create_table(
        "competitions",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("tenant_id", sa.UUID(), nullable=False),
        sa.Column("category_id", sa.UUID(), nullable=False),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("slug", sa.String(255), nullable=False),
        sa.Column("description", sa.Text(), server_default="", nullable=False),
        sa.Column("logo_url", sa.String(500), server_default="", nullable=False),
        sa.Column("competition_type", sa.String(30), server_default="tournament", nullable=False),
        sa.Column("season", sa.String(50), nullable=True),
        sa.Column("year", sa.Integer(), nullable=True),
        sa.Column("status", sa.String(20), server_default="upcoming", nullable=False),
        sa.Column("start_date", sa.DateTime(), nullable=True),
        sa.Column("end_date", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["category_id"], ["categories.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("tenant_id", "slug"),
    )
    op.create_index("idx_competitions_category", "competitions", ["category_id"])
    op.create_index("idx_competitions_status", "competitions", ["status"])

    op.create_table(
        "events",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("tenant_id", sa.UUID(), nullable=False),
        sa.Column("competition_id", sa.UUID(), nullable=False),
        sa.Column("title", sa.String(500), nullable=False),
        sa.Column("slug", sa.String(500), nullable=False),
        sa.Column("description", sa.Text(), server_default="", nullable=False),
        sa.Column("event_type", sa.String(30), server_default="match", nullable=False),
        sa.Column("round_label", sa.String(100), server_default="", nullable=False),
        sa.Column("participant_1", sa.String(255), server_default="", nullable=False),
        sa.Column("participant_2", sa.String(255), server_default="", nullable=False),
        sa.Column("venue", sa.String(255), server_default="", nullable=False),
        sa.Column("scheduled_at", sa.DateTime(), nullable=False),
        sa.Column("status", sa.String(20), server_default="scheduled", nullable=False),
        sa.Column("score_1", sa.Integer(), nullable=True),
        sa.Column("score_2", sa.Integer(), nullable=True),
        sa.Column("result_data", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("live_stream_id", sa.UUID(), nullable=True),
        sa.Column("replay_video_id", sa.UUID(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["competition_id"], ["competitions.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["live_stream_id"], ["live_streams.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["replay_video_id"], ["videos.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("tenant_id", "slug"),
    )
    op.create_index("idx_events_competition", "events", ["competition_id"])
    op.create_index("idx_events_scheduled", "events", ["scheduled_at"])
    op.create_index("idx_events_status", "events", ["status"])
    op.create_index("idx_events_live_stream", "events", ["live_stream_id"])

    op.create_table(
        "event_highlights",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("event_id", sa.UUID(), nullable=False),
        sa.Column("video_id", sa.UUID(), nullable=False),
        sa.Column("title", sa.String(255), nullable=False),
        sa.Column("timestamp_in_event", sa.Integer(), nullable=True),
        sa.Column("highlight_type", sa.String(50), server_default="other", nullable=False),
        sa.Column("sort_order", sa.Integer(), server_default="0", nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["event_id"], ["events.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["video_id"], ["videos.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("idx_event_highlights_event", "event_highlights", ["event_id"])

    # ── Transcode / Embeddings / Qualities ────────────────────────────

    op.create_table(
        "transcode_jobs",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("video_id", sa.UUID(), nullable=False),
        sa.Column("status", sa.String(20), nullable=False),
        sa.Column("progress", sa.Float(), nullable=False),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("started_at", sa.DateTime(), nullable=True),
        sa.Column("completed_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["video_id"], ["videos.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )

    op.create_table(
        "video_embeddings",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("video_id", sa.UUID(), nullable=False),
        sa.Column("embedding", pgvector.sqlalchemy.vector.VECTOR(dim=384), nullable=False),
        sa.Column("model_version", sa.String(50), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["video_id"], ["videos.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("video_id"),
    )
    op.create_index(
        "ix_video_embeddings_hnsw",
        "video_embeddings",
        ["embedding"],
        postgresql_using="hnsw",
        postgresql_with={"m": 16, "ef_construction": 64},
        postgresql_ops={"embedding": "vector_cosine_ops"},
    )

    op.create_table(
        "video_qualities",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("video_id", sa.UUID(), nullable=False),
        sa.Column("quality_name", sa.String(10), nullable=False),
        sa.Column("width", sa.Integer(), nullable=False),
        sa.Column("height", sa.Integer(), nullable=False),
        sa.Column("bitrate", sa.Integer(), nullable=False),
        sa.Column("playlist_path", sa.String(1000), nullable=False),
        sa.Column("segment_count", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["video_id"], ["videos.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )

    op.create_table(
        "video_talents",
        sa.Column("video_id", sa.UUID(), nullable=False),
        sa.Column("talent_id", sa.UUID(), nullable=False),
        sa.Column("role", sa.String(100), nullable=False),
        sa.Column("sort_order", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(["talent_id"], ["talents.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["video_id"], ["videos.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("video_id", "talent_id"),
    )

    op.create_table(
        "video_categories",
        sa.Column("video_id", UUID(as_uuid=True), nullable=False),
        sa.Column("category_id", UUID(as_uuid=True), nullable=False),
        sa.ForeignKeyConstraint(["video_id"], ["videos.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["category_id"], ["categories.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("video_id", "category_id"),
    )
    op.create_index("idx_vc_category", "video_categories", ["category_id"])

    op.create_table(
        "view_events",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("video_id", sa.UUID(), nullable=False),
        sa.Column("user_id", sa.UUID(), nullable=True),
        sa.Column("session_id", sa.String(100), nullable=True),
        sa.Column("duration_watched", sa.Float(), nullable=False),
        sa.Column("quality", sa.String(10), nullable=True),
        sa.Column("ip_address", postgresql.INET(), nullable=True),
        sa.Column("user_agent", sa.String(500), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["video_id"], ["videos.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )

    op.create_table(
        "watch_history",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("user_id", sa.UUID(), nullable=False),
        sa.Column("video_id", sa.UUID(), nullable=False),
        sa.Column("progress", sa.Float(), nullable=False),
        sa.Column("completed", sa.Boolean(), nullable=False),
        sa.Column("watch_count", sa.Integer(), server_default="0", nullable=False),
        sa.Column("last_watched_at", sa.DateTime(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["video_id"], ["videos.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "video_id"),
    )

    # ── Watchlist & Reactions ──────────────────────────────────────────

    op.create_table(
        "watchlist",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("user_id", sa.UUID(), nullable=False),
        sa.Column("video_id", sa.UUID(), nullable=False),
        sa.Column("added_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["video_id"], ["videos.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "video_id"),
    )
    op.create_index("idx_watchlist_user", "watchlist", ["user_id", "added_at"])

    op.create_table(
        "video_reactions",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("user_id", sa.UUID(), nullable=False),
        sa.Column("video_id", sa.UUID(), nullable=False),
        sa.Column("reaction", sa.String(10), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["video_id"], ["videos.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "video_id"),
    )
    op.create_index("idx_reactions_video", "video_reactions", ["video_id"])
    op.create_index("idx_reactions_user", "video_reactions", ["user_id"])

    # ── Subscription / Monetization tables ────────────────────────────

    op.create_table(
        "subscription_tiers",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("tenant_id", sa.UUID(), nullable=False),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("slug", sa.String(100), nullable=False),
        sa.Column("tier_level", sa.Integer(), nullable=False),
        sa.Column("description", sa.Text(), server_default="", nullable=False),
        sa.Column("features", postgresql.JSONB(astext_type=sa.Text()), server_default="{}", nullable=False),
        sa.Column("is_active", sa.Boolean(), server_default="true", nullable=False),
        sa.Column("sort_order", sa.Integer(), server_default="0", nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("tenant_id", "slug"),
    )

    op.create_table(
        "subscription_tier_prices",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("tier_id", sa.UUID(), nullable=False),
        sa.Column("currency", sa.String(3), server_default="USD", nullable=False),
        sa.Column("regions", postgresql.JSONB(astext_type=sa.Text()), server_default="[]", nullable=False),
        sa.Column("price_monthly", sa.Numeric(10, 2), server_default="0", nullable=False),
        sa.Column("price_yearly", sa.Numeric(10, 2), server_default="0", nullable=False),
        sa.Column("gateway_price_id_monthly", sa.String(255), nullable=True),
        sa.Column("gateway_price_id_yearly", sa.String(255), nullable=True),
        sa.Column("is_default", sa.Boolean(), server_default="false", nullable=False),
        sa.Column("sort_order", sa.Integer(), server_default="0", nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["tier_id"], ["subscription_tiers.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_subscription_tier_prices_tier_id", "subscription_tier_prices", ["tier_id"])

    op.create_table(
        "user_subscriptions",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("user_id", sa.UUID(), nullable=False),
        sa.Column("tenant_id", sa.UUID(), nullable=False),
        sa.Column("tier_id", sa.UUID(), nullable=True),
        sa.Column("status", sa.String(20), server_default="active", nullable=False),
        sa.Column("is_lifetime", sa.Boolean(), server_default="false", nullable=False),
        sa.Column("billing_period", sa.String(10), server_default="monthly", nullable=False),
        sa.Column("payment_provider", sa.String(20), nullable=True),
        sa.Column("provider_subscription_id", sa.String(255), nullable=True),
        sa.Column("provider_customer_id", sa.String(255), nullable=True),
        sa.Column("current_period_start", sa.DateTime(), nullable=True),
        sa.Column("current_period_end", sa.DateTime(), nullable=True),
        sa.Column("cancelled_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["tier_id"], ["subscription_tiers.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "tenant_id"),
    )

    op.create_table(
        "ppv_purchases",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("user_id", sa.UUID(), nullable=False),
        sa.Column("live_stream_id", sa.UUID(), nullable=False),
        sa.Column("price_paid", sa.Numeric(10, 2), nullable=False),
        sa.Column("currency", sa.String(3), server_default="USD", nullable=False),
        sa.Column("payment_provider", sa.String(20), nullable=True),
        sa.Column("provider_payment_id", sa.String(255), nullable=True),
        sa.Column("status", sa.String(20), server_default="completed", nullable=False),
        sa.Column("purchased_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["live_stream_id"], ["live_streams.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "live_stream_id"),
    )

    op.create_table(
        "season_pass_configs",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("tenant_id", sa.UUID(), nullable=False),
        sa.Column("category_id", sa.UUID(), nullable=False),
        sa.Column("season_label", sa.String(100), nullable=False),
        sa.Column("price", sa.Numeric(10, 2), nullable=False),
        sa.Column("currency", sa.String(3), server_default="USD", nullable=False),
        sa.Column("gateway_price_id", sa.String(255), nullable=True),
        sa.Column("valid_from", sa.DateTime(), nullable=False),
        sa.Column("valid_until", sa.DateTime(), nullable=False),
        sa.Column("is_active", sa.Boolean(), server_default="true", nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["category_id"], ["categories.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("tenant_id", "category_id", "season_label"),
    )

    op.create_table(
        "season_passes",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("user_id", sa.UUID(), nullable=False),
        sa.Column("season_pass_config_id", sa.UUID(), nullable=False),
        sa.Column("price_paid", sa.Numeric(10, 2), nullable=False),
        sa.Column("currency", sa.String(3), server_default="USD", nullable=False),
        sa.Column("payment_provider", sa.String(20), nullable=True),
        sa.Column("provider_payment_id", sa.String(255), nullable=True),
        sa.Column("status", sa.String(20), server_default="active", nullable=False),
        sa.Column("purchased_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["season_pass_config_id"], ["season_pass_configs.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "season_pass_config_id"),
    )



def downgrade() -> None:
    op.drop_index("idx_event_highlights_event", table_name="event_highlights")
    op.drop_table("event_highlights")
    op.drop_index("idx_events_live_stream", table_name="events")
    op.drop_index("idx_events_status", table_name="events")
    op.drop_index("idx_events_scheduled", table_name="events")
    op.drop_index("idx_events_competition", table_name="events")
    op.drop_table("events")
    op.drop_index("idx_competitions_status", table_name="competitions")
    op.drop_index("idx_competitions_category", table_name="competitions")
    op.drop_table("competitions")
    op.drop_index("idx_categories_parent", table_name="categories")
    op.drop_table("season_passes")
    op.drop_table("season_pass_configs")
    op.drop_table("ppv_purchases")
    op.drop_table("user_subscriptions")
    op.drop_index("ix_subscription_tier_prices_tier_id", "subscription_tier_prices")
    op.drop_table("subscription_tier_prices")
    op.drop_table("subscription_tiers")
    op.drop_index("idx_reactions_user", table_name="video_reactions")
    op.drop_index("idx_reactions_video", table_name="video_reactions")
    op.drop_table("video_reactions")
    op.drop_index("idx_watchlist_user", table_name="watchlist")
    op.drop_table("watchlist")
    op.drop_table("watch_history")
    op.drop_table("view_events")
    op.drop_index("idx_vc_category", table_name="video_categories")
    op.drop_table("video_categories")
    op.drop_table("video_talents")
    op.drop_table("video_qualities")
    op.drop_index("ix_video_embeddings_hnsw", table_name="video_embeddings")
    op.drop_table("video_embeddings")
    op.drop_table("transcode_jobs")
    op.drop_table("tenant_videos")
    op.drop_table("subtitle_tracks")
    op.drop_table("audio_tracks")
    op.drop_table("videos")
    op.drop_table("tenant_series")
    op.drop_table("seasons")
    op.drop_index("idx_live_streams_category", table_name="live_streams")
    op.drop_table("live_streams")
    op.drop_table("categories")
    op.drop_table("users")
    op.drop_table("tenants")
    op.drop_table("talents")
    op.drop_table("series")
