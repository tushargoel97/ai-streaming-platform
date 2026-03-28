"""LLM service — routes between local LLM and external APIs.

Priority: local LLM first (no API key needed).
Fallback: external API (Anthropic Claude / OpenAI) if local fails or if explicitly configured.
The backend passes LLM config per-request based on admin panel settings.
"""

import json
import logging

from pydantic import BaseModel

from app.config import settings

logger = logging.getLogger(__name__)


class LLMConfig(BaseModel):
    """Per-request LLM configuration, passed from the backend."""
    use_external: bool = False
    provider: str = "anthropic"  # anthropic | openai | ollama
    api_key: str = ""
    model: str = ""
    local_model: str = ""


# ── External provider calls ──

async def _call_anthropic(system: str, prompt: str, api_key: str, model: str, max_tokens: int) -> str:
    import anthropic

    client = anthropic.AsyncAnthropic(api_key=api_key)
    message = await client.messages.create(
        model=model or settings.anthropic_model,
        max_tokens=max_tokens,
        system=system,
        messages=[{"role": "user", "content": prompt}],
    )
    return message.content[0].text


async def _call_openai(system: str, prompt: str, api_key: str, model: str, max_tokens: int) -> str:
    import httpx

    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    body = {
        "model": model or settings.openai_model,
        "max_tokens": max_tokens,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": prompt},
        ],
    }
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post("https://api.openai.com/v1/chat/completions", headers=headers, json=body)
        resp.raise_for_status()
        return resp.json()["choices"][0]["message"]["content"]


async def _call_ollama(system: str, prompt: str, model: str, max_tokens: int) -> str:
    import httpx

    body = {
        "model": model or settings.ollama_model,
        "stream": False,
        "options": {"num_predict": max_tokens},
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": prompt},
        ],
    }
    async with httpx.AsyncClient(timeout=60) as client:
        resp = await client.post(f"{settings.ollama_base_url}/api/chat", json=body)
        resp.raise_for_status()
        return resp.json()["message"]["content"]


async def _call_external(system: str, prompt: str, config: LLMConfig, max_tokens: int) -> str:
    """Call the configured external LLM provider."""
    provider = config.provider.lower()
    api_key = config.api_key

    if provider == "anthropic":
        if not api_key:
            raise ValueError("Anthropic API key not configured")
        return await _call_anthropic(system, prompt, api_key, config.model, max_tokens)
    elif provider == "openai":
        if not api_key:
            raise ValueError("OpenAI API key not configured")
        return await _call_openai(system, prompt, api_key, config.model, max_tokens)
    elif provider == "ollama":
        return await _call_ollama(system, prompt, config.model, max_tokens)
    else:
        raise ValueError(f"Unknown provider: {provider}")


async def _call_local(system: str, prompt: str, model_name: str, max_tokens: int) -> str:
    """Call the local LLM."""
    from app.services.local_llm_service import chat

    return await chat(system, prompt, model_name=model_name or None, max_tokens=max_tokens)


# ── Main interface ──

async def ask_llm(
    system: str,
    prompt: str,
    max_tokens: int = 1024,
    config: LLMConfig | None = None,
) -> str:
    """Send a prompt to the appropriate LLM with automatic fallback.

    Routing logic:
    - If config.use_external is True: try external first, fall back to local
    - If config.use_external is False (default): try local first, fall back to external
    - If no config provided: use env vars to determine behavior
    """
    if config is None:
        config = _config_from_env()

    if config.use_external:
        # External first, local fallback
        try:
            return await _call_external(system, prompt, config, max_tokens)
        except Exception:
            logger.warning("External LLM failed, falling back to local")
            try:
                return await _call_local(system, prompt, config.local_model, max_tokens)
            except Exception:
                logger.exception("Both external and local LLM failed")
                raise
    else:
        # Local first, external fallback
        try:
            return await _call_local(system, prompt, config.local_model, max_tokens)
        except Exception:
            logger.warning("Local LLM failed, attempting external fallback")
            if config.api_key:
                try:
                    return await _call_external(system, prompt, config, max_tokens)
                except Exception:
                    logger.exception("Both local and external LLM failed")
                    raise
            else:
                logger.error("Local LLM failed and no external API key configured")
                raise


async def ask_llm_json(
    system: str,
    prompt: str,
    max_tokens: int = 1024,
    config: LLMConfig | None = None,
) -> dict:
    """Call LLM and parse as JSON. Falls back to empty dict on parse failure."""
    raw = await ask_llm(system, prompt, max_tokens, config)

    text = raw.strip()
    if text.startswith("```"):
        lines = text.split("\n")
        lines = [l for l in lines if not l.strip().startswith("```")]
        text = "\n".join(lines)

    try:
        return json.loads(text)
    except json.JSONDecodeError:
        logger.warning("LLM returned non-JSON response: %s", raw[:200])
        return {}


def _config_from_env() -> LLMConfig:
    """Build LLM config from environment variables (legacy fallback)."""
    has_external_key = bool(settings.anthropic_api_key or settings.openai_api_key)
    return LLMConfig(
        use_external=has_external_key and settings.llm_provider != "local",
        provider=settings.llm_provider if settings.llm_provider != "local" else "anthropic",
        api_key=settings.anthropic_api_key or settings.openai_api_key,
        model=settings.anthropic_model if settings.llm_provider == "anthropic" else settings.openai_model,
        local_model=settings.default_local_model,
    )
