# infra/searxng — agent instructions

## Purpose

This directory deploys **SearXNG**, the search half of self-hosted research
retrieval: a pinned upstream image serving the JSON search API on port 8080.

It holds a `Dockerfile`, a `.dockerignore`, a `settings.yml`, and this file —
nothing else. There is no TypeScript here and none belongs here: the client that
calls this service is the research provider in `apps/api`, and
`MALEO_SEARXNG_URL` is the only wiring between the two, exactly as
`MALEO_KOKORO_URL` is for `infra/kokoro-tts`.

Unlike the TTS apps, this one ships a config file. That is deliberate — see
"Configuration is part of the image" below.

## THIS DIRECTORY'S PATH IS PRODUCTION CONFIGURATION

Coolify builds this service straight from this path. The settings live in
Coolify's database, **not in this repository**, so nothing here — no typecheck,
no test, no CI gate — can catch a change that breaks them.

| setting               | value                                                                                             |
| --------------------- | ------------------------------------------------------------------------------------------------- |
| app                   | `<deployment-app-id>` (`https://search.example.com`)                                              |
| project / environment | deployment-defined                                                                                |
| `base_directory`      | `/infra/searxng`                                                                                  |
| `dockerfile_location` | `/Dockerfile`, relative to the base directory                                                     |
| `ports_exposes`       | `8080`                                                                                            |
| `watch_paths`         | `infra/searxng/**`                                                                                |
| auto-deploy           | **enabled**                                                                                       |
| healthcheck           | `GET /healthz` on `:8080`                                                                         |
| memory limit          | `512m`, via `custom_docker_run_options=--memory=512m`                                             |
| fence                 | **Cloudflare Access**, Self-hosted app + Service Auth policy (NOT a proxy middleware — see below) |
| required secrets      | `SEARXNG_SECRET` (value never in this repository)                                                 |

**Do not move, rename, or delete this directory without updating
`base_directory` and `watch_paths` first.** Auto-deploy is on: a push that
relocates these files while Coolify still points here builds against a path that
no longer exists. Update Coolify _before_ the push — the reverse order
guarantees one failed build.

The rows below the healthcheck are the ones the TTS apps do not have, and they
fail the same silent way a moved `base_directory` does: they exist in one
database, no gate here can observe them, and their absence is discovered in
production. The memory limit exists so a runaway instance cannot starve the TTS
services sharing the host.

## Access control

**This service has no authentication of its own.** SearXNG ships none. It is
fenced at the proxy with HTTP basic auth, over HTTPS only, and that fence was
attached in the same operation that gave it a public address.

A keyless public SearXNG becomes someone else's search proxy within days, and
the IP that gets blocked by every upstream engine is this server's — which takes
the feature down by the same mechanism it was built to fix.

- Credentials live in the root `.env` on the client side. Never here.
  **Custom Traefik labels are NOT a usable fence on this Coolify instance.**
  Tried and measured, so nobody repeats it: a `basicauth` middleware written into
  `custom_labels` survives the API write, and is then **discarded on the next
  deploy** — Coolify regenerates the label set because
  `is_container_label_readonly_enabled` is `true`, and the regenerated https
  router carries only `gzip` and Coolify's own `noindex` middleware. The service
  answered `HTTP 200` unauthenticated after the redeploy. Its FQDN was removed
  immediately (Traefik then returns 503) and stays unset until a fence exists that
  survives a deploy.

Two mechanisms that do survive, both requiring the Coolify or Cloudflare UI:

1. **Coolify's native basic auth** — the app's Basic Authentication toggle
   (`is_http_basic_auth_enabled` + username/password). Part of the label
   generator, so regeneration keeps it. The **API rejects these fields**
   ("Invalid request"), so it must be set in the UI.
2. **Cloudflare Access** — this domain is already Cloudflare-proxied
   (when chosen hostname is proxied), so an Access application
   with a Service Auth policy fences it in front of Traefik entirely. The caller
   then sends `CF-Access-Client-Id` and `CF-Access-Client-Secret`. Better than
   basic auth — real identity, dashboard rotation, an audit trail — and it does
   not fight Coolify's label generation at all.

Notes that remain true either way:

- Credentials live in the root `.env` on the client side. Never here.
- The API requires `custom_labels` **base64-encoded**; plaintext is rejected
  with "The custom_labels should be base64 encoded."
