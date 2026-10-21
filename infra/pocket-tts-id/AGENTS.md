# infra/pocket-tts-id — agent instructions

## Purpose

This directory deploys the **Pocket TTS Indonesian** speech service: the
6-layer student model from `anak10thn/pocket-tts-indonesian`, wrapped in a
small FastAPI server that exposes `POST /v1/audio/speech` and `GET /health` on
port 8000.

It holds a `Dockerfile`, `server.py`, a `.dockerignore`, and this file. The
client that calls this service lives at
`packages/media/src/providers/pocket-tts-id/`, with every other media provider.

Unlike `infra/kokoro-tts`, there is no upstream image to adopt — pocket-tts is a
library, not a server — so `server.py` is ours and belongs here rather than in
a package. It is the only Python in the repository that ships as a deployable.

## The service holds no voices

**This service is stateless, and that is a decision, not an omission.** The
voice prompt arrives as bytes with each request. There is no upload endpoint,
no mounted volume, and no voice list.

A registry here would make the application's voice catalogue dynamic and
fetched, put operator recordings on storage this repository does not back up,
and give one clone two places to exist and disagree. The clone library is the
application's, in `voice_clone`. Do not add voice storage to this service.

## The URL is not an environment variable

The client resolves this service's address from a `ProviderConfigField`
declared in its `meta.ts`, entered in Settings and stored in the database. There
is no root `.env` entry, and adding one would only serve as break-glass while
the config service is down.

## THIS DIRECTORY'S PATH IS PRODUCTION CONFIGURATION

Coolify builds this service straight from this path. The settings live in
Coolify's database, **not in this repository**, so nothing here — no typecheck,
no test, no CI gate — can catch a change that breaks them.

| setting               | value                                                       |
| --------------------- | ----------------------------------------------------------- |
| app                   | `<deployment-app-id>` (`https://pocket-tts-id.example.com`) |
| project / environment | deployment-defined                                          |
| source                | a Coolify GitHub App on this repository's default branch    |
| `base_directory`      | `/infra/pocket-tts-id`                                      |
| `dockerfile_location` | `/Dockerfile`, relative to the base directory               |
| `ports_exposes`       | `8000`                                                      |
| `watch_paths`         | `infra/pocket-tts-id/**`                                    |
| auto-deploy           | **enabled**                                                 |
| healthcheck           | `GET /health` on `:8000`                                    |

**Do not move, rename, or delete this directory without updating
`base_directory` and `watch_paths` first.** Auto-deploy is on: a push that
relocates these files while Coolify still points here builds against a path that
no longer exists. Update Coolify _before_ the push — the reverse order
guarantees one failed build.

Coolify keeps the previous image, so the rollback for a failed build is
redeploying the last good deployment while the path is corrected.

## Local contracts

- **The model revision is pinned and that pin is load-bearing.** A floating
  reference plus auto-deploy means an upstream change can swap the model on a
  rebuild triggered by an unrelated push. Moving the pin is a deploy decision,
  and the voice it produces changes with it.
- **The weights are baked at build time.** Coolify restarts containers far more
  often than it rebuilds them; a first boot that downloads 438 MB fails its
  healthcheck before it serves anything. Builds are slow on purpose.
- **`eos_threshold` is -6.0 and belongs to the model, not the caller.** The
  library defaults to -4.0; the model card publishes its WER at -6.0. Exposing
  it as a request field would let a caller silently opt out of the only setting
  the model was measured at.
- **Every pip version is pinned, and torch comes from the CPU index.** The
  default torch wheel carries a CUDA runtime this image will never execute.
- **One uvicorn worker, one lock.** The model holds decode state and is
  serialised inside the process. A second worker would double resident memory —
  the weights are not shared — for no throughput.
- `wget` is installed on purpose: Coolify's generated healthcheck shells out to
  it. The image installs as root and **must** switch back to `appuser`, or the
  server runs as root.
- **`ffmpeg` is load-bearing, not a convenience.** pocket-tts reads a 16-bit WAV
  with the standard library and hands everything else to `soundfile`, whose
  libsndfile cannot decode M4A or AAC — and a phone voice memo is M4A. Every
  prompt is normalized to mono 16-bit WAV before the model sees it. Removing
  ffmpeg silently narrows the service to WAV-only uploads.
- **A failure is logged before it is converted to a response.** The proxy in
  front of this service replaces a 5xx body with its own error page, so an
  exception that only reaches the response body leaves no trace anywhere. An
  undecodable prompt is a 400, not a 5xx: it is the caller's input, not an
  outage.
- **Returned speech is levelled to a house loudness** (`POCKET_TTS_LOUDNESS_LUFS`,
  default -24 LUFS). The model reproduces the level of its voice prompt, so a
  quiet recording clones into narration ~30 dB under what the other providers
  return — which in a timeline reads as a broken clip. The target is measured
  against this application's existing clips, not a broadcast preset, because
  two providers' narration has to mix. `loudnorm` resamples to 192 kHz unless
  `-ar` is passed; it is passed.
- Port and health path are contract: the client's reachability probe and the
  Coolify healthcheck both assume `:8000` and `GET /health`.

## Known model limitations

These come from the model card and are properties of the weights, not bugs here:

- output is band-limited to **16 kHz** (Kokoro's is 24 kHz — mixing both in one
  timeline is audible)
- **digits must be spelled out**; `15` is not read as `lima belas`
- **exclamation marks are unsupported**
- long texts occasionally drop an enumeration item
- cloning "flattens voices" across speakers — a clone is recognisable, not exact

## Verification

Repository gates cannot see this service. After any change here, or to this
directory's path, confirm the deploy itself:

- the Coolify app rebuilds and reports `running:healthy`
- `GET /health` responds and reports the expected pinned config
- a real synthesis with a voice prompt returns playable audio in that voice
- two prompts with identical text return audibly different audio
- the container runs as `appuser`, not root (`docker exec … id`)
