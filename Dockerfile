# Stage 1: lấy FalkorDB binaries + libs từ image gốc (Trixie)
FROM falkordb/falkordb@sha256:e93fcd753fe612fb0a222166a0620a1ae31b826a12f223c3b6d06038d9d7a364 AS falkordb-src

# Stage 2: dùng Python Bookworm làm nền
FROM python:3.12-slim-bookworm

ENV PYTHONUNBUFFERED=1 \
    FALKORDB_HOST=localhost \
    FALKORDB_PORT=6379

USER root

# Copy FalkorDB + Redis binaries
COPY --from=falkordb-src /usr/local/bin/redis-server /usr/local/bin/redis-server-real
COPY --from=falkordb-src /usr/local/bin/redis-cli    /usr/local/bin/redis-cli
COPY --from=falkordb-src /var/lib/falkordb           /var/lib/falkordb

# Copy toàn bộ lib Trixie vào thư mục riêng để redis-server dùng
COPY --from=falkordb-src /lib/x86_64-linux-gnu       /usr/local/lib/trixie
COPY --from=falkordb-src /usr/lib/x86_64-linux-gnu   /usr/local/lib/trixie

# Copy dynamic linker Trixie
COPY --from=falkordb-src /lib64/ld-linux-x86-64.so.2 /usr/local/lib/trixie/ld-linux-x86-64.so.2

# Wrap redis-server: dùng linker + libs Trixie hoàn toàn
RUN printf '#!/bin/sh\nexec /usr/local/lib/trixie/ld-linux-x86-64.so.2 --library-path /usr/local/lib/trixie /usr/local/bin/redis-server-real "$@"\n' \
       > /usr/local/bin/redis-server \
    && chmod +x /usr/local/bin/redis-server

# Cài tools trên Bookworm
RUN apt-get update && apt-get install -y --no-install-recommends \
    netcat-openbsd git build-essential curl ca-certificates gnupg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv

ENV UV_SYSTEM_PYTHON=1
ENV PATH="/app/.venv/bin:$PATH"

COPY pyproject.toml uv.lock* README.md ./
RUN uv sync --no-dev --no-install-project

# Install Node.js 22
RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

COPY app/package*.json ./app/
RUN npm --prefix ./app ci --no-audit --no-fund

COPY . .

RUN npm --prefix ./app run build

RUN uv sync --frozen --no-dev

COPY start.sh /start.sh
RUN chmod +x /start.sh

LABEL io.modelcontextprotocol.server.name="com.falkordb/QueryWeaver"
EXPOSE 5000 6379 3000
ENTRYPOINT ["/start.sh"]