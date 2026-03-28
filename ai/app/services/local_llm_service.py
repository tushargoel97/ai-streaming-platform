"""Local LLM service — runs GGUF models via llama-cpp-python.

No API key needed. Models download from HuggingFace on first use.
Stored in /models volume for persistence across restarts.
"""

import asyncio
import json
import logging
import os
import shutil

from app.config import settings

logger = logging.getLogger(__name__)

# Singleton loaded model
_llm = None
_loaded_model_name: str | None = None

# ── Model catalog (curated, known-good GGUF quantizations) ──

MODEL_CATALOG: dict[str, dict] = {
    "qwen2.5-3b": {
        "repo_id": "Qwen/Qwen2.5-3B-Instruct-GGUF",
        "filename": "qwen2.5-3b-instruct-q4_k_m.gguf",
        "description": "Qwen 2.5 3B — best small model for structured JSON output",
        "size_mb": 2048,
        "context_length": 4096,
    },
    "qwen2.5-1.5b": {
        "repo_id": "Qwen/Qwen2.5-1.5B-Instruct-GGUF",
        "filename": "qwen2.5-1.5b-instruct-q4_k_m.gguf",
        "description": "Qwen 2.5 1.5B — fastest, minimal resources",
        "size_mb": 1024,
        "context_length": 4096,
    },
    "qwen2.5-7b": {
        "repo_id": "Qwen/Qwen2.5-7B-Instruct-GGUF",
        "filename": "qwen2.5-7b-instruct-q4_k_m.gguf",
        "description": "Qwen 2.5 7B — highest quality, needs 8GB+ RAM",
        "size_mb": 4608,
        "context_length": 4096,
    },
    "llama-3.2-3b": {
        "repo_id": "bartowski/Llama-3.2-3B-Instruct-GGUF",
        "filename": "Llama-3.2-3B-Instruct-Q4_K_M.gguf",
        "description": "Meta Llama 3.2 3B — well-rounded small model",
        "size_mb": 2048,
        "context_length": 4096,
    },
    "phi-3.5-mini": {
        "repo_id": "bartowski/Phi-3.5-mini-instruct-GGUF",
        "filename": "Phi-3.5-mini-instruct-Q4_K_M.gguf",
        "description": "Microsoft Phi 3.5 Mini — strong at reasoning",
        "size_mb": 2300,
        "context_length": 4096,
    },
}

MODELS_DIR = settings.models_dir


def _get_model_path(model_name: str) -> str | None:
    """Get the local file path for a model, or None if not downloaded."""
    if model_name not in MODEL_CATALOG:
        return None
    filename = MODEL_CATALOG[model_name]["filename"]
    path = os.path.join(MODELS_DIR, filename)
    return path if os.path.exists(path) else None


def get_downloaded_models() -> list[dict]:
    """List all downloaded models with their metadata."""
    result = []
    for name, info in MODEL_CATALOG.items():
        path = _get_model_path(name)
        entry = {
            "name": name,
            "description": info["description"],
            "size_mb": info["size_mb"],
            "context_length": info["context_length"],
            "downloaded": path is not None,
            "active": name == _loaded_model_name,
        }
        if path:
            entry["file_size_mb"] = round(os.path.getsize(path) / (1024 * 1024), 1)
        result.append(entry)
    return result


def get_available_models() -> list[dict]:
    """List all models available for download."""
    return [
        {
            "name": name,
            "description": info["description"],
            "size_mb": info["size_mb"],
            "repo_id": info["repo_id"],
            "downloaded": _get_model_path(name) is not None,
        }
        for name, info in MODEL_CATALOG.items()
    ]


