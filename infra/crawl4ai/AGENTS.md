# infra/crawl4ai — agent instructions

## Purpose

This directory deploys **Crawl4AI**, the page-extraction half of self-hosted
research retrieval: a pinned upstream image serving the extraction API on port 11235. SearXNG (`infra/searxng`) finds candidate URLs; this reads them.

It holds a `Dockerfile`, a `.dockerignore`, a `config.yml`, and this file —
nothing else. There is no TypeScript here and none belongs here: the client that
calls this service is the research provider in `apps/api`, and
`MALEO_CRAWL4AI_URL` is the only wiring between the two.

## THIS DIRECTORY'S PATH IS PRODUCTION CONFIGURATION

Coolify builds this service straight from this path. The settings live in
Coolify's database, **not in this repository**, so nothing here — no typecheck,
no test, no CI gate — can catch a change that breaks them.

| setting               | value                                                                                                          |
| --------------------- | -------------------------------------------------------------------------------------------------------------- |
| app                   | `<deployment-app-id>` (`https://crawler.example.com`)                                                          |
| project / environment | deployment-defined                                                                                             |
| `base_directory`      | `/infra/crawl4ai`                                                                                              |
| `dockerfile_location` | `/Dockerfile`, relative to the base directory                                                                  |
| `ports_exposes`       | `11235`                                                                                                        |
| `watch_paths`         | `infra/crawl4ai/**`                                                                                            |
| auto-deploy           | **enabled**                                                                                                    |
| healthcheck           | `GET /health` on `:11235`                                                                                      |
| memory limit          | `2g`, via `custom_docker_run_options` (the API rejects `limits_memory`)                                        |
| custom docker options | `--memory=2g --shm-size=1g` — see "Shared memory" below                                                        |
| fence                 | **Cloudflare Access**, same Self-hosted app as `infra/searxng` (one Service Auth policy covers both hostnames) |
| required secrets      | `CRAWL4AI_API_TOKEN` (value never in this repository)                                                          |

**Do not move, rename, or delete this directory without updating
`base_directory` and `watch_paths` first.** Auto-deploy is on: a push that
relocates these files while Coolify still points here builds against a path that
no longer exists. Update Coolify _before_ the push — the reverse order
guarantees one failed build.

The rows below the healthcheck fail the same silent way a moved `base_directory`
does: they exist in one database, no gate here can observe them, and their
absence is discovered in production.

## Access control — two independent credentials

This service **fetches whatever URL its caller gives it**, from inside the
Coolify network, where the object store, Postgres, Redis and the TTS services live. Whoever
can call it has a fetch proxy into that network. The URL classification in
`apps/api` (`classifyResearchUrl`) protects maleo's own requests and does
nothing for anyone else's, so it is not a control on this service.

Hence two credentials that are not the same secret:

1. **Cloudflare Access**, HTTPS only, in place before the service had a public
   address. It is the same Access application that fences `infra/searxng`, so one
   service token covers both hostnames and one rotation covers both. Verified:
   an unauthenticated `GET /health` returns `403` with the Access error page.

   A Traefik `basicauth` middleware in custom labels was tried first and does
   NOT work on this Coolify instance — the labels are regenerated on every
   deploy and the middleware is silently dropped. See `infra/searxng/AGENTS.md`.

2. **`CRAWL4AI_API_TOKEN`**, the service's own credential. This is not optional
   hardening: upstream binds `127.0.0.1` by default and its startup guard
   _refuses a non-loopback bind without a token_. A missing token therefore
   fails loudly at boot rather than quietly serving open — which is the correct
   failure and worth preserving.

Notes:

- Credentials live in the root `.env` on the client side. Never here.
- The Access service token is shared with `infra/searxng`; the SECOND credential
  (`CRAWL4AI_API_TOKEN`) is what makes a single leak insufficient here, and it is
  unique to this service.
- `security.jwt_enabled` stays `false`: the token alone gates `POST /crawl`.
  Measured — see "Endpoint auth" below.

## The caller must ask for filtered markdown

**Read `markdown.fit_markdown`, not `markdown.raw_markdown`**, and send a content
filter in the request. This is a request-contract requirement, not a
nice-to-have, because of how the caller uses the result: `readWebPageFlow` in
`apps/api` takes the FIRST `RESEARCH_CAPS.maxExcerptChars` (600) characters
of what it receives. Raw markdown starts with navigation, so those 600 chars
would be a menu — and the exact-quote validation downstream would then either
fail or cite a nav bar.

Measured on `https://en.wikipedia.org/wiki/Heat_pump`:

