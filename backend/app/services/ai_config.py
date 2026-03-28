"""AI config helper — reads AI settings from DB and builds LLM config for AI service calls."""

import logging
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.ai_settings import AISettings

logger = logging.getLogger(__name__)


async def get_ai_settings(db: AsyncSession) -> AISettings:
    """Get the singleton AI settings row, creating defaults if missing."""
    result = await db.execute(select(AISettings))
    ai = result.scalar_one_or_none()
    if ai is None:
        ai = AISettings(updated_at=datetime.utcnow())
        db.add(ai)
        await db.flush()
        await db.commit()
    return ai


def build_llm_config(ai: AISettings) -> dict:
    """Build the llm_config dict to pass to the AI service."""
    return {
        "use_external": ai.use_external_llm,
        "provider": ai.external_provider,
        "api_key": ai.external_api_key,
        "model": ai.external_model,
        "local_model": ai.local_model,
    }
