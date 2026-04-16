"""Local LLM service — runs GGUF models via llama-cpp-python.

No API key needed. Models download from HuggingFace on first use.
Stored in /models volume for persistence across restarts.
"""

import asyncio
import json
import logging
import os
import shutil

import httpx

from app.config import settings

logger = logging.getLogger(__name__)

# Singleton loaded text model
_llm = None
_loaded_model_name: str | None = None

# Singleton loaded vision model
_vision_llm = None
_loaded_vision_model_name: str | None = None

# ── Model catalog (curated, known-good GGUF quantizations) ──

MODEL_CATALOG: dict[str, dict] = {
    # ── Compact (< 2B parameters) ──
    "gemma-3-1b": {
        "repo_id": "bartowski/gemma-3-1b-it-GGUF",
        "filename": "gemma-3-1b-it-Q4_K_M.gguf",
        "description": "Google Gemma 3 1B — tiny but capable, great for quick tasks",
        "size_mb": 700,
        "context_length": 32768,
        "vision": False,
        "parameters": "1B",
        "tags": ["fast", "lightweight", "multilingual"],
        "strengths": "Ultra-fast inference, minimal RAM. Good for simple classification and short text generation.",
    },
    "qwen2.5-1.5b": {
        "repo_id": "Qwen/Qwen2.5-1.5B-Instruct-GGUF",
        "filename": "qwen2.5-1.5b-instruct-q4_k_m.gguf",
        "description": "Qwen 2.5 1.5B — fastest Qwen, minimal resources",
        "size_mb": 1024,
        "context_length": 4096,
        "vision": False,
        "parameters": "1.5B",
        "tags": ["fast", "json", "lightweight"],
        "strengths": "Fast structured JSON output. Best tiny model for metadata extraction.",
    },
    "deepseek-r1-1.5b": {
        "repo_id": "bartowski/DeepSeek-R1-Distill-Qwen-1.5B-GGUF",
        "filename": "DeepSeek-R1-Distill-Qwen-1.5B-Q4_K_M.gguf",
        "description": "DeepSeek R1 1.5B — compact reasoning specialist",
        "size_mb": 1024,
        "context_length": 8192,
        "vision": False,
        "parameters": "1.5B",
        "tags": ["reasoning", "math", "compact"],
        "strengths": "Chain-of-thought reasoning in a tiny package. Punches above its weight on logic tasks.",
    },
    # ── Small (3–4B parameters) ──
    "qwen2.5-3b": {
        "repo_id": "Qwen/Qwen2.5-3B-Instruct-GGUF",
        "filename": "qwen2.5-3b-instruct-q4_k_m.gguf",
        "description": "Qwen 2.5 3B — best small model for structured JSON output",
        "size_mb": 2048,
        "context_length": 4096,
        "vision": False,
        "parameters": "3B",
        "tags": ["json", "classification", "coding"],
        "strengths": "Excellent structured JSON output and classification. Recommended for content tagging.",
    },
    "llama-3.2-3b": {
        "repo_id": "bartowski/Llama-3.2-3B-Instruct-GGUF",
        "filename": "Llama-3.2-3B-Instruct-Q4_K_M.gguf",
        "description": "Meta Llama 3.2 3B — well-rounded small model",
        "size_mb": 2048,
        "context_length": 4096,
        "vision": False,
        "parameters": "3B",
        "tags": ["general", "instruction", "multilingual"],
        "strengths": "Well-rounded instruction following. Good general-purpose small model.",
    },
    "gemma-3-4b": {
        "repo_id": "bartowski/gemma-3-4b-it-GGUF",
        "filename": "gemma-3-4b-it-Q4_K_M.gguf",
        "description": "Google Gemma 3 4B — latest Google model, excellent quality",
        "size_mb": 2560,
        "context_length": 8192,
        "vision": False,
        "parameters": "4B",
        "tags": ["multilingual", "reasoning", "instruction", "new"],
        "strengths": "Google's latest small model. Strong multilingual support and instruction following.",
    },
    "phi-3.5-mini": {
        "repo_id": "bartowski/Phi-3.5-mini-instruct-GGUF",
        "filename": "Phi-3.5-mini-instruct-Q4_K_M.gguf",
        "description": "Microsoft Phi 3.5 Mini — strong at reasoning",
        "size_mb": 2300,
        "context_length": 4096,
        "vision": False,
        "parameters": "3.8B",
        "tags": ["reasoning", "math", "coding"],
        "strengths": "Excels at reasoning and math despite small size. Good for analytical tasks.",
    },
    "phi-4-mini": {
        "repo_id": "bartowski/phi-4-mini-instruct-GGUF",
        "filename": "phi-4-mini-instruct-Q4_K_M.gguf",
        "description": "Microsoft Phi 4 Mini — latest Microsoft model, top reasoning",
        "size_mb": 2400,
        "context_length": 8192,
        "vision": False,
        "parameters": "3.8B",
        "tags": ["reasoning", "math", "coding", "new"],
        "strengths": "Microsoft's latest mini. Best-in-class reasoning and math for its size.",
    },
    # ── Medium (7–8B parameters) ──
    "mistral-7b-v0.3": {
        "repo_id": "bartowski/Mistral-7B-Instruct-v0.3-GGUF",
        "filename": "Mistral-7B-Instruct-v0.3-Q4_K_M.gguf",
        "description": "Mistral 7B v0.3 — solid general-purpose model",
        "size_mb": 4370,
        "context_length": 8192,
        "vision": False,
        "parameters": "7B",
        "tags": ["general", "multilingual", "instruction"],
        "strengths": "Solid all-rounder with good multilingual support. Reliable for diverse tasks.",
    },
    "qwen2.5-7b": {
        "repo_id": "Qwen/Qwen2.5-7B-Instruct-GGUF",
        "filename": "qwen2.5-7b-instruct-q4_k_m.gguf",
        "description": "Qwen 2.5 7B — highest quality Qwen, needs 8GB+ RAM",
        "size_mb": 4608,
        "context_length": 4096,
        "vision": False,
        "parameters": "7B",
        "tags": ["reasoning", "coding", "json", "quality"],
        "strengths": "Best Qwen for quality. Excellent at reasoning, code, and structured output.",
    },
    "llama-3.1-8b": {
        "repo_id": "bartowski/Meta-Llama-3.1-8B-Instruct-GGUF",
        "filename": "Meta-Llama-3.1-8B-Instruct-Q4_K_M.gguf",
        "description": "Meta Llama 3.1 8B — flagship 8B with 128K context",
        "size_mb": 4920,
        "context_length": 8192,
        "vision": False,
        "parameters": "8B",
        "tags": ["general", "coding", "reasoning", "long-context"],
        "strengths": "Meta's flagship 8B model. Great all-rounder with long context window support.",
    },
    "deepseek-r1-7b": {
        "repo_id": "bartowski/DeepSeek-R1-Distill-Qwen-7B-GGUF",
        "filename": "DeepSeek-R1-Distill-Qwen-7B-Q4_K_M.gguf",
        "description": "DeepSeek R1 7B — advanced reasoning with chain-of-thought",
        "size_mb": 4700,
        "context_length": 8192,
        "vision": False,
        "parameters": "7B",
        "tags": ["reasoning", "math", "chain-of-thought", "quality"],
        "strengths": "Specialized reasoning model. Chain-of-thought capability for complex analytical tasks.",
    },
    # ── Large (12B+ parameters) ──
    "gemma-3-12b": {
        "repo_id": "bartowski/gemma-3-12b-it-GGUF",
        "filename": "gemma-3-12b-it-Q4_K_M.gguf",
        "description": "Google Gemma 3 12B — powerful, needs 12GB+ RAM",
        "size_mb": 7340,
        "context_length": 8192,
        "vision": False,
        "parameters": "12B",
        "tags": ["multilingual", "reasoning", "coding", "quality", "new"],
        "strengths": "Google's most capable local model. Strong across all tasks. Needs significant RAM.",
    },
    # ── Vision Models ──
    "qwen2.5-vl-7b": {
        "repo_id": "bartowski/Qwen2.5-VL-7B-Instruct-GGUF",
        "filename": "Qwen2.5-VL-7B-Instruct-Q4_K_M.gguf",
        "mmproj_repo_id": "bartowski/Qwen2.5-VL-7B-Instruct-GGUF",
        "mmproj_filename": "mmproj-model-f16.gguf",
        "description": "Qwen 2.5 VL 7B — vision+language, analyzes actual video frames",
        "size_mb": 5120,
        "context_length": 4096,
        "vision": True,
        "parameters": "7B",
        "tags": ["vision", "multimodal", "scene-analysis"],
        "strengths": "Analyzes actual video frames and images. Required for visual scene analysis.",
    },
}

