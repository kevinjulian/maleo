# Self-hosting

## Maleo cutover

This release uses only `@maleo/*`, `MALEO_*`, `maleo_` API keys, and Maleo resource names. There are no runtime aliases.

1. Stop API, web, media worker, render worker, and any other clients of the runtime database. Drain durable runs before changing registrations. Finish or cancel paused agent runs too; prior snapshots cannot resume under the renamed agent registration. Finish or abandon pending master-key rotation through the prior release.
2. Back up Postgres, object storage, worker state, and the existing master key. Keep the prior image and configuration for rollback. Never commit backups or credentials.
3. Change environment names from `AINCER_*` to `MALEO_*`, preserving values. Preserve `BETTER_AUTH_SECRET`, service tokens, provider keys, and the master key. Unbranded third-party variables keep their names. A file-based key remains `data/master.key`; export that same value as `MALEO_MASTER_KEY` only for the offline command, without printing it.
4. Convert resource names before boot. For embedded Postgres, use the prior release's admin tools against the stopped installation to connect to database `postgres`, rename database `aincer` to `maleo`, rename role `aincer` to `maleo`, and set its local password to `maleo`. PostgreSQL clears MD5 passwords when a role is renamed; reset the password explicitly. Do not run `initdb` or create a new empty database. Keep the same `data/postgres` directory.
5. For managed Postgres, preserve the existing password while changing role/database names with administrative credentials. Update `MALEO_DATABASE_URL` accordingly. Run administrative SQL through a secure client, never interpolate secrets into a logged command.
6. Compose project/service/volume names now use `maleo`. With every writer stopped, copy each prior volume to its corresponding new volume using a disposable container, preserving numeric ownership and permissions. Verify database and media contents before starting services. Never use `down -v`. Include API data, Postgres, object store, media-worker state, and all render-worker data/output/public volumes. Keep original volumes for rollback. Inspect actual volume names with `docker volume ls`; project prefixes differ between plain Compose and Coolify.
7. Supply an explicit `MALEO_DATABASE_URL` and the unchanged `MALEO_MASTER_KEY` to the offline converter. It does not start or migrate the application database. Its connection must be the only database client. After confirming backups and stopped services, run:

   ```bash
   bun scripts/rebrand-state.ts --services-stopped --backup-confirmed
   ```

   Export values securely in the invoking shell, or load the converted root environment with `bun --env-file .env scripts/rebrand-state.ts --services-stopped --backup-confirmed`. The converter reads no old environment aliases. It changes only persisted `config.AINCER_*` / `secret.AINCER_*` keys and secret-envelope fingerprint metadata in one transaction. It preserves master key, ciphertext, stored IDs, and all existing SQL migration checksums. Wrong/missing key, conflicting or mixed setting names, malformed encryption, and pending/multiple wrappings stop conversion without writes. A repeated completed conversion makes no changes. Output contains counts only.

8. Start the coordinated Maleo release with distinct durable registrations `maleo` and `maleo-media`. Disable prior registrations. Verify account access, existing project IDs, media references, provider-secret readability, workspace-secret readability, editor operations, and worker dispatch before resuming writes.
9. Create replacement `maleo_` API keys in Settings, update MCP client snippets and client environment variables, then revoke previous keys. Old-prefix keys cannot authenticate to MCP. Brand-prefixed browser state, including active workspace selection and editor pane proportions, resets once under the new keys. Select your workspace again if needed. Server-side content remains intact; unbranded theme and sidebar preferences remain.

Rollback: stop the new services and restore prior images, environment, registrations, database backup, and volume mappings together. Do not point the previous runtime at partially converted state. Retain backups until project/media/credential checks pass.

Repository target is `kevinjulian/maleo`. Remote rename/create/push and production cutover are separate operator actions. Current recorded platform UUIDs identify observed resources; renamed labels in source do not prove live resources changed. Domain migration is outside this cutover. Existing installed PWA icon refresh requires device verification; remove and reinstall if the device retains its prior icon.

