# @maleo/media — agent instructions

## Purpose

`@maleo/media` owns content-generation provider abstraction and the durable
media worker runtime for image, TTS, and video generation.

## Ownership

- `src/api/` owns the dashboard-facing media client and DTOs.
- `src/providers/` owns capability interfaces, provider registry, selection,
  and the per-provider adapters.
- `src/generation/` owns the `generation-run` Inngest function, runtime seam,
  worker implementation, and SQLite job result store.
- `src/processing/` owns bounded import probing, thumbnails, normalization,
  selected-source reverse derivatives, readiness, authenticated processing
  routes and `media-processing-run`.
- `src/worker.ts` owns the Hono app served by `apps/media-worker`.

## Local Contracts

- **Providers resolve configuration through the seam in
  `src/providers/config.ts`, never from `process.env` directly.** A host installs
  a source: the API installs one backed by its database, the worker one backed by
  `GET /internal/config` on the API, and a host that installs nothing keeps
  reading the environment. Reading the environment inside a provider is what made
  a credential entered in settings invisible to the worker that actually
  generates. `config.test.ts` guards it.
- **The worker fails closed.** If it cannot resolve configuration, the provider
  reports `unconfigured` and the job fails naming the configuration service. It
  must never fall through: `sandbox` is registered last and fabricates output, so
  it wins precisely when everything above it looks unconfigured.
- Keep callers provider-agnostic. Dashboard and other packages should enter
  through `@maleo/media/api` or the worker HTTP contract, not concrete
  provider files.
- Media client submit/poll HTTP requests must stay time-bounded. A stalled
  worker socket must reject so the caller's durable retry policy can run; it
  must never hold an Inngest step indefinitely.
- Providers live here, one directory per provider under `src/providers/<name>/`.
  Every one of them, with no exceptions left.
- `@maleo/inngest` is shared infrastructure only. Media-owned generation
  functions, store writes, and provider resolution stay in `@maleo/media`.
- `apps/media-worker` stays a thin process shell; worker logic lives here.
- Worker HTTP contract is `POST /generate`,
  `POST /tts`, `POST /video`, `GET /jobs/:id`, `GET /health`, plus queryable
  provider comparison at `GET /metrics/providers`.
- Import worker contract adds service-authenticated `POST /processing`,
  `GET /processing/readiness`, `GET /processing/:id` and `DELETE /processing/:id`.
  Poll/cancel require matching workspace/project query scope. `/health` keeps
  liveness separate from binary processing readiness.
- Optional reverse operations use managed immutable video identity and selected
  original-source seconds. Source bytes come from service-authenticated
  `/internal/media-processing/:id/source`; GET and pre-publication HEAD verify
  current project admission and revision. Buffer bounded frame chunks, reverse
  audible source audio, and concatenate with PCM audio before final AAC encoding.
  Share import deadline, cancellation, scratch ceilings and durable job store.
  Derivative metadata is separate from original metadata; import publication
  must reject derivative jobs.
- Runtime artifacts use `GEN_WORKER_DB` for the SQLite job store and `CACHE_DIR`
  for generated files. Relative values resolve from the repo root, not process
  cwd. Local defaults are `apps/media-worker/data/gen-worker.sqlite` and
  `apps/media-worker/data/cache`, matching the thin worker app's existing
  runtime storage. Do not commit those artifacts.

## Work Guidance

- Add new providers by extending `src/providers/registry.ts` and capability
  implementations; selection must remain capability-scoped.
- Provider health shown for a picker must be checked with that capability;
  provider-wide readiness can hide an unconfigured image or TTS implementation.
- **Browser-session providers are development-only.** Gemini Canvas and
  BrowserOS drive a real browser over CDP; a container has none, so a deployed
  image provider is Cloudflare Workers AI or Hugging Face.
  `MALEO_GENERATION_CONCURRENCY_PER_KIND` defaults to 1 _because_ of the
  browser providers — a deployment on an HTTP provider should raise it.
- Live execution uses health-aware selection. Explicit project/workspace/env
  provider ids fail loudly when missing, incapable, or unhealthy; only an
  unconfigured default may choose the first ready provider.
- The worker remuxes generated H.264 MP4 output to faststart (or transcodes other codecs) and writes a JPEG poster.
- Media jobs persist provider id/source/model, cost, cache status, and latency so
  provider performance and usable-output rates remain queryable.
- **Registry order is behavior, not display.** `providersFor` preserves it and an
  unconfigured default takes the first provider reporting `ready`, so the head of
  the list per capability must produce real output when configured:
  `cloudflare-ai` for image, `kokoro` for TTS. Append new providers; do not
  prepend.
- **The sandbox is a mock.** Image and TTS report `ready` only with
  `MALEO_SANDBOX=1`, so no misconfiguration
  can land on fabricated output. Select it with `MALEO_PROVIDER_IMAGE=sandbox`
  or `MALEO_PROVIDER_TTS=sandbox` **and** the opt-in; without the opt-in an
  explicit selection fails loudly rather than generating a mock.