MODELS_DIR = settings.models_dir


def _get_model_path(model_name: str) -> str | None:
    """Get the local file path for a model's main GGUF, or None if not downloaded."""
    if model_name not in MODEL_CATALOG:
        return None
    filename = MODEL_CATALOG[model_name]["filename"]
    path = os.path.join(MODELS_DIR, filename)
    return path if os.path.exists(path) else None


def _get_mmproj_path(model_name: str) -> str | None:
    """Get the mmproj file path for a vision model, or None if not downloaded."""
    info = MODEL_CATALOG.get(model_name, {})
    if not info.get("vision") or not info.get("mmproj_filename"):
        return None
    path = os.path.join(MODELS_DIR, info["mmproj_filename"])
    return path if os.path.exists(path) else None


def _is_fully_downloaded(model_name: str) -> bool:
    """Return True if all required files for a model are present."""
    info = MODEL_CATALOG.get(model_name, {})
    if not _get_model_path(model_name):
        return False
    if info.get("vision") and not _get_mmproj_path(model_name):
        return False
    return True


def get_downloaded_models() -> list[dict]:
    """List all downloaded models with their metadata."""
    result = []
    for name, info in MODEL_CATALOG.items():
        path = _get_model_path(name)
        downloaded = _is_fully_downloaded(name)
        entry = {
            "name": name,
            "description": info["description"],
            "size_mb": info["size_mb"],
            "context_length": info["context_length"],
            "downloaded": downloaded,
            "active": name == _loaded_model_name or name == _loaded_vision_model_name,
            "vision": info.get("vision", False),
            "parameters": info.get("parameters", ""),
            "tags": info.get("tags", []),
            "strengths": info.get("strengths", ""),
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
            "downloaded": _is_fully_downloaded(name),
            "vision": info.get("vision", False),
            "parameters": info.get("parameters", ""),
            "tags": info.get("tags", []),
            "strengths": info.get("strengths", ""),
            "context_length": info.get("context_length", 4096),
        }
        for name, info in MODEL_CATALOG.items()
    ]