`deploy/docker-compose.yml` deploys the whole core as one Docker Compose
stack: web, API, media worker, render worker, the runtime Postgres and its backups, the
self-hosted Inngest server, and its Postgres and Redis. They ship together because Inngest invokes functions over HTTP and
every service must resolve the others by name.

The media store ships in this stack too, because its writes must not cross a
CDN — see **Media store** below. Hosted R2 or S3 replaces it by configuration.

On Coolify, use `deploy/docker-compose.coolify.yml` instead and follow
[Deploy on Coolify](coolify.md); everything below except **Run it** applies to
both.

## Run it

```bash
cp deploy/.env.example deploy/.env      # fill in every value; see Environment
docker compose --env-file deploy/.env -f deploy/docker-compose.yml -p maleo up -d
docker compose -p maleo ps             # wait for every service to be healthy
```

The one-shot services (`db-carry`, `rustfs-init`, `inngest-sync`) exit 0; the
rest report healthy. To update, `git pull` and rerun the command with
`up -d --build`, which rebuilds the image from the checkout.

`web` (3030), `api` (8090) and `rustfs` (9000) are published on
`MALEO_BIND_ADDRESS`, `127.0.0.1` by default. Put a TLS-terminating reverse
proxy in front of those three, one hostname each, and set
`MALEO_WEB_PUBLIC_URL`, `MALEO_API_PUBLIC_URL` and
`MALEO_MEDIA_S3_PUBLIC_ENDPOINT` to them. Publish nothing else — `inngest` has
no authentication of its own.

## Environment

The compose file refuses to start on a missing variable rather than defaulting
it.

```text
MALEO_SERVICE_TOKEN              worker -> API /internal/* authentication
MALEO_VIDEO_TOKEN                API -> render worker authentication
MALEO_MASTER_KEY                 wraps every stored provider credential
BETTER_AUTH_SECRET                signs operator sessions (hex, 32+ bytes)
MALEO_API_PUBLIC_URL             the API's own domain
MALEO_WEB_PUBLIC_URL             the web domain; session + media CORS origin
INNGEST_EVENT_KEY                 shared with the server
INNGEST_SIGNING_KEY               shared with the server — plain hex
INNGEST_PG_PASSWORD               durable state database
MALEO_PG_PASSWORD                the runtime database (maleo-postgres)
MALEO_DB_PATH                    optional; the pre-Postgres SQLite file db-carry
                                  moves once (defaults to /data/maleo.db)
INNGEST_BASE_URL                  optional; defaults to http://inngest:8288
INNGEST_RETENTION_DAYS            optional; defaults to 30
MALEO_MEDIA_S3_ENDPOINT          the media bucket, internal address
MALEO_MEDIA_S3_PUBLIC_ENDPOINT   the same bucket as the browser reaches it
MALEO_MEDIA_S3_BUCKET            e.g. maleo-media
MALEO_MEDIA_S3_ACCESS_KEY_ID     also the media server's admin key — see below
MALEO_MEDIA_S3_SECRET_ACCESS_KEY
MALEO_MEDIA_S3_REGION            optional; defaults to us-east-1
MALEO_MEDIA_CORS_ORIGIN          the exact web origin, scheme and port; never *
MALEO_GENERATION_CONCURRENCY_PER_KIND  optional; defaults to 3 here
MALEO_BIND_ADDRESS               self-host only; defaults to 127.0.0.1
```

`MALEO_API_PUBLIC_URL` and `MALEO_WEB_PUBLIC_URL` must name the domains the
platform serves `api` and `web` on, or sign-in fails the origin check.

Values never go in this repository. `deploy/.env.example` carries names only.

`MALEO_ALLOW_SIGNUP` is optional. When present it overrides God Mode's stored
registration policy: `1` opens self-registration, any other value closes it.
Without it, the instance owner chooses Open or Invitation only in
**God Mode → Authentication**. See [God Mode](god-mode.md) for access, account
succession, workspace deletion, and admin API safeguards.