- Sandbox video requires explicit Video provider selection and FFmpeg/ffprobe,
  with no `MALEO_SANDBOX` flag. `meta.explicitOnly` excludes it from automatic
  video resolution. It produces exactly four silent seconds at 30 fps, with a
  visible sandbox marker and motion. Actual source duration stays separate from
  timeline placement; existing playback holds the final source frame.
- Fal video uses the same provider and worker seam. Resolve `FAL_KEY` and
  `FAL_I2V_MODEL` through shared configuration; keep vendor requests/downloads
  bounded and verify MP4 bytes before publication. Output URLs must belong to
  Fal's HTTPS media host and downloads must not follow redirects.
- Sandbox TTS writes a real WAV whose duration follows the text length, so
  downstream timing (narration pacing, caption alignment, clip fitting) is
  exercised rather than flattened to a constant.
- **Kokoro is the real self-hosted TTS provider**, dialing
  `infra/kokoro-tts` through the OpenAI-compatible client at
  `src/providers/openai-speech/`. With `MALEO_KOKORO_URL` unset, TTS fails rather
  than falling through to the mock — that is intended, not a regression.
- **A TTS provider's voices live on its meta**, as `meta.tts.voices`, the twin of
  `meta.image.references`. `apps/api` builds every voice-bearing surface from
  whichever providers are registered, so no consumer imports a provider's voice
  constant and adding a provider adds its voices. Conformance rejects a TTS
  provider with no catalogue: it would be selectable with nothing to speak with.
- **Kokoro's catalogue is derived from its voice ids** (`af_heart` → US English,
  female), never restated per voice, and an unknown language prefix is an error.
  It is static so it can be read with the service down, and
  `kokoro/voices.live.test.ts` checks it against `GET /v1/audio/voices` whenever
  a service is configured — that test is what catches an image pin that moved.
- Select Codex imagegen explicitly with `MALEO_PROVIDER_IMAGE=codex`. It spawns
  the `codex` CLI, like the codex text provider; with that CLI absent it reports
  `unconfigured` and explicit selection fails rather than falling back.
- Select Cloudflare Workers AI explicitly with
  `MALEO_PROVIDER_IMAGE=cloudflare-ai`; it needs `MALEO_CF_ACCOUNT_ID` and
  `MALEO_CF_API_TOKEN`. **The configured model decides what the provider can
  honour.** `MALEO_CF_IMAGE_MODEL` is resolved from a table, never passed
  through: `flux-2-klein-4b` (default) takes width/height and up to four
  reference images, while `flux-1-schnell` takes neither and refuses a
  non-square aspect rather than returning a mis-framed square. References are
  downscaled below the model's 512px input limit before upload.
- Select Hugging Face explicitly with `MALEO_PROVIDER_IMAGE=huggingface`; it
  needs `HF_TOKEN`, optionally `HF_BILL_TO` for organization billing. Requests
  route through the HF router so the account's included credits apply. A model
  that is not currently served is a generation error naming the model, not a
  health state.

  **It is permissive by decision (design.md D12): it ignores reference inputs and
  keeps whatever image size comes back.** The text-to-image task has no reference
  parameter at all, and the serving providers behind the router ignore the
  documented `width`/`height` (verified: `nscale` returns 1024x1024 and `fal-ai`
  returns 1024x768 for a 1080x1920 request, both reporting success). So a `9:16`
  request here can succeed with a square, and picked references have no effect —
  with no error either way. The aspect is still requested, and
  `MALEO_HF_INFERENCE_PROVIDER` pins a serving provider. **When the aspect has
  to be right, use `cloudflare-ai`**, whose model abilities are knowable before
  the request and which therefore refuses instead of guessing.

- Keep trusted context in `ProviderCtx`; never accept workspace/user/project
  trust data from model/tool arguments.
- Expensive generation should preserve idempotency through the Inngest event
  idempotency key and provider context.
- `generation-run` defaults to one concurrent run per media kind. Raise
  `MALEO_GENERATION_CONCURRENCY_PER_KIND` only when the selected provider can
  safely drive multiple sessions/tabs in parallel.
- A persisted project/workspace provider id naming no registered provider falls
  through to the default (it was valid when written; a provider was retired under
  it). The same id in an env var still throws — that one was typed just now. A
  registered but unhealthy provider throws from every source.

## Provider contracts

Each provider is one directory under `src/providers/<name>/`. These are the
contracts their packages carried before they were folded in; they are contracts,
not notes, and a change that breaks one is a behaviour change.

### Packaging

- **A provider is a directory here, not a workspace package.** No registered
  provider has its own package, and a new one would need a stated reason: a
  runtime this package cannot host, or a consumer that must not depend on the
  media domain.