# ── HuggingFace model search (LM Studio-style dynamic discovery) ──

_HF_API = "https://huggingface.co/api"

# Preferred quantization tiers (first match wins)
_QUANT_PREFERENCE = ["Q4_K_M", "Q4_K_S", "Q5_K_M", "Q3_K_M", "Q8_0", "Q6_K", "Q5_K_S"]


def _pick_best_gguf(filenames: list[str]) -> str | None:
    """From a list of GGUF filenames, pick the best quantization for CPU inference."""
    gguf_files = [f for f in filenames if f.endswith(".gguf") and "/" not in f]
    # Skip mmproj files
    gguf_files = [f for f in gguf_files if "mmproj" not in f.lower()]
    if not gguf_files:
        return None
    for quant in _QUANT_PREFERENCE:
        for f in gguf_files:
            if quant in f:
                return f
    # Fallback: pick smallest single file
    return gguf_files[0] if gguf_files else None


def _find_mmproj(filenames: list[str]) -> str | None:
    """Find an mmproj file for vision models."""
    for f in filenames:
        if "mmproj" in f.lower() and f.endswith(".gguf") and "/" not in f:
            # Prefer F16 over BF16/F32
            if "F16" in f or "f16" in f:
                return f
    # Fallback: any mmproj
    for f in filenames:
        if "mmproj" in f.lower() and f.endswith(".gguf") and "/" not in f:
            return f
    return None


def _estimate_size_mb(filename: str, total_size: int | None) -> int:
    """Estimate file size from quant name or total repo size."""
    # Quick heuristic from quantization type
    if total_size and total_size > 0:
        # total_size is full precision; Q4 is roughly 30-35% of BF16
        quant_ratios = {
            "Q4_K_M": 0.33, "Q4_K_S": 0.31, "Q5_K_M": 0.38,
            "Q3_K_M": 0.27, "Q8_0": 0.55, "Q6_K": 0.48, "Q5_K_S": 0.36,
        }
        for q, ratio in quant_ratios.items():
            if q in filename:
                return int(total_size * ratio / (1024 * 1024))
    return 0