The deployed image provider must be one that needs no browser: Cloudflare
Workers AI or Hugging Face. Gemini Canvas and BrowserOS drive a real browser
over CDP and cannot run in a container — they are development-only, which is why
`MALEO_GENERATION_CONCURRENCY_PER_KIND` defaults to 1 in code and is raised
here.

## Video export

The stack includes `render-worker` on internal port 8091. Set
`MALEO_VIDEO_TOKEN` before upgrading an existing installation. Compose gives
API and renderer the same token and sets API's worker URL to
`http://render-worker:8091`. Adding an environment variable in the platform
alone does not add a missing service; deploy the updated Compose file too.

Worker uses existing `MALEO_SERVICE_TOKEN` to fetch workspace-scoped managed
video/audio from API and existing S3 credentials to publish completed exports.
It needs no public domain or AWS Lambda configuration. Image includes matching
Chrome Headless Shell, Linux libraries, and fonts. Browser installation and
launch run during build, from `/app/apps/render-worker`.

Worker has one queue owner, one concurrent job, and one browser frame worker
per local render, limited to 2 CPUs, 4 GiB
memory and 1 GiB shared memory. Check host headroom before deployment. Named
volumes `maleo-render-data`, `maleo-render-out`, and `maleo-render-public`
preserve queue, manifests/output scratch, and preparation caches. Do not remove
these volumes during an update. Completed video bytes live in shared object
storage. Stop worker before backing up queue SQLite and its WAL files; no
automatic backup service covers these render volumes.

Verify a rollout with these checks:

1. Confirm deployed revision, required variable presence, storage access, and
   healthy worker/API. Never print tokens or storage credentials.
2. From authenticated editor, export a short project with managed video/audio.
   Wait for completion, download MP4, and check picture and sound. Worker
   `/health` checks queue/output access; it does not prove rendering works.
3. Recreate worker while preserving volumes. Confirm prior job and completed
   export remain accessible. Record revision and job ID in rollout evidence.

For rollback, deploy previous image and Compose revision while retaining
render volumes and shared object storage. Preserve any existing external render
queue before replacing its configured address. A rollback can restore previous
application behavior while leaving the original export outage unresolved.

## The AI text provider and the agent

Every text call and the chat agent run on an OpenAI-compatible API — OpenAI,
Anthropic, Gemini, OpenRouter, Groq, or a self-hosted Ollama or vLLM. Set it in
**God Mode → Providers → AI text**: the API key (stored in the data volume's
secrets file, never in the database), the base URL, and **Extra models** for
names beyond the built-in list (`MALEO_AI_API_MODELS`). Choose a model that
calls tools reliably: the agent builds and edits by calling tools, and a model
that answers in prose instead changes nothing. Without a key the stack starts,
and Settings reports text as unconfigured with the reason.

Agent runs execute on the Inngest server. While a run waits on an approval or a
question, its execution state is kept in the `mastra` schema of the runtime
database, created on first use and included in its backups. Every 15 minutes the
API abandons runs that have waited longer than 24 hours and deletes execution
state untouched for 48, so a deleted workspace's run data does not outlive it.

## MCP

Codex CLI, Claude Code and other MCP clients connect to
`https://<web domain>/api/mcp` with a personal key. Each user creates theirs in
**Account → MCP**, which also gives the setup for each client with the key in
it. A key reaches the projects of every workspace its owner belongs to, is
limited to 300 requests a minute, and stops working if the owner is suspended.
Clients read projects and research directly. They change a project either by
starting the agent (`run_agent`) or by calling one of the agent's own edit
tools directly (`add_scene`, `update_scene`, `generate_frame`, ...;
`get_project` lists those that apply). A direct edit runs as a one-tool run in
the project chat: it waits for approval before changing existing work, is
refused while another run is active, is charged like the agent's call, and is
traced to the key's owner.

