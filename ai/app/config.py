from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    # Service
    host: str = "0.0.0.0"
    port: int = 8100
    debug: bool = True

    # Embedding model (local sentence-transformers — free, no API key needed)
    embedding_model_name: str = "all-MiniLM-L6-v2"
    embedding_dimension: int = 384

    # Local LLM (llama-cpp-python — free, no API key needed)
    default_local_model: str = "qwen2.5-3b"
    local_llm_threads: int = 4
    models_dir: str = "/models"

    # LLM provider (used as env-var fallback when backend doesn't pass config)
    llm_provider: str = "local"  # local | anthropic | openai | ollama
    anthropic_api_key: str = ""
    anthropic_model: str = "claude-sonnet-4-5-20241022"

    openai_api_key: str = ""
    openai_model: str = "gpt-4o-mini"

    ollama_base_url: str = "http://ollama:11434"
    ollama_model: str = "llama3.1"

    model_config = {"env_file": ".env", "extra": "ignore"}


settings = Settings()