| field          | chars   | first 300 chars                                                                                  |
| -------------- | ------- | ------------------------------------------------------------------------------------------------ |
| `raw_markdown` | 146,499 | "Jump to content / Main menu / Navigation / Main page ..."                                       |
| `fit_markdown` | 91,919  | "From Wikipedia, the free encyclopedia. System that transfers heat from one space to another..." |

The request that produces it:

```json
{
	"urls": ["..."],
	"crawler_config": {
		"type": "CrawlerRunConfig",
		"params": {
			"word_count_threshold": 30,
			"excluded_tags": ["nav", "footer", "header", "aside", "form", "script", "style"],
			"exclude_external_links": true,
			"markdown_generator": {
				"type": "DefaultMarkdownGenerator",
				"params": {
					"content_filter": {
						"type": "PruningContentFilter",
						"params": { "threshold": 0.45, "threshold_type": "dynamic" }
					}
				}
			}
		}
	}
}
```

One leading "Jump to content" anchor link still survives on Wikipedia; the
caller's existing excerpt cleaning handles that.

## Endpoint auth, measured

- `GET /health` answers with no bearer token (Cloudflare Access still applies).
  That is what lets Coolify's healthcheck work from inside the container.
- `POST /crawl` returns `401 {"detail": "Authentication required"}` without the
  token, **with `security.jwt_enabled: false`**. So `CRAWL4AI_API_TOKEN` alone
  gates the crawl endpoints and no `/token` JWT exchange is needed. This settles
  the question left open when the config was written; `jwt_enabled` stays off.

## Configuration is part of the image

`config.yml` is `COPY`ed in the Dockerfile because one line decides whether the
service answers at all: upstream binds `127.0.0.1` and the caller is outside the
container.

The file is **upstream's `deploy/docker/config.yml` at the pinned tag**, with two
changes marked `MALEO:` and nothing else touched. Crawl4AI loads it wholesale —
there is no "inherit upstream defaults" switch like SearXNG's
`use_default_settings` — so a partial file would drop keys the server needs.
**Re-diff it against upstream whenever the pin moves.**

The two changes:

- `app.host: "0.0.0.0"` — see above.
- `crawler.pool.max_pages: 4`, down from 40. Sized to how the caller actually
  drives this: `researchTopic` reads candidates in a sequential `for` loop capped
  at `RESEARCH_CAPS.maxSources` (5), so the working set is one browser context
  per research pass. A pool this host cannot afford to fill is a pool that
  OOM-kills the TTS services sharing it.

Left at upstream defaults on purpose: `limits.wall_clock_s` (300s per crawl),
`rate_limiting` (1000/minute), and `security.trusted_hosts: ["*"]` — the last
because the proxy is the fence, and pinning it to an FQDN would break a rename
in a way that reads as an outage.

Redis is configured in `config.yml` for the background job queue
(`/crawl/job`). The provider uses synchronous extraction only, so a missing
Redis does not matter; do not add one for this service without a reason.

## Shared memory

Upstream's Chromium args already include `--disable-dev-shm-usage`, which is the
mitigation `--shm-size` exists for: Chromium writes to `/tmp` instead of the
container's 64 MB `/dev/shm`. **A larger `--shm-size` is therefore probably
unnecessary here** — contrary to the usual advice for containerised Chromium,
which assumes that flag is absent.

`--shm-size=1g` IS set in this app's custom docker options anyway, as cheap
insurance on a host with headroom: the flag and the larger `/dev/shm` do not
conflict, and if a future pin drops `--disable-dev-shm-usage` from upstream's
args the service keeps working instead of crashing on heavy pages. If memory
ever gets tight on this host, this is a safe thing to remove first — check that
upstream still passes `--disable-dev-shm-usage` before doing so.

## Local Contracts

- **The image is the deployment artifact.** Changing the `Dockerfile` or
  `config.yml` changes what runs in production; treat either as a deploy.
- `.dockerignore` excludes source and TypeScript config on purpose. `config.yml`
  is deliberately _not_ excluded: a config edit should rebuild the image.
- The base image is ~1.65 GB compressed. A local `docker build` needs real disk
  headroom; the authoritative build is Coolify's, on the deploy host.
- Verify a change locally, disk permitting:
  ```bash
  docker build --platform linux/amd64 -t maleo-crawl4ai:test infra/crawl4ai
  docker run --rm -e CRAWL4AI_API_TOKEN=dev -p 11235:11235 maleo-crawl4ai:test
  curl -s http://127.0.0.1:11235/health
  ```