async def search_huggingface_models(query: str, limit: int = 20) -> list[dict]:
    """Search HuggingFace for GGUF models. Returns enriched results with file info."""
    results = []

    async with httpx.AsyncClient(timeout=15) as client:
        # Step 1: Search for GGUF repos
        search_resp = await client.get(
            f"{_HF_API}/models",
            params={
                "search": query,
                "filter": "gguf",
                "sort": "downloads",
                "direction": "-1",
                "limit": str(limit),
            },
        )
        search_resp.raise_for_status()
        repos = search_resp.json()

        # Step 2: Fetch details for top results (files list, gguf metadata)
        # Limit detail fetches to avoid slow responses
        detail_tasks = []
        for repo in repos[:limit]:
            detail_tasks.append(client.get(f"{_HF_API}/models/{repo['id']}"))

        detail_responses = await asyncio.gather(*detail_tasks, return_exceptions=True)

        for repo, detail_resp in zip(repos[:limit], detail_responses):
            if isinstance(detail_resp, Exception) or detail_resp.status_code != 200:
                continue

            detail = detail_resp.json()
            siblings = detail.get("siblings", [])
            filenames = [s["rfilename"] for s in siblings]
            gguf_meta = detail.get("gguf", {})

            best_file = _pick_best_gguf(filenames)
            if not best_file:
                continue

            is_vision = detail.get("pipeline_tag") == "image-text-to-text"
            mmproj = _find_mmproj(filenames) if is_vision else None

            # Extract architecture/parameter info from tags
            tags = repo.get("tags", [])
            arch = gguf_meta.get("architecture", "")
            ctx_length = gguf_meta.get("context_length", 4096)
            total_size = gguf_meta.get("total")

            # Already in our catalog?
            already_cataloged = any(
                info["repo_id"] == repo["id"] for info in MODEL_CATALOG.values()
            )

            results.append({
                "repo_id": repo["id"],
                "filename": best_file,
                "mmproj_filename": mmproj,
                "downloads": repo.get("downloads", 0),
                "likes": repo.get("likes", 0),
                "pipeline_tag": detail.get("pipeline_tag", "text-generation"),
                "architecture": arch,
                "context_length": min(ctx_length, 32768),  # cap for practical use
                "estimated_size_mb": _estimate_size_mb(best_file, total_size),
                "vision": is_vision,
                "tags": [t for t in tags if ":" not in t and t != "gguf"],
                "in_catalog": already_cataloged,
                "available_files": [f for f in filenames if f.endswith(".gguf") and "mmproj" not in f.lower() and "/" not in f],
            })

    return results


# ── Download progress tracking ──

# Active downloads: model_name → {"progress": 0-100, "downloaded_mb": X, "total_mb": Y, "status": "..."}
_download_progress: dict[str, dict] = {}


def get_download_progress(model_name: str) -> dict | None:
    """Get current download progress for a model, or None if not downloading."""
    return _download_progress.get(model_name)


def get_all_download_progress() -> dict[str, dict]:
    """Get progress for all active downloads."""
    return dict(_download_progress)