- `is_container_label_escape_enabled` is on for this app, so a raw
  `htpasswd -nbB` hash needs no manual `$$` escaping — the predicted trap did
  not materialise.

Basic auth is sized for the threat: anonymous scanners and open-proxy abuse
against a service with exactly one consumer. It gives no per-caller identity and
no audit trail. Cloudflare Access service tokens are the upgrade if that is ever
needed, and they change two request headers and nothing else.

## Configuration is part of the image

`settings.yml` is `COPY`ed in the Dockerfile rather than mounted or held in
Coolify, because two of its lines decide whether the service answers at all:

- **`search.formats` includes `json`.** Upstream defaults to HTML only. Without
  this the API returns 403, which reads as a network failure rather than a
  configuration one.
- **`server.limiter: false`.** The limiter's bot detection rejects non-browser
  callers, which is every request this instance will ever receive. Access
  control is the proxy's job here. There is no `limiter.toml`; the settings key
  is the switch, and the container logs a harmless "missing config file" warning
  for the absent file.

`server.method: "GET"` is also required — upstream defaults to POST-only search
and the client issues `GET /search?q=...&format=json`.

The secret is **not** baked. `settings.yml` carries the upstream `ultrasecretkey`
placeholder and the entrypoint substitutes `SEARXNG_SECRET` at boot.

## The caller must ask for the `science` category

**`categories=general,science` is part of the request contract**, not a tuning
knob. SearXNG's scholarly engines — arxiv, pubmed, semantic scholar, google
scholar, crossref, openalex — are all in the `science` category, and a request
that does not name it never reaches them.

Measured on `"how does a heat pump move heat against a temperature gradient"`
from this server:

| request                                  | results | engines that answered                    |
| ---------------------------------------- | ------- | ---------------------------------------- |
| `format=json`                            | 35      | brave, google cse                        |
| `format=json&categories=general,science` | 55      | brave, google cse, google scholar, arxiv |

The second one also put a peer-reviewed review paper in the top ten. Those
scholarly indexes are the keyless, captcha-free sources that actually ground an
explainer or documentary, so a provider that omits the category is leaving the
best half of this instance switched off.

## Engine selection is a decision, not a default

Google and Bing are disabled in `settings.yml`. Both rate-limit and captcha
datacenter IPs _intermittently_, and an engine that answers most of the time is
worse here than one that never answers: the grounding a story plan receives
would depend on which query happened to hit a captcha, and nothing downstream
can see that. The plan would look grounded while being thin.

Measured from this server across three real briefs (technical, historical
Indonesian, non-English technical): **Startpage CAPTCHAs on every query** and
**DuckDuckGo fails with an HTTP connection error** — the latter from a
residential IP too, so it is an upstream engine problem rather than this
server's reputation. Both are therefore `disabled: true` rather than left to
fail, because a permanently failing engine still costs a request and a timeout
on every search. Re-test both on a pin bump.

`ahmia` and `torch` are onion engines that cannot register without a Tor proxy
and logged an error on every boot; also disabled.

`google cse` is left at its upstream default. Unlike plain `google` it answered
every measured query — but it is still Google infrastructure, so treat a sudden
drop in result counts as this engine first.

`outgoing.request_timeout` is 10s, not upstream's 3s: `semantic scholar` timed
out at 6s on a real query. Research is a background pre-production step, so
latency buys grounding here.

Engine reliability from this IP is the thing to re-check whenever grounding
quality drops. The query to run is any real brief against
`/search?q=...&format=json&categories=general,science`, and the field to read is
`unresponsive_engines` in the response.

## Local Contracts

- **The image is the deployment artifact.** Changing the `Dockerfile` or
  `settings.yml` changes what runs in production; treat either as a deploy, not
  a refactor.
- `.dockerignore` excludes source and TypeScript config on purpose. The build
  needs neither, and pulling them in would rebuild the image on unrelated edits.
  `settings.yml` is deliberately _not_ excluded: a config edit should rebuild.
- The pin is exact. `latest` plus auto-deploy means an unrelated push can swap
  what production runs.
- Verify a change locally before pushing:
  ```bash
  docker build --platform linux/amd64 -t maleo-searxng:test infra/searxng
  docker run --rm -e SEARXNG_SECRET=dev -p 18080:8080 maleo-searxng:test
  curl -s 'http://127.0.0.1:18080/search?q=test&format=json' | head -c 200
  ```
