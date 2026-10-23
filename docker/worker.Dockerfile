# syntax=docker/dockerfile:1
# Kioku worker — claim-loop transcription (faster-whisper small/int8).
# Build context: repo root (needs worker/ only, but one context keeps the
# compose file simple). glibc (bookworm-slim) — manylinux wheels stay intact.

FROM ghcr.io/astral-sh/uv:python3.12-bookworm-slim
ENV PYTHONDONTWRITEBYTECODE=1 UV_LINK_MODE=copy
WORKDIR /app
COPY worker/pyproject.toml worker/uv.lock worker/.python-version ./
# Plain RUN (no --mount cache): BuildKit/buildx is NOT a safe assumption on
# every box this ships to (this dev box lacks buildx; legacy builder builds
# the web image fine). Cost: uv re-downloads wheels per uncached build.
RUN uv sync --frozen --extra engine-local
COPY worker/pipeline.py worker/main.py ./
# Models download once at first claim and persist in the /models volume
# across container restarts (HF_HOME's default lands under /root, which
# loses its cache on every image upgrade).
ENV HF_HOME=/models
CMD ["/app/.venv/bin/python", "pipeline.py"]
