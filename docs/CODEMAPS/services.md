# Auxiliary Services

The API, web client, and media worker deploy from one root `Dockerfile` and are
told apart by their compose command; see `deploy/AGENTS.md`.

Services that sit beside the API and web client. See the root `README.md` for
the full workspace map.

## @maleo/media + apps/media-worker

Content-generation provider abstraction and the worker runtime that hosts it.

`@maleo/media/prompt-definitions` exports the production-owned image compiler
fragments, block order, and application-authored provider-wrapper instructions for
read-only backend inspection. It initializes no worker and selects no provider.
Production compilation still happens in the worker after provider selection;
the catalog exposes reference-mode variants, not a future submitted request.
Providers implement the abstraction; the worker owns queueing and disposable
provider scratch. Image and TTS generation both run through
here. Completed bytes go through `@maleo/storage` to a private
S3-compatible bucket in production; API owns stable media IDs and access.
Tech: Bun, Hono, Inngest durable runs.

## Media store (in `deploy`)

Self-hosted S3-compatible media store (RustFS, Apache-2.0). Deployed as part of
the core stack rather than alone, because writes must not cross a CDN; its
`init.sh` creates the private bucket and CORS rule idempotently on every deploy,
and the data volume survives container replacement. API, worker, and video
service write internally and sign browser reads against the public endpoint.
Hosted R2 or S3 replaces it by configuration. One credential pair administers
the server — see `docs/self-hosting.md`.

## infra/kokoro-tts + infra/pocket-tts-id

The two self-hosted TTS services. Kokoro serves fifty-four declared speakers
behind an OpenAI-shaped speech endpoint; Pocket TTS Indonesian declares no
speakers at all and clones the voice in an audio prompt sent with each request.
Both are deployed from their directory by Coolify and reached through a service
URL entered in Settings. Their clients live in `packages/media/src/providers/`.
Tech: upstream `kokoro-fastapi` image; FastAPI + pocket-tts on CPU.

## @maleo/video

Remotion short-form video compositions (TikTok/Reels).
Scene templates: Hook, Feature, Testimonial, BeforeAfter, CTA, SplitScreen.
Tech: Remotion 4.0, React 19, Lambda support. Studio + server modes.
Rendered MP4s and manifests upload before a job reports success. Managed inputs
are fetched for the live render and temporary copies are removed afterward.

## @maleo/stock

Stock media lookup used when a clip needs footage rather than generated art.

## @maleo/shared

Pure types + logic shared across packages.
Exports: content behavior, image/video policy, video style/blueprint/editorial,
timeline/template/doc/model, creative direction, credits, and render-storyboard
helpers.
No IO — consumed as validators/parsers by every side.
