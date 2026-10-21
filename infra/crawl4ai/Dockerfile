# Crawl4AI — the page-extraction half of self-hosted research retrieval.
#
# Serves the extraction API on :11235. The client that calls it lives in
# apps/api (the research provider); MALEO_CRAWL4AI_URL is the only wiring
# between the two, exactly as MALEO_KOKORO_URL is for infra/kokoro-tts.
#
# PINNED, deliberately. `latest` on a third-party image plus Coolify auto-deploy
# means an upstream change can alter the API shape or the browser stack on any
# rebuild triggered by an unrelated push. At the time of writing this tag and
# `latest` are the same digest; the pin is what keeps that from drifting
# silently. Moving it is a decision, and `config.yml` must be re-diffed against
# upstream when it moves.
FROM unclecode/crawl4ai:0.9.3

# Configuration is BAKED, not held in Coolify, because one line of it decides
# whether the service answers at all: upstream binds 127.0.0.1 and this binds
# 0.0.0.0. Coolify's database is invisible to every gate in this repository.
# See AGENTS.md.
COPY config.yml /app/config.yml

# The credential is NOT baked. CRAWL4AI_API_TOKEN is supplied at deploy time,
# and the upstream startup guard refuses a non-loopback bind without it — so a
# missing token fails loudly at boot rather than quietly serving open.

# Contract with the client and the Coolify healthcheck: :11235 and GET /health.
EXPOSE 11235
