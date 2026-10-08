FROM ghcr.io/astral-sh/uv:0.11.29 AS uv-bin
FROM python:3.13-slim

COPY --from=uv-bin /uv /uvx /bin/

ENV PYTHONUNBUFFERED=1 \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    OPENAI_API_KEY=cloudflare-worker-egress \
    SSL_CERT_FILE=/etc/cloudflare/certs/cloudflare-containers-ca.crt

WORKDIR /app
COPY backend/pyproject.toml backend/uv.lock ./backend/
RUN uv sync --directory backend --frozen --no-dev
COPY backend/app ./backend/app

EXPOSE 8000
CMD ["uv", "run", "--directory", "backend", "--no-sync", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