async def download_model(
    model_name: str,
    *,
    repo_id: str | None = None,
    filename: str | None = None,
    mmproj_filename: str | None = None,
) -> dict:
    """Download a model from HuggingFace with progress tracking.

    For catalog models, just pass model_name.
    For HuggingFace search results, pass repo_id + filename to add dynamically.
    """
    # If it's a dynamic download (from HF search), register it in the catalog
    if model_name not in MODEL_CATALOG:
        if not repo_id or not filename:
            raise ValueError(f"Unknown model: {model_name}. Provide repo_id and filename for non-catalog models.")
        is_vision = mmproj_filename is not None
        MODEL_CATALOG[model_name] = {
            "repo_id": repo_id,
            "filename": filename,
            "description": f"Community model from {repo_id}",
            "size_mb": 0,
            "context_length": 4096,
            "vision": is_vision,
            "parameters": "",
            "tags": ["community"],
            "strengths": "",
        }
        if mmproj_filename:
            MODEL_CATALOG[model_name]["mmproj_repo_id"] = repo_id
            MODEL_CATALOG[model_name]["mmproj_filename"] = mmproj_filename

    info = MODEL_CATALOG[model_name]

    # Check if already fully downloaded
    if _is_fully_downloaded(model_name):
        return {"name": model_name, "status": "already_downloaded"}

    os.makedirs(MODELS_DIR, exist_ok=True)

    # Initialize progress tracking
    _download_progress[model_name] = {
        "progress": 0,
        "downloaded_mb": 0,
        "total_mb": info["size_mb"],
        "status": "starting",
    }

    def _progress_callback(current: int, total: int) -> None:
        """Called by tqdm/hf_hub during download."""
        total_mb = round(total / (1024 * 1024), 1) if total else info["size_mb"]
        downloaded_mb = round(current / (1024 * 1024), 1)
        pct = round(current / total * 100, 1) if total else 0
        _download_progress[model_name] = {
            "progress": pct,
            "downloaded_mb": downloaded_mb,
            "total_mb": total_mb,
            "status": "downloading",
        }

    def _download():
        from huggingface_hub import hf_hub_download
        from tqdm import tqdm

        # Custom tqdm subclass that feeds our progress tracker
        class _ProgressTqdm(tqdm):
            def update(self, n=1):
                super().update(n)
                if self.total:
                    _progress_callback(self.n, self.total)

        logger.info("Downloading model %s from %s...", model_name, info["repo_id"])
        path = hf_hub_download(
            repo_id=info["repo_id"],
            filename=info["filename"],
            local_dir=MODELS_DIR,
            local_dir_use_symlinks=False,
            tqdm_class=_ProgressTqdm,
        )
        logger.info("Model %s downloaded to %s", model_name, path)

        # Update actual file size in catalog
        actual_size = round(os.path.getsize(path) / (1024 * 1024))
        MODEL_CATALOG[model_name]["size_mb"] = actual_size

        # For vision models, also download the mmproj file
        if info.get("vision") and info.get("mmproj_filename"):
            mmproj_path = os.path.join(MODELS_DIR, info["mmproj_filename"])
            if not os.path.exists(mmproj_path):
                _download_progress[model_name]["status"] = "downloading mmproj"
                logger.info("Downloading mmproj for %s...", model_name)
                hf_hub_download(
                    repo_id=info.get("mmproj_repo_id", info["repo_id"]),
                    filename=info["mmproj_filename"],
                    local_dir=MODELS_DIR,
                    local_dir_use_symlinks=False,
                )
                logger.info("mmproj for %s downloaded", model_name)

        return path

    try:
        path = await asyncio.to_thread(_download)
        _download_progress[model_name] = {
            "progress": 100,
            "downloaded_mb": _download_progress[model_name].get("total_mb", 0),
            "total_mb": _download_progress[model_name].get("total_mb", 0),
            "status": "complete",
        }
        return {"name": model_name, "path": path, "status": "downloaded"}
    except Exception:
        _download_progress[model_name]["status"] = "error"
        raise
    finally:
        # Clean up progress after a short delay so frontend can read final state
        async def _cleanup():
            await asyncio.sleep(10)
            _download_progress.pop(model_name, None)
        asyncio.create_task(_cleanup())


async def delete_model(model_name: str) -> bool:
    """Delete a downloaded model. Unloads it first if active."""
    global _llm, _loaded_model_name, _vision_llm, _loaded_vision_model_name

    if model_name == _loaded_model_name:
        _llm = None
        _loaded_model_name = None
        logger.info("Unloaded active text model %s", model_name)

    if model_name == _loaded_vision_model_name:
        _vision_llm = None
        _loaded_vision_model_name = None
        logger.info("Unloaded active vision model %s", model_name)

    path = _get_model_path(model_name)
    if not path:
        return False

    os.remove(path)

    # For vision models, also delete the mmproj file
    info = MODEL_CATALOG.get(model_name, {})
    if info.get("vision"):
        mmproj = _get_mmproj_path(model_name)
        if mmproj and os.path.exists(mmproj):
            os.remove(mmproj)
            logger.info("Deleted mmproj for %s", model_name)

    # Also clean up any HF cache symlinks
    hf_cache = os.path.join(MODELS_DIR, ".cache")
    if os.path.exists(hf_cache):
        shutil.rmtree(hf_cache, ignore_errors=True)

    logger.info("Deleted model %s", model_name)
    return True


def _load_model_sync(model_name: str):
    """Synchronously load a text GGUF model into memory."""
    global _llm, _loaded_model_name

    if _loaded_model_name == model_name and _llm is not None:
        return _llm

    path = _get_model_path(model_name)
    if not path:
        raise FileNotFoundError(
            f"Model '{model_name}' not downloaded. Download it first via POST /models/download"
        )

    # Unload previous text model
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


