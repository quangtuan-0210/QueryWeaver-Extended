# Multi-stage build: Start with Python 3.12 base
FROM python:3.12-bookworm AS python-base
FROM falkordb/falkordb:latest

ENV PYTHONUNBUFFERED=1 \
    FALKORDB_HOST=localhost \
    FALKORDB_PORT=6379

USER root

COPY --from=python-base /usr/local /usr/local

RUN apt-get update && apt-get install -y --no-install-recommends \
    netcat-openbsd git build-essential curl ca-certificates gnupg \
    && rm -rf /var/lib/apt/lists/* \
    && ln -sf /usr/local/bin/python3.12 /usr/bin/python3 \
    && ln -sf /usr/local/bin/python3.12 /usr/bin/python

WORKDIR /app

COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv

ENV UV_SYSTEM_PYTHON=1
ENV PATH="/app/.venv/bin:$PATH"

# Install Python deps (cache layer)
COPY pyproject.toml uv.lock* README.md ./
RUN uv sync --no-dev --no-install-project

# Install Node.js 22
RUN apt-get update \
    && apt-get remove -y nodejs || true \
    && rm -rf /var/lib/apt/lists/* \
    && curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get update \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

# Install frontend deps (cache layer)
COPY app/package*.json ./app/
RUN npm --prefix ./app ci --no-audit --no-fund

# Copy TOÀN BỘ code (api/, app/, etc.)
COPY . .

# Build frontend
RUN npm --prefix ./app run build

# Final Python sync
RUN uv sync --frozen --no-dev

COPY start.sh /start.sh
RUN chmod +x /start.sh

LABEL io.modelcontextprotocol.server.name="com.falkordb/QueryWeaver"
EXPOSE 5000 6379 3000
ENTRYPOINT ["/start.sh"]