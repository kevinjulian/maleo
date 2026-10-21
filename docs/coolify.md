# Deploy on Coolify

The core stack deploys as one Coolify **Docker Compose** resource built from
`deploy/docker-compose.coolify.yml`. What the stack runs and what each variable
means is in [Self-hosting](self-hosting.md); this guide covers only the Coolify
steps.

## 1. Create the resource

**New Resource → Docker Compose**, from this repository:

| Field                   | Value                         |
| ----------------------- | ----------------------------- |
| Base Directory          | `/deploy`                     |
| Docker Compose Location | `/docker-compose.coolify.yml` |

The compose file builds every image from the repository root (`context: ..`),
so nothing else needs setting. With auto-deploy on, set the watch paths to the
root `Dockerfile`, `.dockerignore`, `package.json`, `bun.lock`, `deploy/**`,
`apps/web/**`, `apps/api/**`, `apps/media-worker/**`, `apps/render-worker/**`
and `packages/**`.

## 2. Set the variables

Set every variable listed under [Environment](self-hosting.md#environment)
except `MALEO_BIND_ADDRESS`, which only the self-host file reads. The compose
file refuses to start on a missing one rather than defaulting it.

Keep **Build time** and **Runtime** enabled for variables referenced by
`${...}` in this Git-based Compose application. Coolify must supply their values
while it renders Compose during the build. A saved runtime-only value does not
satisfy that interpolation and can still cause a missing-variable failure.
Verify Compose with the saved build-visible values before declaring the
environment ready. `MALEO_MEDIA_S3_ENDPOINT` is fixed inside this Compose file,
so its separate saved entry does not need build availability.

Existing resources must add `MALEO_VIDEO_TOKEN` before deploying video export
support. API and render worker receive this same token from Compose. Keep
render worker internal; it needs no domain. Check host headroom for its 2 CPU,
4 GiB memory and 1 GiB shared-memory limits.

## 3. Set the domains

The first deploy generates a `*.sslip.io` hostname per routed service. Replace
them under the resource's **Domains** — one field per service — and redeploy:

- `web` and `api` each get a domain. `MALEO_WEB_PUBLIC_URL` and
  `MALEO_API_PUBLIC_URL` must name the same domains.
- `rustfs` gets a domain for presigned browser reads only, named by
  `MALEO_MEDIA_S3_PUBLIC_ENDPOINT`. See
  [Why it is in the stack](self-hosting.md#why-it-is-in-the-stack).

The domain must be set in that field. A service is routed only because the
compose file declares `SERVICE_FQDN_<SERVICE>_<PORT>` for it, and Coolify keeps
the domain it stored for that declaration: setting the variable as an
environment variable instead does nothing, and the hostname answers 503 while
every container reports healthy.

Whoever changes a domain also updates `MALEO_API_PUBLIC_URL`,
`MALEO_WEB_PUBLIC_URL`, `MALEO_MEDIA_CORS_ORIGIN`, and the media endpoints to
match. They are the origin allowlist, and a mismatch reads as a broken sign-in
rather than as a configuration error.

Leave every other service unpublished — `inngest` above all, because it has no
authentication of its own.

## 4. Deploy

Deploy, then wait for the one-shot services (`db-carry`, `rustfs-init`,
`inngest-sync`) to exit 0 and every long-running service to report healthy.
For access afterwards — the Inngest dashboard, backups, a forgotten password —
see [Self-hosting](self-hosting.md).

Verify video export through authenticated editor, including managed video/audio,
MP4 download and playback, then job/artifact access after worker recreation.
See [Video export](self-hosting.md#video-export) for persistent volumes and
rollback. Healthy containers alone do not establish export success.