async def download_model(model_name: str) -> dict:
    """Download a model from HuggingFace. Returns model info on success."""
    if model_name not in MODEL_CATALOG:
        raise ValueError(f"Unknown model: {model_name}. Available: {list(MODEL_CATALOG.keys())}")

    info = MODEL_CATALOG[model_name]

    # Check if already downloaded
    existing = _get_model_path(model_name)
    if existing:
        return {"name": model_name, "path": existing, "status": "already_downloaded"}

    os.makedirs(MODELS_DIR, exist_ok=True)

    def _download():
        from huggingface_hub import hf_hub_download

        logger.info("Downloading model %s from %s...", model_name, info["repo_id"])
        path = hf_hub_download(
            repo_id=info["repo_id"],
            filename=info["filename"],
            local_dir=MODELS_DIR,
            local_dir_use_symlinks=False,
        )
        logger.info("Model %s downloaded to %s", model_name, path)
        return path

    path = await asyncio.to_thread(_download)
    return {"name": model_name, "path": path, "status": "downloaded"}


async def delete_model(model_name: str) -> bool:
    """Delete a downloaded model. Unloads it first if active."""
    global _llm, _loaded_model_name

    if model_name == _loaded_model_name:
        _llm = None
        _loaded_model_name = None
        logger.info("Unloaded active model %s", model_name)

    path = _get_model_path(model_name)
    if not path:
        return False

    os.remove(path)
    # Also clean up any HF cache symlinks
    hf_cache = os.path.join(MODELS_DIR, ".cache")
    if os.path.exists(hf_cache):
        shutil.rmtree(hf_cache, ignore_errors=True)

    logger.info("Deleted model %s", model_name)
    return True


def _load_model_sync(model_name: str):
    """Synchronously load a GGUF model into memory."""
    global _llm, _loaded_model_name

    if _loaded_model_name == model_name and _llm is not None:
        return _llm

    path = _get_model_path(model_name)
    if not path:
        raise FileNotFoundError(
            f"Model '{model_name}' not downloaded. Download it first via POST /models/download"
        )

    # Unload previous model
    if _llm is not None:
        del _llm
        _llm = None
        _loaded_model_name = None

    from llama_cpp import Llama

    ctx_len = MODEL_CATALOG.get(model_name, {}).get("context_length", 4096)
    logger.info("Loading local LLM: %s (ctx=%d)...", model_name, ctx_len)
    _llm = Llama(
        model_path=path,
        n_ctx=ctx_len,
        n_threads=settings.local_llm_threads,
        verbose=False,
    )
    _loaded_model_name = model_name
    logger.info("Local LLM loaded: %s", model_name)
    return _llm


async def load_model(model_name: str):
    """Load a model (async-safe). Downloads first if needed."""
    if not _get_model_path(model_name):
        await download_model(model_name)
    await asyncio.to_thread(_load_model_sync, model_name)


def _chat_sync(
    system: str,
    prompt: str,
    model_name: str,
    max_tokens: int = 512,
) -> str:
    """Synchronously run a chat completion on the local LLM."""
    llm = _load_model_sync(model_name)
    response = llm.create_chat_completion(
        messages=[
            {"role": "system", "content": system},
            {"role": "user", "content": prompt},
        ],
        max_tokens=max_tokens,
        temperature=0.1,
    )
    return response["choices"][0]["message"]["content"]


async def chat(
    system: str,
    prompt: str,
    model_name: str | None = None,
    max_tokens: int = 512,
) -> str:
    """Run a chat completion on the local LLM (async-safe).

    Downloads and loads the model on first call if needed.
    """
    name = model_name or settings.default_local_model
    return await asyncio.to_thread(_chat_sync, system, prompt, name, max_tokens)


async def chat_json(
    system: str,
    prompt: str,
    model_name: str | None = None,
    max_tokens: int = 512,
) -> dict:
    """Chat + parse JSON response. Falls back to empty dict on parse failure."""
    raw = await chat(system, prompt, model_name, max_tokens)

    text = raw.strip()
    if text.startswith("```"):
        lines = text.split("\n")
        lines = [l for l in lines if not l.strip().startswith("```")]
        text = "\n".join(lines)

    try:
        return json.loads(text)
    except json.JSONDecodeError:
        logger.warning("Local LLM returned non-JSON: %s", raw[:300])
        return {}
