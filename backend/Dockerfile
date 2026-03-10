# DeepPDF Backend Dockerfile - Optimized for size
# Uses uv for dependency management

# Use AMD64 platform for paddlepaddle compatibility
FROM --platform=linux/amd64 python:3.11-slim-bookworm AS builder

# Install system dependencies required for building Python packages
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    && rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/*

# Install uv
COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /bin/

# Set working directory
WORKDIR /app

# Copy workspace configuration
COPY pyproject.toml uv.lock ./
COPY pageindex-lib/ ./pageindex-lib/
COPY deeppdf-api/ ./deeppdf-api/

# Install dependencies using uv with no cache
# --frozen ensures the lockfile is up to date
# --no-dev excludes development dependencies
# --no-cache-dir prevents caching packages
ENV UV_NO_CACHE=1
RUN uv sync --frozen --no-dev && \
    # Clean up uv cache
    rm -rf /root/.cache/uv /app/.venv/share/doc /app/.venv/share/man

# Production stage
FROM --platform=linux/amd64 python:3.11-slim-bookworm AS production

# Install runtime system dependencies for PDF processing
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1-mesa-glx \
    libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/* \
    # Clean up unnecessary files
    && rm -rf /usr/share/doc /usr/share/man /usr/share/info

# Create non-root user for security
RUN useradd --create-home --shell /bin/bash app

# Set working directory
WORKDIR /app

# Copy virtual environment from builder
COPY --from=builder /app/.venv /app/.venv

# Copy application code (only necessary files)
COPY --from=builder /app/deeppdf-api/src/ ./deeppdf-api/src/
COPY --from=builder /app/pageindex-lib/src/ ./pageindex-lib/src/

# Set environment variables
ENV PATH="/app/.venv/bin:$PATH" \
    PYTHONPATH="/app/deeppdf-api/src:/app/pageindex-lib/src" \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONFAULTHANDLER=1 \
    UVICORN_HOST=0.0.0.0 \
    UVICORN_PORT=5088 \
    UVICORN_LOOP=asyncio \
    # Disable pip cache
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

# Create data directory for persistent storage
RUN mkdir -p /app/data /app/logs && chown -R app:app /app

# Switch to non-root user
USER app

# Expose port
EXPOSE 5088

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:5088/health')" || exit 1

# Start the application
# Note: --loop asyncio is required (uvloop causes issues with nest_asyncio)
CMD ["uvicorn", "deeppdf.main:app", "--host", "0.0.0.0", "--port", "5088", "--loop", "asyncio"]
