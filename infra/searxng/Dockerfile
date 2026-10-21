# SearXNG metasearch — the search half of self-hosted research retrieval.
#
# Serves the JSON search API on :8080. The client that calls it lives in
# apps/api (the research provider); MALEO_SEARXNG_URL is the only wiring
# between the two, exactly as MALEO_KOKORO_URL is for infra/kokoro-tts.
#
# PINNED, deliberately. `latest` on a third-party image plus Coolify auto-deploy
# means an upstream change can alter engines, config schema, or the API shape on
# any rebuild triggered by an unrelated push. This tag is the one `latest`
# pointed at when the service was introduced. Moving the pin is a decision.
FROM searxng/searxng:2026.9.5-c7f3080aa

# Configuration is BAKED, not held in Coolify. Two of these settings decide
# whether the service answers at all — JSON output is off upstream by default,
# and the limiter blocks non-browser callers — and Coolify's database is
# invisible to every gate in this repository. See AGENTS.md.
COPY settings.yml /etc/searxng/settings.yml

# The secret is NOT baked. The upstream entrypoint substitutes SEARXNG_SECRET
# into the placeholder in settings.yml at boot.
ENV SEARXNG_SETTINGS_PATH=/etc/searxng/settings.yml

# Contract with the client and the Coolify healthcheck: :8080 and GET /healthz.
EXPOSE 8080
