FROM node:24-alpine AS frontend
WORKDIR /frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
RUN npm run build

FROM ghcr.io/astral-sh/uv:0.11.32 AS uv

FROM python:3.14-slim AS runtime
ENV TZ=Europe/Madrid \
    PYTHONUNBUFFERED=1 \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_NO_CACHE=1 \
    UV_PYTHON_DOWNLOADS=never \
    PATH="/app/.venv/bin:$PATH"
# FFmpeg identifies uploaded videos and converts them to H.264/AAC MP4 (zscale + tonemap for HDR).
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*
RUN groupadd --gid 1000 app && useradd --uid 1000 --gid app --create-home app
WORKDIR /app
COPY pyproject.toml uv.lock ./
RUN --mount=from=uv,source=/uv,target=/usr/local/bin/uv \
    uv sync --locked --no-dev --no-install-project
COPY README.md ./
COPY src/ ./src/
RUN --mount=from=uv,source=/uv,target=/usr/local/bin/uv \
    uv sync --locked --no-dev --no-editable
COPY alembic.ini docker-entrypoint.sh ./
COPY alembic/ ./alembic/
COPY --from=frontend /frontend/dist ./frontend/dist
RUN mkdir -p /app/data/media && chown -R app:app /app/data \
    && sed -i 's/\r$//' docker-entrypoint.sh && chmod +x docker-entrypoint.sh
ARG IMAGE_TAG=development
ARG BUILD_DATE=""
ENV IMAGE_TAG=$IMAGE_TAG BUILD_DATE=$BUILD_DATE
LABEL org.opencontainers.image.title="Timelife" \
      org.opencontainers.image.description="Private, bilingual family timeline of each child's milestones" \
      org.opencontainers.image.source="https://github.com/DrDonoso/timelife" \
      org.opencontainers.image.version="$IMAGE_TAG" \
      org.opencontainers.image.created="$BUILD_DATE"
USER app
EXPOSE 7779
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=5 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:7779/health', timeout=4)"
ENTRYPOINT ["./docker-entrypoint.sh"]