def _load_vision_model_sync(model_name: str):
    """Synchronously load a vision GGUF model into memory."""
    global _vision_llm, _loaded_vision_model_name

    if _loaded_vision_model_name == model_name and _vision_llm is not None:
        return _vision_llm

    path = _get_model_path(model_name)
    mmproj_path = _get_mmproj_path(model_name)
    if not path:
        raise FileNotFoundError(f"Vision model '{model_name}' not downloaded.")
    if not mmproj_path:
        raise FileNotFoundError(f"Vision model '{model_name}' mmproj not downloaded.")

    # Unload previous vision model
    if _vision_llm is not None:
        del _vision_llm
        _vision_llm = None
        _loaded_vision_model_name = None

    from llama_cpp import Llama
    from llama_cpp.llama_chat_format import Qwen25VLChatHandler

    ctx_len = MODEL_CATALOG.get(model_name, {}).get("context_length", 4096)
    logger.info("Loading vision LLM: %s (ctx=%d)...", model_name, ctx_len)

    chat_handler = Qwen25VLChatHandler(clip_model_path=mmproj_path)
    _vision_llm = Llama(
        model_path=path,
        chat_handler=chat_handler,
        n_ctx=ctx_len,
        n_threads=settings.local_llm_threads,
        verbose=False,
    )
    _loaded_vision_model_name = model_name
    logger.info("Vision LLM loaded: %s", model_name)
    return _vision_llm


async def load_model(model_name: str):
    """Load a model (async-safe). Downloads first if needed."""
    if not _is_fully_downloaded(model_name):
        await download_model(model_name)
    info = MODEL_CATALOG.get(model_name, {})
    if info.get("vision"):
        await asyncio.to_thread(_load_vision_model_sync, model_name)
    else:
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


def _chat_vision_sync(
    system: str,
    prompt: str,
    images_b64: list[str],
    model_name: str,
    max_tokens: int = 256,
) -> str:
    """Synchronously run a vision chat completion on the local vision LLM.

    images_b64: list of base64-encoded JPEG images.
    """
    llm = _load_vision_model_sync(model_name)

    # Build multimodal message: images first, then the text prompt
    content: list[dict] = []
    for b64 in images_b64:
        content.append({
            "type": "image_url",
            "image_url": {"url": f"data:image/jpeg;base64,{b64}"},
        })
    content.append({"type": "text", "text": prompt})

    messages = []
    if system:
        messages.append({"role": "system", "content": system})
    messages.append({"role": "user", "content": content})

    response = llm.create_chat_completion(
        messages=messages,
        max_tokens=max_tokens,
        temperature=0.1,
    )
    return response["choices"][0]["message"]["content"]


async def chat_vision(
    system: str,
    prompt: str,
    images_b64: list[str],
    model_name: str | None = None,
    max_tokens: int = 256,
) -> str:
    """Run a vision chat completion on the local vision LLM (async-safe).

    Falls back to the text model if no vision model is specified/loaded.
    """
    name = model_name or settings.default_local_model

    # If requested model is a vision model, use vision path
    if MODEL_CATALOG.get(name, {}).get("vision"):
        return await asyncio.to_thread(_chat_vision_sync, system, prompt, images_b64, name, max_tokens)

    # Requested model is text-only — strip images, fall back to plain chat
    logger.warning("Model %s is not a vision model; ignoring frames and using text chat", name)
    return await asyncio.to_thread(_chat_sync, system, prompt, name, max_tokens)


async def chat_vision_json(
    system: str,
    prompt: str,
    images_b64: list[str],
    model_name: str | None = None,
    max_tokens: int = 256,
) -> dict:
    """Vision chat + parse JSON. Falls back to empty dict on parse failure."""
    raw = await chat_vision(system, prompt, images_b64, model_name, max_tokens)

    text = raw.strip()
    if text.startswith("```"):
        lines = text.split("\n")
        lines = [l for l in lines if not l.strip().startswith("```")]
        text = "\n".join(lines)

    try:
        return json.loads(text)
    except json.JSONDecodeError:
        logger.warning("Vision LLM returned non-JSON: %s", raw[:300])
        return {}
