# Pocket TTS Indonesian — CPU-native voice-cloning TTS, no GPU required.
#
# Exposes POST /v1/audio/speech (multipart: text + a voice prompt) and
# GET /health on port 8000. The client that calls this service lives in
# packages/media/src/providers/pocket-tts-id/, and the service URL is
# configured in Settings rather than in any environment file.
#
# Unlike infra/kokoro-tts there is no upstream image to adopt: pocket-tts ships
# as a library, so the server is ours and lives beside this file.
#
# EVERY VERSION HERE IS PINNED, deliberately. Coolify auto-deploys this path,
# so an unpinned dependency or a floating model reference lets an upstream
# change ride in on a push that has nothing to do with this service.
FROM python:3.12-slim AS base

# Weights are baked below, so HF_HOME must be a real path in the image rather
# than a home directory that the runtime user may not own.
ENV HF_HOME=/opt/hf \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

# wget for Coolify's generated healthcheck, which shells out to it rather than
# curl. ca-certificates for the model fetch below.
#
# ffmpeg decodes the voice prompt. pocket-tts reads a 16-bit WAV with the
# standard library and everything else through `soundfile`, whose libsndfile has
# no M4A or AAC decoder — and a phone voice memo, the likeliest recording anyone
# has, is M4A. Normalizing here is what lets the upload accept what people
# actually record instead of asking them to convert it first.
RUN apt-get update \
    && apt-get install -y --no-install-recommends wget ca-certificates ffmpeg \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

# Torch from the CPU index: the default wheel drags in the whole CUDA runtime,
# which this image will never execute and which costs gigabytes.
RUN pip install --index-url https://download.pytorch.org/whl/cpu torch==2.8.0

# pocket-tts pulls fastapi, uvicorn and python-multipart itself; they are named
# here anyway so the server's own dependencies are pinned rather than floating on
# whatever pocket-tts happens to resolve at build time.
#
# Every pin must clear pocket-tts 3.1.0's own floors, and a pin below one fails
# the build rather than degrading: fastapi>=0.100, uvicorn>=0.13.0,
# python-multipart>=0.0.21, numpy>=2, torch>=2.5.0. One build of this file pinned
# python-multipart at 0.0.20 and pip refused the whole install.
#
# The pocket-tts pin is 3.1.0 and the MAJOR matters: `TTSModel.load_model` only
# grew its `config=` parameter after 1.x, and the Indonesian model is loaded by
# config URL. On 1.0.3 the bake below fails with "unexpected keyword argument
# 'config'" — the package installs fine and the model simply cannot be reached.
RUN pip install \
    pocket-tts==3.1.0 \
    fastapi==0.118.0 \
    "uvicorn[standard]==0.37.0" \
    python-multipart==0.0.32 \
    numpy==2.2.6

# The 438 MB student model and its config, BAKED. Coolify restarts containers
# far more often than it rebuilds them, and a first boot that spends minutes
# fetching weights fails its healthcheck before it can serve anything.
#
# The revision is the one the model card publishes. Moving it is a deploy
# decision, not a version bump — see AGENTS.md.
ARG POCKET_TTS_CONFIG="hf://anak10thn/pocket-tts-indonesian/indonesian_6l.yaml@17257664e384561c957b02ac92edd1a24807f0e5"
ENV POCKET_TTS_CONFIG=${POCKET_TTS_CONFIG}
RUN python -c "from pocket_tts import TTSModel; TTSModel.load_model(config='${POCKET_TTS_CONFIG}')"

WORKDIR /app
COPY server.py /app/server.py

# Not root. The install steps above need it; serving does not, and an image
# that serves as root is one container escape away from the host.
RUN useradd --create-home --uid 1000 appuser \
    && chown -R appuser:appuser /opt/hf /app
USER appuser

# Contract with the client and the Coolify healthcheck: :8000 and GET /health.
EXPOSE 8000

# One worker on purpose. The model holds decode state and is serialised behind
# a lock inside the process; a second worker would double resident memory
# (weights are not shared) to no benefit.
CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
