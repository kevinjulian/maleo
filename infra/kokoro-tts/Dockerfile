# Kokoro-82M TTS server — CPU-native, no GPU required.
# Exposes OpenAI-compatible POST /v1/audio/speech plus GET /v1/audio/voices.
#
# The upstream image already bakes the model weights, the voice pack, and the
# UniDic dictionary Japanese needs, so there is no
# build-time cache warm here: a cold start pays no download and this file has
# nothing to warm. Its entrypoint binds 0.0.0.0:8880 itself, so there is no CMD
# to restate either.
#
# PINNED, deliberately. `latest` on a third-party image plus Coolify auto-deploy
# means an upstream change can swap the model or the voice list on any rebuild
# triggered by an unrelated push. Moving this pin is a decision, and the
# catalogue test in packages/media/src/providers/kokoro/voices.live.test.ts is
# what catches a voice list that moved with it.
FROM ghcr.io/remsky/kokoro-fastapi-cpu:v0.8.1

# The upstream runtime stage ships curl but not wget, and Coolify's generated
# healthcheck shells out to wget. Installing it needs root; the image runs as
# `appuser` (uid 1000) and must go back to it, or the server runs as root.
USER root
RUN apt-get update \
    && apt-get install -y --no-install-recommends wget \
    && apt-get clean && rm -rf /var/lib/apt/lists/*
USER appuser

# Contract with the client and the Coolify healthcheck: :8880 and GET /health.
EXPOSE 8880