The instance owner can also give a workspace's agent tools from external MCP
servers: `PUT /api/mcp-servers/<name>?workspace=<ws>` with `url`, `allow` (the
server's tool names the agent may call; nothing else is offered) and optional
`headers`, which are stored encrypted. `GET` lists them by header name only and
`DELETE` removes one. A server URL reaches whatever this deployment's network
reaches, which is why only the instance owner can set one.

## Master key

Stored provider credentials are encrypted under a master key. How it works
locally, backing up `data/master.key` and rotating it are in
[Local development](development.md#the-master-key).

**Deployments.** Set `MALEO_MASTER_KEY` in your platform's environment and it
takes precedence over the file — the right choice when the data directory is not
a persistent volume, because a key written to a container's disk disappears with
it. Generate one with:

```bash
bun run key:generate
```

If neither the environment nor a writable data directory can hold a key, storing
a credential fails and says so, rather than encrypting it under a key that will
not exist next time.

**The media worker.** Durable generation runs in its own process
(`apps/media-worker`) that does not hold the database. Give it `MALEO_API_URL`
and `MALEO_SERVICE_TOKEN` and it fetches resolved provider configuration from
the API, so what you set in God Mode → Providers reaches the process that actually generates.
Without them it reads its own environment. `MALEO_SERVICE_TOKEN` must
also be set on the API — that endpoint serves decrypted credentials, and with no
token configured it refuses every request rather than defaulting open.

Import processing uses the same worker and service credential. The shared root
Dockerfile installs and checks FFmpeg/ffprobe. Worker `/health` reports
`processing.available` separately from liveness; missing binaries refuse
processing with 503 while generation remains available. Constant-rate/pitch and audio-reverse jobs share this worker and require the same binaries; no separate audio service is needed. Reverse audio uses at most 30 seconds of stereo 48kHz PCM per chunk; managed source intervals, deadlines and scratch ceilings still apply. Sources are streamed
from service-authenticated project/import/revision endpoints on API; quarantine
objects stay outside ready media registry until processing succeeds.

Missing registered media bytes return `404` from local authenticated reads and worker source reads. Storage connection and permission failures remain errors; source replacement restores unavailable editor media without removing authored clip settings.

An import poll that cannot reach the worker keeps the import processing until
twice the processing deadline past its upload window, then marks it failed with
"Processing timed out; retry file"; a worker that no longer knows the job fails
it as interrupted. Only editors drive polling forward — read-only members see
stored state. Cancelling an import releases its quarantined original, and
cancelling a finished worker job drops its result, so `scripts/cleanup-media.ts`
collects those bytes on its next reachability pass after the usual grace period.

Every upload carries a client-minted media identity, a UUIDv7, as its request
key (`x-upload-id`); the server refuses any other key. An editor document
references a file still importing by its final URL `/api/media/<id>`, never as a
`blob:` or large `data:` URL: the project editor-state and storyboard save routes
refuse those with `local_media_url`, naming the field. Until the import finishes,
that URL answers a member with `409 media_pending`. `GET
/projects/:id/media/import/request/:requestKey` returns the import for one key
from stored state (read-only members included; it never advances the worker), so
a reopened editor can follow an unfinished import. Uploading
again with the same key reclaims a failed or cancelled attempt, or one whose
upload window expired, rather than creating a second import; a reclaimed attempt
may carry a file chosen again under another name, as long as it is the same kind.
The browser keeps a chosen file in its origin-private storage until the import is
ready, so a reload resumes the upload under the same key. Render preflight refuses a
document that still uses a pending file, naming it, before anything is enqueued,
and agent edits leave clips on pending files unchanged.

Processing has one Inngest slot, fixed subprocess arguments, bounded threads and
logs, a ten-minute deadline retained across retries, 30-minute source duration,
3840×2160 decoded frames in either orientation and 2 GiB per-job scratch.
Original bytes remain immutable. Imported duration bounds refer to verified
normalized playback, so authored
source ranges cannot include padding present only in the original container.
Worker result SQLite must survive replacement; scratch does not.
Keep `GEN_WORKER_DB` on durable volume and give `CACHE_DIR`
enough disposable space for those bounded jobs. Back up worker SQLite with API
database and object-store backups.

Compose mounts `maleo-media-worker` at `/data/media-worker`, with result store
`/data/media-worker/gen-worker.sqlite`; scratch remains `/tmp/maleo-media-worker`.
Before upgrading an existing deployment that used the old container-local
`apps/media-worker/data/gen-worker.sqlite`, stop worker writes and back up that
SQLite file (including its WAL/SHM sidecars when present). Copy the closed store
into new volume before replacing worker, then verify queued/completed jobs after
restart. Do not discard the old store while jobs still reference it.

Caption recognition runs on this worker too. The image builds whisper.cpp 1.5.5
into `/opt/whisper.cpp/main` (`MALEO_WHISPER_CPP_BIN`); to change the version,
change the `whisper` stage in the root `Dockerfile` and rebuild. Compose keeps the
Whisper model in `/data/media-worker/whisper.cpp` and recognition cache in
`/data/media-worker/caption-cache`. Download the model through Settings or run
`bun run --cwd apps/media-worker captions:setup` on the worker. Set
`MALEO_WHISPER_MODEL` there; default remains `base`. API reaches setup/status through the matching service token and
never runs local inference. Set `MALEO_CAPTION_TRANSCRIBE=1` on worker to align
new generated narration automatically.

Service-authenticated `/processing/readiness?kind=captions` reports required
runtime/model availability. `/speech/status` provides operator setup detail;
`/health` remains liveness plus FFmpeg processing readiness. Caption jobs allow
15-minute scope, 32 sources, 512 KiB requests, one active attempt per project,
1 GiB source bytes, 2 GiB scratch and a persisted 30-minute deadline. Poll/cancel
stay project scoped. Cancellation kills recognition/conversion processes and
removes per-run scratch. Completed jobs hold candidates only; editor must accept
them through its command stack. Back up worker result SQLite with existing
backups; models can be reinstalled and recognition cache can be regenerated.

**Not using it.** A deployment that configures everything through environment
variables needs no master key at all. Environment variables take precedence over
stored values, and God Mode → Security & Storage reports any stored value an environment variable is
currently overriding.

## Reaching the Inngest dashboard

Port 8288 is deliberately unpublished: it serves the dashboard and the event API
from one port and the server has no authentication of its own. Tunnel instead:

```bash
ssh -N -L 8288:localhost:8288 <host>
open http://127.0.0.1:8288
```

## Retention

`inngest-prune` runs `prune-history.sql` daily, deleting finished runs, their
history and traces, and events older than `INNGEST_RETENTION_DAYS` (30). Runs
still in flight or suspended awaiting an operator are never touched. The server
deletes nothing on its own and its tables slow down as they grow, so this is the
only bound on them.

## Media store

The stack runs [RustFS](https://rustfs.com) — an S3-compatible object server,
Apache-2.0 — with one private bucket on a persistent `rustfs-data` volume. API,
media worker, and video service all read and write through it; every one of
them checks bucket access at startup and refuses to listen if it is unavailable.

It replaced MinIO, whose community images were withdrawn: every
`quay.io/minio/minio` and `quay.io/minio/mc` tag, `:latest` included, now
answers `401 UNAUTHORIZED`, and Docker Hub has no `minio/minio` at all. The
application speaks plain S3, so R2, S3, or any other compatible service needs
only configuration changes.

### Why it is in the stack

The `rustfs` and `rustfs-init` services are defined in the compose file beside
the processes that write to them, and `rustfs-init` inlines its bucket-and-CORS
script. They are not a resource of their own: a separate resource is reachable
only by its public hostname, and a CDN in front of an S3 API breaks writes —
`CreateBucket` through Cloudflare fails with `MissingContentLength`, and so
would every upload.

So the API and the worker write to `http://rustfs:9000` internally
(`MALEO_MEDIA_S3_ENDPOINT`), and the public domain for the `rustfs` service,
named by `MALEO_MEDIA_S3_PUBLIC_ENDPOINT`, serves only the presigned GETs a
browser follows. It must be a TLS hostname that resolves from the operator's
machine.

Do not put an identity proxy (Cloudflare Access and friends) in front of it:
presigned URLs are fetched by the operator's browser and by external generation
providers, and neither can pass an interactive challenge.

`rustfs-init` runs on every deploy: it creates the bucket if absent and applies
the CORS rule. Both steps are idempotent, so a redeploy is a no-op against an
initialized server. Wait for it to exit 0 before media-writing services start.

### The credentials administer the server

RustFS 1.0 exposes a single access key and has no policy engine, so the
credentials the application uses are also the administrative credentials. MinIO
allowed a bucket-scoped application user underneath a separate root user; this
does not. The blast radius of a leaked key is the whole store rather than one
bucket. Hosted storage (R2, S3) is the path to narrower scoping when that
matters — it is a configuration change, not a code change.

Nothing else is published: the S3 API is `expose`d to the stack's network only,
and the console is not enabled at all.

### CORS lives on the bucket

The origin allowlist is bucket CORS, applied through the S3 API by
`rustfs-init`. Range headers (`Content-Range`, `Accept-Ranges`) are exposed
because the player seeks — without them a cross-origin seek silently restarts
from the beginning.

MinIO's community build did not implement `PutBucketCors`, which is why the
previous stack carried a server-wide origin variable instead.

## Resetting a password

The deployment sends no email, so there is no self-service reset. From a
terminal in the `api` container:

```bash
bun scripts/reset-password.ts <email>
```

It reads the new password (12 characters or more) from stdin, so it stays out
of shell history, and clears the sign-in rate-limit counts. Locally, the same
command is `bun run auth:reset-password <email>`.

## Backup and restore

### Runtime database

`maleo-db-backup` writes a `pg_dump -Fc` of the runtime database to the
`maleo-pgbackups` volume once a day and keeps the newest fourteen. To restore,
from a shell in that container:

```bash
pg_restore -h maleo-postgres -U maleo --clean --if-exists -d maleo /backups/<file>.dump
```

To check a dump without touching the live database, create a scratch database
(`CREATE DATABASE restore_check`), restore into it, and compare the table counts.
The dumps sit on the same host as the database, so copy them off it.

### Media

The bucket lives on the `rustfs-data` volume. Back it up with the object store's
own protocol rather than by copying the volume under a running server:

```bash
# backup
aws --endpoint-url https://<media-host> s3 sync s3://<bucket> ./media-backup
# restore into a fresh stack, after rustfs-init has created the bucket
aws --endpoint-url https://<media-host> s3 sync ./media-backup s3://<bucket>
```

A volume-level snapshot is only safe with the server stopped. Keep at least one
copy off the host: the volume and the host fail together.

## Upgrading to the internal agent runtime

The release that moved the chat to the internal agent removed the Codex CLI and
Claude CLI text providers.

1. Before upgrading, configure the API text provider (above). A stored selection
   of `codex` or `claude` fails by name until another provider is chosen.
2. Deploy. The previous agent's Inngest function is no longer served. A run it
   left waiting for an answer cannot continue: answering ends it with an
   explanation, and **Resume** starts the instruction again on the new agent. A
   run it left mid-flight goes stale, is marked interrupted, and resumes the
   same way.
3. To roll back, deploy the previous images. Runs started on the new agent stay
   as errored records that the previous release can resume.

## Upgrading from 0.1.0 (SQLite)

The runtime no longer uses SQLite. The first deploy after 0.1.0 carries the
SQLite database at `MALEO_DB_PATH` into `maleo-postgres` through the one-shot `db-carry` service,
before the API starts, and then writes `/data/.postgres-carried`. Every later
deploy sees the marker and copies nothing. If the carry stops, it names the
table, row and column, or the workspace file. The API stays down rather than
serving an empty database. Fix the cause and redeploy; the carry resumes without
duplicating rows. Stop the stack before that first deploy, so that nothing
writes to the SQLite file while it is being copied. Keep the file until the
deployment is verified: to roll back, deploy the previous release, which reads
it.
