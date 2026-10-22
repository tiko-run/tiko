FROM python:3.12-slim
COPY --from=ghcr.io/astral-sh/uv:0.11 /uv /usr/local/bin/uv
WORKDIR /app
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy
# `docker compose exec api python -m app.…` must find the app's packages, not the bare system python.
ENV PATH=/app/.venv/bin:$PATH
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev
COPY app ./app
EXPOSE 8000
# The first start after an upgrade copies an SQLite database before it serves: give it time.
HEALTHCHECK --interval=5s --timeout=3s --retries=20 --start-period=600s \
  CMD [".venv/bin/python", "-m", "app.serve", "--healthy"]
CMD ["uv", "run", "--no-dev", "--no-sync", "python", "-m", "app.serve"]
