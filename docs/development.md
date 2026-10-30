# Local development

For an existing installation, follow [Maleo cutover](self-hosting.md#maleo-cutover) before starting renamed services. Use disposable copied state for rehearsals. Runtime reads only `MALEO_*`; root `.env` is not converted automatically.

Install and first run are in the [README quickstart](../README.md#quickstart).
This guide covers everything after that.

## Retired visual cleanup

Existing databases must complete visual cleanup before this release starts.
Use disposable copied data to rehearse the [deployment procedure](self-hosting.md#retired-visual-presets).
Fresh empty databases need no cleanup. The runtime gate blocks both editing and
generation while cleanup is incomplete.

From repository root, with writers stopped and root `.env` targeting the copied
database:

```bash
bun run visuals:cleanup
bun run visuals:cleanup --apply
bun run visuals:cleanup
```

The first command is read-only and skips schema migration and fixture bootstrap.
Apply adds any pending schema migrations, cleans library rows transactionally,
then cleans each project under its version lock. Only a fully successful pass
opens the release barrier. An interrupted pass resumes without repeating cleaned
versions. The final dry-run must report zero changes.

Reports contain `changedProjects`, `changedTemplates`, `removedClips`,
`removedLayers` and `removedTemplates`. They contain no private clip text or media
URLs. Unknown IDs, unsupported composition versions or invalid surviving layers
stop cleanup for repair. Cleanup removes retired clips without ripple and keeps
surviving layer starts and the original span. It deletes no media objects.

Focused disposable-database proof:

```bash
cd packages/db
bun test tests/unit/visual-cleanup.bun.test.ts
```

## Running one service at a time

`bun run dev` waits for each required service before reporting app ready. Video
Studio and other individual services remain explicit commands:

```bash
bun run web            # web client on :3030
bun run api            # HTTP API
bun run media-worker   # media generation worker
bun run video          # Remotion Studio
bun run render-worker  # Remotion render server (:8091), reached by MALEO_VIDEO_URL
```

Production web (`bun run --cwd apps/web start`) builds the HTML entry with Bun
code splitting and the existing Tailwind plugin at startup. Template inspection
loads its optional chunk when entering Pipelines & Tools; development keeps
the runtime HTML bundler. `bun run --cwd apps/web smoke:prod` checks production
startup and PWA assets. For connected template inspection against a throwaway
database, run `cd apps/api && MALEO_TEST_TEMPLATE_BROWSER=1 bun test src/routes/agent-templates.bun.test.ts`; it owns web port 3034 and uses synthetic owner sessions.

`bun run dev` starts the installed local Inngest CLI. When
`MALEO_GEN_WORKER_URL` is set, it also starts media worker and registers its
generation function. If a service fails, the command stops the stack and names
the repair step.

### Local media processing

Install FFmpeg and ffprobe on PATH (`brew install ffmpeg` on macOS or your
distribution's FFmpeg package). Import probes and playback conversion run in
existing media worker, with one processing job at a time. Set
`MALEO_GEN_WORKER_URL` on API, and `MALEO_API_URL` plus matching
`MALEO_SERVICE_TOKEN` on worker/API. Provider generation remains independent.

`GET /health` on worker reports `processing.available`, a repair reason when
unavailable, and effective limits. `GET /processing/readiness` requires service
authentication. Missing binaries return processing unavailable, not ready media.
Defaults: 500 MiB/file, 50 files/batch, two uploads, ten minutes processing,
30-minute source, 3840×2160 decoded frame (either orientation), 2 GiB job scratch.
Failed or cancelled processing never registers ready media. `GEN_WORKER_DB`
holds durable jobs; `CACHE_DIR` holds disposable per-job scratch.

Source-edit worker jobs use the same durable processing queue. API
`POST /api/operations/projects/:id/media/processing` accepts managed source ID,
revision, request key and validated selected-range reverse or audio operation. Audio supports 0.25x–4x rate, explicit pitch preservation, and reverse for admitted video/audio sources. It refuses
unadmitted or changed sources; worker source access checks admission again before
publishing. Reverse buffers short frame chunks and reverses audio, with PCM chunk
concatenation before final AAC encoding. Poll/cancel stay project scoped. Worker
and API readiness alone do not establish editor or export support; those need
the matching preview, persistence and browser/render proofs in OpenSpec.

### Editable caption execution

Whisper runs on media worker. Install FFmpeg, Git, Make and a C++ compiler there;
newer configured runtimes can also require CMake. From repository root, run
`bun run --cwd apps/media-worker captions:setup`, then `bun run media-worker`.
Settings setup/status reach that host through `MALEO_GEN_WORKER_URL` and matching
`MALEO_SERVICE_TOKEN`; API needs no local Whisper files. Worker defaults remain
whisper.cpp 1.5.5 / base. Configure model/runtime directories on worker and retain
them across restarts. Use `MALEO_CAPTION_TRANSCRIBE=1` on worker for automatic
generated-narration alignment. Explicit imported-source jobs do not require it.

Check worker `/health`, then service-authenticated
`GET /processing/readiness?kind=captions` and `/speech/status`. Readiness checks
required files and FFmpeg; it does not establish recognition quality. Script-free
imported recognition retains recognized wording. Narration can supply script
assistance; the worker caches audio-local timing, and API applies placement
offsets after lookup. No API-local inference fallback exists.

Caption jobs share durable processing storage and Inngest dispatch. They fetch
only API-authorized managed sources, mix audible placements with shared
production gain/duck/fade functions, and return candidates without saving a
storyboard. Limits: 15-minute scope, 32 sources, 512 KiB request, one active job
per project, 1 GiB input, 2 GiB scratch, 30-minute deadline retained across retries.
Cancel kills owned child processes and removes per-run scratch. API endpoint
payloads and conflict handling live in [API.md](../apps/api/docs/API.md).

### Sandbox video generation

Video generation uses the same media worker and Inngest generation function as
image and speech. With FFmpeg/ffprobe installed on worker, select **Sandbox**
under God Mode's Video capability. Selection uses the existing
`PUT /api/capabilities/video/provider` endpoint. No `MALEO_SANDBOX` flag or
Fal credential is required for sandbox video. Unselected sandbox never serves
as an automatic fallback.

Worker accepts service-authenticated `POST /video` and returns a job ID polled
through `GET /jobs/:id`. API must send a token matching worker's
`MALEO_SERVICE_TOKEN`; `MALEO_GEN_WORKER_TOKEN` overrides the API's service
token for worker calls. `/health` reports per-provider video readiness from the
worker host. Video output is managed media, not publicly served cache files.

Sandbox produces a moving labelled MP4, exactly four seconds at 30 fps without
audio. Source metadata stays four seconds; clip placement can be shorter but
cannot extend past the source. Clip thumbnails display the generated video's
first frame, including after reload; scene images are not used as video posters.
Older oversized generated clips are capped on reload. Sandbox usage is recorded at zero
cost and zero charged credits.

Existing Fal video uses the same worker path. Configure `FAL_KEY` and optionally
`FAL_I2V_MODEL` through provider settings or root environment. Fal needs externally
reachable object storage for its source image. Deploy matching API, web, and
worker versions when adding video jobs and metadata.

## Restarting the stack

```bash
bun run restart            # stop this repo's dev processes, then `bun run dev`
bun run restart --dry-run  # list what would be stopped, and stop nothing
```

`--hot` reload does not survive every edit — a changed module graph or a route
added after boot leaves a half-reloaded server reporting failures the code no
longer contains. `bun run restart` clears that in one command.

It stops a process only when that process's working directory is inside this
repository, so another project sitting on 3000 or 3030 is left alone. A process
whose working directory cannot be read is never signalled. Use `--dry-run` to
see the list first.

> **Avoid `bun run --filter <pkg> <script> <args>`.** Bun's filter drops
> positional arguments after the script name. The root scripts above `cd` into
> the package and run Bun directly, so arguments pass through.

## Running the deployment stack locally

`bun run dev` with `.bin/inngest dev` is the normal loop. To exercise the real
containers, run the self-host file with the local override, which also publishes
the media worker and Inngest on loopback:

```bash
docker compose --env-file .env \
  -f deploy/docker-compose.yml \
  -f deploy/docker-compose.local.yml -p maleo up -d
docker compose -p maleo ps          # all services healthy
curl -s localhost:8090/health
```

Stop the dev servers on 3030/8090 first, or they take the ports.

The stack publishes the S3 API on `127.0.0.1:9000`. Use that for
`MALEO_MEDIA_S3_PUBLIC_ENDPOINT` when the browser runs on this host, and set
`MALEO_MEDIA_CORS_ORIGIN` to the web origin (`http://127.0.0.1:3030`). The
opt-in storage suites run against it:

```bash
MALEO_MEDIA_TEST_ENDPOINT=http://127.0.0.1:9000 \
MALEO_MEDIA_TEST_BUCKET=maleo-media \
MALEO_MEDIA_TEST_ACCESS_KEY=... MALEO_MEDIA_TEST_SECRET_KEY=... \
bun test --preload ../../scripts/test-db-guard.ts src/storage.minio.bun.test.ts   # in packages/storage
```

## Verifying a change

```bash
bun run check  # fast: version, references, vp check (format, lint, type-aware), workspace tsc
bun run ci     # full CI: all checks, Rust engine, tests, browser visuals
```

| Command                             | Kind             | What it runs                                                     |
| ----------------------------------- | ---------------- | ---------------------------------------------------------------- |
| `bunx vp check`                     | Vite+ built-in   | static checks only: format, lint, type-aware lint and type check |
| `bunx vp test`                      | Vite+ built-in   | every Vitest suite (portable tests), no coverage                 |
| `bun run test` / `bunx vp run test` | root script      | Vitest with coverage, then the Bun suites (`*.bun.test.ts`)      |
| `bun run --cwd <ws> test:bun`       | workspace script | that workspace's Bun suites                                      |
| `bun run ci` / `bunx vp run ci`     | root script      | the complete gate CI runs                                        |

`vp test` is the built-in runner and ignores `package.json`; `vp run test`
runs the `test` script. The same holds for `vp dev` against the Bun service
scripts (`bun run api`, `bun run web`): the services are started by those
scripts, not by `vp dev`.

`ci` installs Chromium if needed. Linux also needs Playwright's browser system
dependencies (`bun run --cwd apps/web playwright install --with-deps chromium`).
Run focused work with `bunx vp run --filter @maleo/api typecheck`,
`bun run --cwd apps/api test src/lib/global-secrets.test.ts`, or
`bun run --cwd apps/web test src/api/client.test.ts`. Tests use temporary
database and media state even when root `.env` points at local runtime data.

`bun run test` runs every Vitest suite once with coverage
(`MALEO_COVERAGE=1 vp test run --coverage`), then the Bun suites
(`*.bun.test.ts`, `test:bun`). Coverage covers Vitest suites only, over two
groups: `packages/shared/src/editor/*.ts` (branch floor 88%) and
`packages/shared/src/credits.ts` (77%); a file in a group that no test imports
counts as uncovered, and a group under its floor fails the run. The floors are
the measured baseline in `vite.config.ts`: raise them when tests land, never
lower them to pass. Bun suites, Playwright and the Rust engine are not part of
that number. Under coverage the editor engine's per-call time budget is not
asserted (instrumentation slows every call); `bunx vp test` without coverage
asserts it.
Lint and format through the pinned local Vite+ CLI. `bunx vp check` checks
formatting, lint rules (including type-aware ones) and type-check diagnostics
across the repository and never edits files; `bunx vp lint <paths>` lints only. `bunx vp lint --fix <paths>` applies safe
autofixes and `bunx vp fmt <paths>` formats; both rewrite files, so review the
diff before staging it. `bunx vp fmt --check <paths>` checks formatting only.
Rule selection and the sample behind each disposition live in
`oxlint.config.ts`.
`vp run` caches nothing (`run.cache: false` in `vite.config.ts`); tests and
live services always run. `bun run dev` builds
the editor engine's WASM before the web starts, so it needs rustup (below).

### Commit hooks

`bun install` runs `vp config --no-agent` (the root `prepare` script), which
installs the Vite+ hook dispatcher: it sets `core.hooksPath` to the generated,
self-ignoring `.vite-hooks/_` and runs the tracked `.vite-hooks/pre-commit`.
That hook runs `vp staged`, which checks the staged paths with `vp check` under
the same policy as CI (`staged` in `vite.config.ts`). It never edits a file: on
a failure the commit stops, and `bunx vp check --fix <paths>` is the explicit,
review-before-staging fix. Type checking of the whole program and the tests run
in `bun run ci`, which CI runs whether or not hooks are installed.

```bash
bunx vp hooks status    # preference, core.hooksPath, dispatcher, project hooks
bunx vp hooks enable    # install or repair the dispatcher; clears a disable
bunx vp hooks disable   # turn hooks off in this clone; installs stop re-adding them
VP_GIT_HOOKS=0 git commit …   # skip hooks for one command
```

Setup leaves an existing hook owner alone: if `core.hooksPath` already points
anywhere else (Husky, a custom directory, or an explicit `.git/hooks`), install
prints `core.hooksPath is already set …, skipping` and `vp hooks enable` will
not override it either. To switch, `git config --unset core.hooksPath`, then
`bunx vp hooks enable`. Setup outside a Git checkout (the Docker build) does
nothing and succeeds.

### The Rust editor engine

`crates/editor-core` owns editor command execution, inverses, edit policies and
time evaluation (OpenSpec `migrate-editor-to-shared-rust-core`);
`crates/editor-wasm` is its WebAssembly boundary. Web and API execute through
the same module. The toolchain and `wasm32-unknown-unknown` target are pinned in `rust-toolchain.toml`
and installed by rustup (`brew install rustup` on macOS, then
`rustup toolchain install` from the repo root). Homebrew's `rust` builds the
native crates but has no wasm32 standard library.

```bash
bun run check:rust                      # fmt, clippy, cargo tests, stale TS types, WASM build
cargo test --workspace                  # native engine tests only
bun scripts/editor-engine.mts build     # release WASM → target/wasm32-unknown-unknown/release/
UPDATE_ENGINE_TYPES=1 cargo test -p maleo-editor-core --features typescript   # regenerate engine-types.generated.ts
bunx vp test run --project scripts editor-engine   # size and per-edit budgets
```

Parity between native Rust and the WASM build in Bun and Chromium, plus the
frozen TS execution reference, runs in `apps/api/src/lib/editor-engine-wasm.test.ts` and
`apps/web/visual/engine-wasm.spec.ts`. To refresh the real-project corpus those
use, run `bun --env-file .env scripts/export-editor-corpus.ts` against a
development database; it sanitizes every string it writes.

**The engine is the editor's executor.** Every edit, undo and redo in the web
editor runs through it (`packages/shared/src/editor/engine-executor.ts`), and the
content timeline's drags and trims ask its edit policies for each projection
(`apps/web/src/models/editor-engine/policy-gesture.ts`). The editor route
fetches `/editor-engine.wasm` before it mounts the editor, so run
`bun scripts/editor-engine.mts build` first (the Docker image and the browser
suites build it themselves); without it the editor says it could not start.

Temporary preview readiness also uses this module. `media_open` creates an
independent handle. `media_dispatch(handle, ptr, len)` accepts JSON actions:
`update` with `dependencies`, `complete` with `request` and `completion`,
`retry` with `sourceId`, `invalidate` with the current `request` and `message`,
or `snapshot`. It returns
`{accepted, snapshot, requests}` through the existing output buffer and status
convention. `media_close` disposes the handle. These calls do not edit documents
or undo history. `crates/media/README.md` owns the source readiness contract.
The boundary has no renderer dependency. Normal preview and diagnostic compare
resolve completed sources locally without changing authored/export URLs.

The source-download adapter runs in `/preview-media-worker.js`, independently of
renderer WASM. It uses temporary OPFS files under `preview-media/<session-id>/`.
The memory backend has a 64 MiB total compressed-byte ceiling shared by all media
workers in the tab when OPFS is unavailable. The main-thread reservation ledger
accounts for complete and in-progress files; borrowed Files add no duplicate charge.
Quota failure blocks source completion. Pending-upload File leases do not copy
or delete upload staging. Disposing the adapter aborts outstanding downloads,
waits for their cleanup and removes only its own temporary session directory.
The timeline scopes ownership by workspace and project. Switching scope or
unmounting revokes preview-owned object URLs, aborts downloads, waits for codec
probes and closes the native readiness handle. Sign-out waits for all live media
sessions before navigating. Late replies cannot restore readiness. Ready siblings
survive Retry and dependency changes. Explicit local-source invalidation requires
Retry; it does not silently stream the remote original.

Stored Files retain the response MIME type. SVG bytes use a distinct worker
reply and remain validating until a serialized DOM image probe completes on
the main thread. The probe rasterizes one pixel for initial decode, closes its
bitmap and revokes its temporary URL. Cancellation closes the DOM image before
disposal completes. Normal preview retains the original SVG File and its vector
scaling. Renderer-worker SVG rasterization remains outside the diagnostic
renderer's existing image capability.

Timeline clips show native preview readiness independently of upload state.
Desktop clip menus and phone clip actions expose the full state and **Retry
preview** for failed sources. Retry keeps completed siblings and updates every
clip sharing that source. These notifications do not write the document or undo
history. Compact clips retain their named status icon and existing hit geometry.

The common playback command rejects starts until native readiness is complete.
Keyboard commands, replay and imperative Player calls use the same gate.
Blocked starts retain no autoplay intent. Editing and paused seeking remain
available. Changing required media pauses normal and compare output and requires
a fresh Play. Template Studio uses the same complete-source owner for resolved
audio cues. Its preview substitutes local URLs without changing saved templates.

OPFS sessions hold exclusive Web Locks named `maleo-preview-media:<session-id>`.
Opening a session reclaims other preview directories only when their ownership
lock can be acquired without waiting. Active tabs/workers retain their files.
Worker crashes release locks; a later session can remove the abandoned directory.
Without Web Locks, automatic orphan reclamation is skipped because absence of an
owner cannot be proved. Upload-staging directories are never traversed or removed.
Reload starts with fresh byte/codec validation; readiness is never persisted.

Common Play gating and per-clip loading controls remain in the later groups of
OpenSpec change `p2-media-playback`.

Normal source probes acquire video/audio slots through the same editor WASM:
`decoder_open`, `decoder_request(owner, request, kind, slots)`, `decoder_grants`,
`decoder_should_yield(owner, lease)`, `decoder_release(owner, lease)` and
`decoder_close`. Kinds are 1 for video and 2
for audio. Rust grants at most two slots of each kind across all source workers
in the tab. The main thread only routes grants. A worker returns a slot after its
finite probe iterator closes the codec; termination releases that owner's slots.
The hidden renderer module also exports `MediaPool` for decoded-frame cache and
reservation policy. It needs no GPU initialization and is not imported by normal
preview. `crates/media/README.md` defines ownership and portable accounting.

The local video adapter creates `/preview-video-worker.js` only after a native
decoder grant. Each logical placement has one active request and one replaceable
latest request. Complete Files and validated track metadata cross the boundary;
the decoder receives no source URL. Samples match pinned production Remotion:
truncate requested stream ticks, select the nearest presentation timestamp, and
choose the later frame on a tie. Do not subtract the first track timestamp.
Before a nonzero first timestamp, production holds the first frame. Cache
`start`/`end` describe selection windows; `presentation` retains the original
sample interval. A fresh seek can return a narrower valid cache window when
the previous sample timestamp is not available. Seeks reset the iterator
and reject older generations. Shared sources can have independent placements.
Transparent WebM needs both video slots for its color and alpha decoders.
Waiting owners trigger a yield after the active request finishes.

Before copying RGBA, the worker reserves both canvas and ImageData bytes through
the native pool. It clears the canvas before transferring the output. Disposal
closes samples and hidden library codecs before returning decoder slots.
`packages/video/scripts/probe-video-selection.ts` measures encoded frame IDs in
the production image. The browser decoder probe checks those recorded IDs,
including CFR/VFR, boundary ties, nonzero timestamps and source rates.

Portable audio contracts live in `crates/media/src/audio.rs`. The renderer's
`audio_requests::project` uses the production render storyboard, including its
resolved derivatives and native-audio suppression. It does not use draft export
rows. `bun scripts/audio-mix-fixtures.ts --check` checks TS-derived gain and
document/render fixtures against the Rust tests. `crates/media/src/pcm.rs` mixes
bounded interleaved float windows at the requested mono/stereo output rate.
Float headroom stays unclipped until final device output. Missing PCM reports
buffering instead of inserting silence. The renderer WASM exposes `PcmBudget`
and `mix_audio` without GPU initialization.

`audio-client.ts` decodes complete local Files through `/preview-audio-worker.js`.
It acquires the shared native audio grant before constructing a worker. Each job
reserves PCM before copying, terminates its worker before returning the grant,
and retains the PCM reservation until consumer release detaches the buffer.
Retained, flattened and WASM input copies share the 16 MiB budget. Callers must
reserve output copies separately. Requested PCM windows stay within two seconds.
Codec-internal surfaces are separate process-memory measurements. The real
browser probe is `preview-audio-decode.spec.ts`.

`audio-tempo.ts` wraps pinned `@soundtouchjs/core` 2.1.1 `Stretch` for global
transport speed only. Authored rates, pitch settings and reverse stay on their
validated processed derivatives. At 1x it bypasses time stretching. Fixed FIFO
capacity, overlap state and tail padding are reserved before allocation through
the same PCM budget. Backpressure bounds queued output to two seconds. Reset
clears input, output and overlap state before changing speed. Finish flushes the
upstream tail and returns exactly the selected input-frame count divided by
global rate. Disposal detaches owned FIFOs and returns the reservation.
`preview-audio-tempo.spec.ts` captures actual Rust-mixed browser output at
0.5x/1x/2x, checks pitch, exact output length and cleanup. Its AudioBuffer capture
does not establish production AudioWorklet scheduling or physical-device sound.
`createAudioOutput` creates/resumes AudioContext from the main-thread Play
gesture, then loads `/preview-audio-worklet.js`. Rust-mixed, tempo-processed
stereo blocks transfer to its bounded queue. Accepted transfers detach producer
buffers. Consumed or flushed block acknowledgements return PCM reservations.
Underruns hold the consumed position. Flush and platform suspension invalidate
old generations. Disposal closes output before releasing retained reservations.
The real worklet probe is `preview-audio-output.spec.ts`; compare ownership and
editor transport integration remain separate tasks.

For audio adapter work, use `crates/media/README.md` for the ownership and output
position contract. Worklet `frames` counts consumed stereo frame pairs within
one generation. Its `renderFrame` records their endpoint on AudioContext's
sample clock. The running browser probe checks that endpoint against the last
captured sample. Silence inside a valid block counts. Underflow silence does
not count, and seeking resets the counter only after invalidating the queue.

`timestamp()` returns context/performance times, an initialized platform output
timestamp pair when available, and separate reported latency estimates. Missing
fields are explicit `null`. Map the render-frame endpoint back to audible sample
position using the README formula. If output timestamps are unavailable, use a
calibrated latency estimate. The sum of valid reported base/output latency is
the platform estimate; missing latency is not zero. Keep that estimation method
in acceptance evidence. The output counter, rather than host time, supplies the
clock input for both audible material and intentional narration gaps.
The pinned MediaBunny 1.45.0 patch corrects CPU alpha merging: `copyTo` uses the
visible rectangle, so output dimensions must exclude decoder padding. The patch
also preserves the color space. Its browser regression checks numbered pixels
in transparent VP9 frames. Remove the patch only after equivalent upstream code
passes that probe.

Compare preview sends validated local File bindings through the existing preview
protocol. Every storyboard carries an input generation and a readiness revision
from the complete placed-source inventory, including muted and hidden clips.
Readiness updates carry a source generation and increasing sequence. Rust rejects
Play until readiness succeeds. Completion never starts playback automatically.
Buffering and stalled states hold position. Seek and buffering invalidate the
old audio observations until a fresh output anchor arrives. Malformed inputs keep
the accepted storyboard and position. Replies identify both the accepted input
generation and the request they answer, so a refused replacement cannot strand
commands on an unaccepted generation. The browser worker probe is
`preview-media-state.spec.ts`.

The compare worker prefetches the next video frame without binding it to the
current placement. During image or gap spans, it warms the first upcoming video
within two seconds so decoder startup does not wait for that clip's entrance.
A missing current frame holds playback and Rust-owned audio.
Local decode retries use the reference transport's 1.5-second threshold and at
most two attempts. Device loss holds the native clock immediately. Device
recreation has two attempts with 1.5-second timeouts, and late devices cannot
replace an accepted one or report another loss. Pause cancels playback intent.

`compare-audio.ts` joins the existing output adapter to the preview worker. It
prepares scripts without creating an AudioContext. Play primes bounded local
blocks, then attaches their consumed-sample clock. Frame observations continue
while another decode is pending. Seek flushes and replaces the output generation.
Media invalidation pauses without queuing autoplay. GPU or local buffering can
resume only under the same active intent. Suspension requires a fresh gesture.
Decoder recovery failure closes output and leaves a named paused/stalled state.
`preview-audio-session.spec.ts` exercises this boundary with actual Files, video,
worklet capture, GPU loss and real context suspension. Product ownership controls
and physical synchronization acceptance remain separate tasks.

The renderer worker owns one native `MediaPool` for visible images and
video intervals. Two image jobs run independently of the two video slots. Video
workers borrow those Files; the main thread routes global editor-WASM grants
without moving RGBA through React. One RGBA buffer per native cache ID backs all
placement bindings. The worker reserves temporary copies, uploads to WASM, then
detaches the JS ArrayBuffer before converting its reservation into cached bytes.
Opaque codec/bitmap surfaces remain separate process-memory measurements.

Compare startup retains its video decoder script as a local blob before it
reports readiness, including projects whose first video starts later.
Later seeks, worker replacement and cache misses need no remote source or script
fetch. Source removal and sign-out wait for consumer acknowledgements before
deleting temporary bytes. Worker errors terminate owned execution before native
decoder ownership is returned. Missing requested video intervals keep placeholders
and exact placement paths in coverage. Video support remains marked unfinished
until production golden parity is accepted.

Rust generates the command vocabulary and scope structure in
`engine-types.generated.ts`; TS refines opaque payloads with the existing domain
schemas. There is no TS command executor. Shared `execute`/`applyCommand`/
`invertCommand` helpers use the engine provided by their host: the web loader,
the API entrypoint (lazy first use), or the test preload. Direct callers outside
those hosts must call `provideEditorEngine` first. Non-JSON inputs such as `NaN`
are refused without committing.

Caption clips extend `schemaVersion: 2` with `type: "caption"`. Their authored
text, cue-local words, source bindings, provenance and protection live in
`clip.caption`. `doc.captionSet` holds explicit initialization, language,
protected deletion ranges and applied-run identities. Global appearance remains
in `doc.captions`. `packages/shared/src/caption-cues.ts` owns ingress validation;
Rust generates the structural types and validates admission without rebuilding
the JSON payload. Shared family views derive captions from the canonical clips.
Caption initialization is explicit: stored voiceover words never seed a set.
New generation and SRT import provide provenance directly.

Preview and production render project authored cues through
`renderCaptionClips`; voiceover words never supply a fallback. Cue intervals
are half-open, authored line breaks stay fixed, and cue style overrides merge
over global appearance. Hidden tracks and disabled cues produce no output.
Enabled cues that need refresh block export with a refresh-or-disable recovery.
Fast draft uses the same cue text and intervals with plain canvas text; its
menu discloses omitted caption styling and animation. SRT exports authored
intervals and line breaks without regrouping or requiring a voiceover track.
Production render accepts imported-video timelines with no authored scenes;
empty timelines still fail validation. Caption recognition clamps browser codec
tails up to 50 ms to admitted media duration, without extending source access.

`caption.edit` executes caption changes in Rust: create, correction, timing,
split/merge, deletion, style/reset, unlink and result application. Commands own
cue/set revisions and edit protection. Caption-only restore commands provide
exact undo without transferring unrelated clips. Result application records run
identity atomically and leaves existing cues intact for no-speech results.

Rust source commands reconcile bound cues once after the complete transaction.
Original media intervals map moves, retained windows, split halves, constant
rates and duplicates; source deletion removes exclusively linked cues. Mixed
source cues follow a uniform move, while partial moves and changed audible
contributions require refresh. Replacement and reversal retain authored text
with that status. Affected locks refuse the complete edit. Standalone cues
stay independent; unlink explicitly removes bindings. Agent fingerprints carry
source dependencies so a later caption deletion also fences a source edit.

Regeneration captures only affected cues, original-source bindings, deletion
protection and audible source state. Results hold when that evidence changes;
unrelated edits and visual-only transforms remain applicable. Protected text,
timing and segmentation stay authored. Style-only overrides transfer to fresh
candidates; deleted ranges suppress overlapping candidates even after source
moves or splits. Explicit replacement clears protection only inside its scope.
No-speech results preserve the document, and run identity prevents repeat apply.

Agent snapshots carry live cue clips and set metadata together. Saves preserve
newer editor caption state, including explicit empty sets. Version writes can
provide `expectedRevisionId`, checked under the existing project version lock;
a stale write raises `StoryboardRevisionConflict` before inserting or pruning.
The editor save route reports these races as HTTP 409.
Caption-owning HTTP writes also compare `expectedCaptionState` with the last
saved caption fingerprint, including global style. Exact undo can restore an
older edit revision without becoming a stale save. Autosave and export use one
serialized editor writer; stale concurrent caption payloads remain fenced.

Deploy matching API, web and WASM builds when documents contain caption clips.
Older engines reject the added clip type, and older readers can discard it.
Roll back to a caption-aware build or explicitly restore a prior storyboard
version before using an older build.

An edit-only agent run saves its commands onto the latest revision. The
`agentEdit` marker prevents replay on server retries and editor reloads; clips
changed since the run's base are held as conflicts. Resumed video runs skip
live preview because their snapshot predates intervening saves.

Connected proof uses disposable Postgres, real cookie/API-key authentication,
MCP approval flows and a production web bundle at desktop and 320px:

```bash
bun --no-env-file apps/web/scripts/prove-editor-rust.ts
```

For rollback, stop the current web/API processes before starting the previously
verified application build with its matching WASM artifact. Keep a backup of the
latest revision, then restore a compatible preserved storyboard through the
normal version writer. This change retains `schemaVersion: 2`, legacy seconds,
unknown clip fields and asset identities, so no format conversion is needed.
The engine preserves passthrough fields in its admitted scope; the host storyboard
reader/writer still owns fields outside that scope.
Never run the prior TS executor and Rust as concurrent writers.

### The Rust renderer

`crates/renderer` draws video frames from the render storyboard with parley
and vello on wgpu, and is held at parity with Remotion by a golden corpus
(`crates/renderer/AGENTS.md`). Remotion stays the only preview and export
renderer.

```bash
cargo test -p maleo-renderer                         # unit tests and the golden parity gate
MALEO_GOLDEN_SCORES=1 cargo test -p maleo-renderer --test golden -- --nocapture   # every score
WGPU_BACKEND=vulkan cargo test -p maleo-renderer      # on Mesa lavapipe, as CI runs it
bun scripts/build-renderer-wasm.ts                   # browser module and preview worker → target/renderer-wasm/
cargo test -p maleo-preview                          # preview session: clock, scheduler, states
```

The gate renders every case in `crates/renderer/corpus/` and compares it with
its Remotion reference by SSIM; a failing frame leaves the Rust frame and a
difference image in `target/golden/`. References are rendered in the
production image by `packages/video/scripts/render-golden.ts`; the command is
in `crates/renderer/AGENTS.md`. The browser module needs the `wasm-bindgen`
CLI at the crate's version: `cargo install wasm-bindgen-cli --version 0.2.129 --locked`.

**Compare mode.** Open a project with `?renderer=compare`
(`/content/<id>?renderer=compare`) to see the Rust frame beside the Remotion
Player at the same playhead, with the frame time (last, p50, p95) and the
elements the renderer does not draw yet. It needs a browser with WebGPU and a
built module; without WebGPU the panel says so and the preview works as usual.
Without the parameter the editor never requests the module.

Reference audio is selected by default. Use **Compare audio output** to select
**Rust audio**. Rust mutes the reference Player before starting its worklet.
Its clock follows consumed audio and output timestamps. Selecting Rust while
paused waits for Play. Selecting reference or leaving compare mode closes Rust
output before restoring the reference Player's previous mute state. Audio
suspension requires a fresh Play or **Retry audio**. This diagnostic choice does
not change the document or export inputs.

The compare renderer includes keyed layout/plain text, camera motion, local
color correction, crop/flips, rectangle/ellipse masks and feather, supported
blends, reveals, placement-specific transitions, timeline effects and scene
decorations. Coverage still reports video media, visual templates and unbundled
fonts. This does not switch normal preview or export away from Remotion.

Option evidence lives in `corpus/manifest.json`; golden cases retain full-frame
and region SSIM plus the two-pixel edge limit. Approved low-contrast cases can
delegate geometry to a matching high-contrast companion with a recorded reason.
Original SSIM checks remain. Grain's fixed SVG tile is rasterized in the pinned
production browser; its recipe is `crates/renderer/assets/README.md`.

Component stories run in Storybook: `bun run --cwd apps/web storybook` (port 6006) or `build-storybook`. Conventions are in `apps/web/stories/README.md`.

## The agent in development

Development runs the same agent as production; only the model differs. Point
the API text provider (Settings, or the root `.env`) at something cheap: a
smaller hosted model, or a local Ollama:

```bash
MALEO_AI_API_BASE_URL=http://127.0.0.1:11434/v1
MALEO_AI_API_KEY=ollama            # any non-empty value
MALEO_AI_API_MODELS=qwen2.5:7b     # then select it in Settings
```

Pick a model that calls tools: `qwen2.5:7b` builds and edits; `llama3.2` (3B)
tends to answer in prose and change nothing. Agent runs need the Inngest dev
server (`bun run dev` starts it).

Tests never call a model: the runtime suites drive the real agent with a
scripted model (`modules/agents/core/runtime/__tests__/support/`). The opt-in
live tests reach real services — `MALEO_LIVE_PROVIDER_TESTS=1` for a model,
`MALEO_LIVE_DURABLE_TESTS=1` for the Inngest host.

To drive projects from a terminal, connect Codex CLI or Claude Code as an MCP
client: create a key in **Account → MCP** and run the setup it shows, against
`http://127.0.0.1:3030/api/mcp`.

## Runtime data

The runtime database is Postgres. Production points `MALEO_DATABASE_URL` at it;
development leaves that unset and gets an embedded server whose cluster lives
under `data/postgres` (port `MALEO_PG_PORT`, default 54329). Workspace
configuration is stored in the database, not in files.

Other shared runtime state lives under `data/`, resolved through
`MALEO_DATA_DIR`:

- `data/postgres/` — the embedded development cluster
- `data/skills/*.yaml` — the runtime skill library

### Upgrading from 0.1.0 (SQLite)

The runtime no longer uses SQLite. Release 0.1.0 kept everything in
`data/maleo.db`, with workspace configuration in
`data/workspaces/<name>/config.yaml`. Carry them over once:

1. Stop the api and workers, and back up `data/maleo.db` and `data/workspaces/`.
2. Point `MALEO_DATABASE_URL` at an empty Postgres database, or leave it unset
   for the embedded one.
3. `bun run db:migrate-from-sqlite`. Add `--source <path>` to read a file other
   than `MALEO_DB_PATH`. The command migrates the target, copies every table,
   and prints the source and target row count for each one. It stops, naming
   the table, row and column, on a value Postgres cannot hold as it is. It also
   stops, naming the file, on a `config.yaml` that is missing, unparseable,
   invalid, or holds a credential. Fix the cause and run it again: an
   interrupted or failed run resumes without duplicating rows.
4. Run the visual cleanup dry-run and apply described at the start of this
   document. The carry preserves historical content and clears visual-contract
   readiness; the API remains blocked until cleanup succeeds.
5. Start the api. It seeds the shipped library fixtures on first start.

Local development selects `MALEO_MEDIA_STORAGE_BACKEND=local` and keeps new
media under `data/media/`. Production requires S3-compatible object storage.
See [Self-hosting](self-hosting.md) for the deployment stack, including the
object store, migration, backup, and rollback. Generated media from older releases stays on
its original disk until migration verification completes.

Never commit secrets, local database snapshots, or generated media.

## The master key

Credentials you enter in God Mode → Providers are encrypted before they are stored. The key
that encrypts them is created for you the first time you save one, and kept at
`data/master.key` (owner-only, and gitignored).

**Back that file up.** It is deliberately the one thing a database dump does not
contain — which is what makes the dump safe to copy, and what makes the key
unrecoverable if it is lost. Without it, stored credentials cannot be read and
each one has to be entered again.

**Rotating.** God Mode → Security & Storage offers regenerating the key. Secrets are encrypted under an
internal data key which is itself wrapped by the master key, so rotation rewrites
one row and re-encrypts nothing — no provider needs configuring again. Both the
old and new key open the store until the app next starts with the new one, so a
restart mid-rotation loses nothing. Until that restart, God Mode keeps reporting
the rotation as unconfirmed.

A deployment sets the key in its environment instead; see
[Master key](self-hosting.md#master-key).

Native source-edit render checks run with `bun run --cwd packages/video test` and full CI. They require local FFmpeg/ffprobe and Remotion browser support; numbered video frames, source-color quadrants, audible impulses and tone/gain fixtures verify crop, flips, reverse and processed audio retiming against production output. The checks use temporary synthetic sources, not runtime project data.

## Workflow definitions and prompt templates

Video planning is a workflow definition run by the engine
(`apps/api/src/modules/agents/core/engine/`), and its prompts are templates
(`apps/api/src/lib/prompts/templates/`). Both are validated when the API loads:
an unknown operation, rule, fact, prompt, template, constant or formatter fails
boot. Prompt changes are pinned byte for byte by
`cd apps/api && bun test src/modules/agents/core/planning-prompt-parity.bun.test.ts`
and parser behavior by `parser-acceptance.bun.test.ts`; re-capture their fixtures only
for an intended change. There is no generated source to refresh.

For a synthetic planning/restart exercise without paid providers, run
`cd apps/api && bun test src/modules/agents/core/runtime/__tests__/integration/planning-baseline.bun.test.ts`.
Current framework snapshots are serialized and restored into a fresh Mastra store;
product state reloads from throwaway Postgres. Tests cover pre/post-research waits,
replacement approval, settled outcome replay and checkpoint-save failure. The
baseline allows unsaved preparation to repeat after a failed save; inspection
adds no exactly-once guarantee. Run connected template inspection with
`cd apps/api && MALEO_TEST_TEMPLATE_BROWSER=1 bun test src/routes/agent-templates.bun.test.ts`.
It owns a temporary authenticated API and production web on port 3034, exercises
desktop and coarse-pointer phone navigation, and releases both. Do not run paid
shadow planning or reset development state for this cutover.
