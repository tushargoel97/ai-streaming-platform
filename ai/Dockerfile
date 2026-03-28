FROM python:3.12-slim

# Build dependencies for llama-cpp-python
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential cmake \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install CPU-only PyTorch first (avoids pulling ~2GB CUDA version)
RUN pip install --no-cache-dir torch --index-url https://download.pytorch.org/whl/cpu

# Install Python dependencies
COPY pyproject.toml .
RUN pip install --no-cache-dir .

# Source code mounted as volume in dev, but copy for layer caching
COPY . .

# Pre-download the embedding model during build
RUN python -c "from sentence_transformers import SentenceTransformer; SentenceTransformer('all-MiniLM-L6-v2')"

# Models directory (mounted as volume for persistence)
RUN mkdir -p /models

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8100", "--reload"]
