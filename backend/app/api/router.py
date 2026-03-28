from fastapi import APIRouter

from app.api.v1 import auth, categories, competitions, feed, health, live, media, recommendations, search, series, subscriptions, talents, tenant, videos, watchlist
from app.api.v1.admin import analytics as admin_analytics
from app.api.v1.admin import competitions as admin_competitions
from app.api.v1.admin import ai_settings as admin_ai_settings
from app.api.v1.admin import events as admin_events
from app.api.v1.admin import categories as admin_categories
from app.api.v1.admin import live as admin_live
from app.api.v1.admin import series as admin_series
from app.api.v1.admin import talents as admin_talents
from app.api.v1.admin import tenants as admin_tenants
from app.api.v1.admin import transcode as admin_transcode
from app.api.v1.admin import users as admin_users
from app.api.v1.admin import subscriptions as admin_subscriptions
from app.api.v1.admin import videos as admin_videos

api_router = APIRouter()

api_router.include_router(health.router, tags=["health"])
api_router.include_router(tenant.router, tags=["tenant"])
api_router.include_router(auth.router, tags=["auth"])
api_router.include_router(categories.router, tags=["categories"])
api_router.include_router(videos.router, tags=["videos"])
api_router.include_router(talents.router, tags=["talents"])
api_router.include_router(series.router, tags=["series"])
api_router.include_router(watchlist.router, tags=["watchlist"])
api_router.include_router(recommendations.router, tags=["recommendations"])
api_router.include_router(search.router, tags=["search"])
api_router.include_router(media.router, tags=["media"])
api_router.include_router(live.router, tags=["live"])
api_router.include_router(feed.router, tags=["feed"])
api_router.include_router(subscriptions.router, tags=["subscriptions"])
api_router.include_router(competitions.router, tags=["competitions"])
api_router.include_router(admin_videos.router, tags=["admin-videos"])
api_router.include_router(admin_categories.router, tags=["admin-categories"])
api_router.include_router(admin_talents.router, tags=["admin-talents"])
api_router.include_router(admin_series.router, tags=["admin-series"])
api_router.include_router(admin_transcode.router, tags=["admin-transcode"])
api_router.include_router(admin_users.router, tags=["admin-users"])
api_router.include_router(admin_tenants.router, tags=["admin-tenants"])
api_router.include_router(admin_live.router, tags=["admin-live"])
api_router.include_router(admin_analytics.router, tags=["admin-analytics"])
api_router.include_router(admin_subscriptions.router, tags=["admin-subscriptions"])
api_router.include_router(admin_competitions.router, tags=["admin-competitions"])
api_router.include_router(admin_events.router, tags=["admin-events"])
api_router.include_router(admin_ai_settings.router, tags=["admin-ai"])