- **A deployable artifact is not one of those reasons — it belongs under
  `apps/` or `infra/`.** `infra/kokoro-tts` builds the service and
  `src/providers/kokoro/` calls it. Keep deployable service and TypeScript client
  separate.
- **Reference path resolution has exactly one implementation**,
  `src/providers/shared/paths.ts`. It is input validation at a trust boundary;
  every provider that resolves references calls it. Do not copy it into a
  provider, and do not add a second resolver with different guards.
- Cache paths come from `mediaWorkerCacheDir()` in `src/paths.ts`. Do not
  recompute the repo root relative to your own file — that value changes when the
  file moves.

### cloudflare-ai

- **The model decides what can be honoured, so the model id is never passed
  through.** `MALEO_CF_IMAGE_MODEL` resolves from the table in `models.ts`; an
  unknown id is a configuration error. Adding a model means adding its declared
  abilities, not just its id.
- A model exposing no width/height must refuse a non-square aspect. Never return
  a square where another aspect was requested — the caller gets a usable image
  with the wrong framing and no indication why.
- References are downscaled below the model's documented input limit, and a model
  accepting none refuses them. Never drop a reference silently.
- Refusals happen before the request is sent; a billed generation must not be
  spent discovering a configuration error.

### huggingface

- **Requests route through the HF router, never to a serving provider directly.**
  Going direct forfeits the account's included monthly credits.
- **This provider is permissive by decision, not oversight.** It refuses nothing
  except empty output. Reference inputs are accepted and ignored (the
  text-to-image task has no parameter for them), and the returned image is kept at
  whatever size arrives (`nscale` returns 1024x1024 and `fal-ai` 1024x768 for a
  1080x1920 request, both reporting success). Cloudflare can refuse for free
  because its model abilities are knowable before the request; here they are
  discoverable only after paying, so the choice was "return the image that was
  paid for". Use `cloudflare-ai` when the aspect must be right.
- The response's `Content-Type` is not evidence (`image/jpeg` observed over PNG
  bytes) — the extension comes from the magic number.
- There is no model capability table, deliberately: breadth is the point, and
  whether a model is currently served cannot be tabulated. An unserved model is a
  generation error naming the model, not a health state.
- Exhausted credits are discriminated from transient failures, because retrying
  them cannot succeed.

### codex

- `imagegen` is a Codex skill, not an importable API. Reach it by spawning
  `codex exec`. Do not add a second runner abstraction in front of the CLI.
- The prompt starts with `$imagegen <request>` and `--enable image_generation`
  stays on the invocation; without it the agent has no image tool.
- Spawn without a shell; the caller prompt travels on stdin, never in argv.
- Keep `--ephemeral --ignore-user-config` (user config lifecycle hooks can hang
  the process past its timeout) and `tools.web_search=false` (single-shot
  generation, not research).
- Run `--sandbox workspace-write` against a per-run temp dir. Do not widen it and
  do not point it at the repo; remove the dir once the output is adopted.
- **The reported output path comes out of a model turn and is untrusted.** Accept
  it only inside the run workspace or `$CODEX_HOME`.
- Never return a `$CODEX_HOME/generated_images` or temp-workspace path as the
  result — copy the bytes into the cache and return the managed path.
- Health is `codex --version`, not a generation: the settings picker polls health
  on every render and a real self-check would spend a model turn.
- `MALEO_CODEX_IMAGE_TIMEOUT_MS` defaults to 300000. Live runs were observed at
  76s and 169s, so do not tighten it casually.
- Cache reuse happens only with a caller-supplied idempotency key, so each unkeyed
  attempt stays individually attributable in the ledger.

### sandbox

- Every generated image visibly contains `SANDBOX`, its unique id, and its actual
  pixel dimensions. Escape prompt text before embedding it in SVG markup.
- Aspect presets map to stable dimensions; explicit width and height override the
  preset together.
- Never call a network service or a real generation provider.
- Image/TTS readiness is opt-in (`MALEO_SANDBOX=1`); video uses explicit
  selection and local binary readiness — see the selection rules above.

### Every provider

- `health()` reports absence as a VALUE (`unconfigured` / `down`) and never
  throws. CI runners have no credentials, no browser, and no CLI.
- Upstream rate limits and 5xx throw with the status preserved. **Do not sleep or
  retry inside a provider** — `generation-run` owns durable retry, and an
  in-provider sleep burns wall-clock inside an Inngest step.
- Provider scratch files use `CACHE_DIR`, resolved from repo root when relative,
  defaulting to `apps/media-worker/data/cache`. Completed bytes are stored through
  `@maleo/storage`; the cache is disposable and has no HTTP file route.
- Generated files are runtime artifacts and must not be committed.

## Verification

```bash
cd packages/media
bun run typecheck
bun run test       # Vitest suites; add a file path to run one
bun run test:bun   # suites that need the Bun runtime (*.bun.test.ts)
```

For worker behavior changes, also start the worker and hit `/health`.
