# Multi-stage build: Start with Python 3.12 base
FROM python:3.12-bookworm AS python-base

# Main stage: Use FalkorDB base and copy Python 3.12
FROM falkordb/falkordb:latest

ENV PYTHONUNBUFFERED=1 \
    FALKORDB_HOST=localhost \
    FALKORDB_PORT=6379

USER root

# Copy Python 3.12 from the python base image
COPY --from=python-base /usr/local /usr/local

# Install netcat and build tools
RUN apt-get update && apt-get install -y --no-install-recommends \
    netcat-openbsd \
    git \
    build-essential \
    curl \
    ca-certificates \
    gnupg \
    && rm -rf /var/lib/apt/lists/* \
    && ln -sf /usr/local/bin/python3.12 /usr/bin/python3 \
    && ln -sf /usr/local/bin/python3.12 /usr/bin/python

WORKDIR /app

# Install uv
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv

# Copy pyproject.toml, uv.lock, and README.md
COPY pyproject.toml uv.lock* README.md ./

# Install packages into system Python
ENV UV_SYSTEM_PYTHON=1
ENV PATH="/app/.venv/bin:$PATH"

# Install Python dependencies
RUN uv sync --no-dev --no-install-project

# Install Node.js 22 for frontend build
RUN apt-get update \
    && apt-get remove -y nodejs || true \
    && rm -rf /var/lib/apt/lists/* \
    && curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get update \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

# Build Frontend
COPY app/package*.json ./app/
RUN if [ -f ./app/package-lock.json ]; then \
            npm --prefix ./app ci --no-audit --no-fund; \
        elif [ -f ./app/package.json ]; then \
            npm --prefix ./app install --no-audit --no-fund; \
        else \
            echo "No frontend package.json found, skipping npm install"; \
        fi

COPY ./app ./app
RUN npm --prefix ./app run build

# Copy toàn bộ mã nguồn
COPY . .

# [LƯU Ý] Đã xóa toàn bộ các lệnh sed ép dùng Gemini ở đây

# Final project sync
RUN uv sync --frozen --no-dev

# Copy start script
COPY start.sh /start.sh
RUN chmod +x /start.sh

LABEL io.modelcontextprotocol.server.name="com.falkordb/QueryWeaver"
EXPOSE 5000 6379 3000

ENTRYPOINT ["/start.sh"]