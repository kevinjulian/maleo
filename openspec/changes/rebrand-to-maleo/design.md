# Design

## Context

See proposal.md for motivation. Current identity crosses multiple execution boundaries:

- `apps/web/src/app/index.html` has the old title and links `apps/web/static/icon.svg` through relative bundle inputs.
- `apps/web/static/manifest.webmanifest` currently declares one SVG for both `any` and `maskable` purposes. There is no Apple touch icon link.
- `apps/web/static/README.md` documents explicit static routes before the SPA catch-all. `apps/web/scripts/smoke-prod.ts` checks those routes and browser startup.
- `apps/web/src/components/shell/app-sidebar.tsx` renders the name and collapsed initial. `apps/web/src/app/app.tsx` supplies a branded breadcrumb. Authentication currently has no product logo.
- Private workspace identities and Rust/WASM names appear in manifests, imports, task filters, build scripts, and engine loaders.
- `packages/db/src/db/connection.ts` uses branded embedded database and role credentials. Compose also names persistent databases and volumes.
- `packages/auth/src/config.ts` issues API keys with the former prefix. Keys are hashed and shown once.
- `apps/web/src/models/timeline/editor-pane-shares.ts` stores geometry under a branded key. Theme and sidebar preferences use unbranded keys.
- `packages/inngest/src/client.ts` and deployment configuration carry distinct API and media-worker app identities.
- `packages/db/src/db/config-resolution.ts` derives persisted setting names from environment names. Both `config.AINCER_*` and `secret.AINCER_*` rows require conversion.
- `packages/db/src/db/secret-crypto.ts` hashes `aincer:master-key-fingerprint:v1` with the master key. `secret-store.ts` matches that fingerprint before decrypting its envelope.
- `packages/db/src/db/migrate.ts` rejects changed migration checksums. All eight existing SQL migrations contain no old brand and require no edits.
- Root `Dockerfile` builds and copies the WASM artifact separately from workspace installation. It copies all 12 workspace manifests before frozen installation.
- `scripts/check-release-hygiene.ts` requires an asset provenance entry for each newly tracked logo or derived icon.

The supplied RGB logo is 1254 by 1254 pixels, with an opaque black background. Artwork reaches the image boundary.

## Goals / Non-Goals

**Goals:** Complete one coordinated identity change, preserve owned data, and prove a clean checkout and production bundle work with only Maleo identifiers.

**Non-Goals:** New product features, a visual redesign, a domain move, dependency upgrades, Git history rewriting, a version bump, and remote infrastructure changes during code implementation.

## Decisions

### One canonical namespace, no compatibility layer

Use `Maleo` for display text, `maleo` for machine names, `@maleo/*` for private packages, and `MALEO_*` for first-party environment variables. Use `maleo-editor-core`, `maleo-editor-wasm`, and their corresponding Rust module and WASM artifact names. Rename first-party branded symbols, browser globals, output names, and default registrations consistently.

Update consumers together rather than adding alias packages or environment translation at runtime. Keep third-party variable names such as `INNGEST_APP_ID`; change first-party values such as `maleo` and `maleo-media`. Keep API routes, schema structure, document IDs, and media ownership unchanged unless a name is itself branded.

Alternative rejected: staged aliases or dual variable reads. User explicitly requires no fallback.

### Separate source logo from derived installation assets

Commit the supplied PNG under the web-owned static asset tree with a Maleo filename. README references it relatively. Preserve the source artwork and black background. Generate deterministic resized assets through available local raster tooling without AI redesign or a new runtime dependency.

Use PNG output for installation assets, with separate padded maskable output. Keep the entire supplied image inside the maskable safe circle. Inspect circle, rounded-square, and squircle previews. Check favicon legibility at actual tab sizes. Do not invent vector artwork from the PNG.

Use existing shell and auth composition owners for logo placement. Follow design-system contracts during apply. Preserve editor sizing and unrelated palette tokens. Update static routes, MIME checks, HTML links, and static asset documentation together. Relative HTML links must continue to resolve through Bun's bundler.

Alternative rejected: declare the unpadded supplied image as both ordinary and maskable output. Boundary artwork would be clipped.

### Explicit cutover replaces runtime fallback

Document environment conversion as an operator action before starting the new release. Preserve secret values, including the master key. Do not mutate the user's local `.env`, database, volume, or cloud configuration as part of source edits.

Provide concrete conversion instructions for embedded Postgres role/database names and persistent resource names. Rehearse these instructions on disposable copies. Reuse data through explicit moves or verified backup/restore, rather than allowing renamed resources to start empty. Preserve object keys and media URLs unless an explicit migration maps them.

Browser layout preferences can reset under the new key. Document this limited reset instead of reading the old key in shipped code. Unbranded theme and sidebar keys remain unchanged.

Issue new `maleo_` API keys and update clients. Stored hashes cannot produce equivalent renamed secrets. Invalidate former-prefix keys during explicit cutover and verify rejection. Preserve accounts and provider credentials. Drain durable jobs before changing API/media registrations; do not leave competing registrations or silently discard running work.

Alternative rejected: blanket replacement inside runtime data. It could corrupt secrets, user content, or media references.

### Convert persisted settings and the envelope before runtime reads

Provide one operator-invoked offline conversion command. Run it against explicitly selected stopped-installation state using the existing master-key value. Do not invoke it automatically from application startup or import it into normal runtime code. Former identifiers in this tool are migration input definitions, not runtime aliases. Keep these definitions out of first-party runtime bundles.

Require a backup and reject writes while services can access the target. Before mutation, validate every destination setting key. If both old and new keys exist, stop without modifying either value. Convert only keys matching `config.AINCER_*` or `secret.AINCER_*`; leave user-authored values, unbranded provider names, and ciphertext bytes unchanged. Reject unsupported source layouts rather than guessing a mapping.

For an existing envelope, require exactly one wrapping and no pending rotation. The operator must finish or abandon pending rotation through the prior release before cutover. Verify the supplied master key matches the old fingerprint and successfully unwraps the data key. Calculate the new fingerprint using `maleo:master-key-fingerprint:v1`; update only envelope fingerprint metadata. Keep wrapped data key, secret ciphertext, master key, and encryption format unchanged. Verify stored provider secrets and sealed workspace values remain readable. An envelope-free installation without encrypted values needs no fingerprint conversion. Encrypted values without a valid envelope are an error.

Apply key renames and envelope metadata conversion in one database transaction. Wrong or missing key, malformed envelope, destination conflicts, or unsupported rotation state must leave the database unchanged. A second run over fully converted state verifies it and makes no changes. Mixed or ambiguous state fails without deleting either version. Report counts and status only, never key material, decrypted values, or connection credentials.

Preserve all eight existing SQL migration files and their recorded checksums. Use the explicit conversion operation rather than editing historical migration content or adding startup fallback reads. Database/role renaming remains an external administrative step before application boot. Rehearse rollback by restoring the pre-cutover backup, not by running mixed-brand readers against converted state.

Before changing runtime readers, capture synthetic pre-cutover settings, envelope, sealed workspace value, and owned-record identifiers. Land conversion tests first. Once runtime uses only Maleo names, prove the converted fixture resolves the same values. Include negative cases for collision, wrong key, pending rotation, malformed envelope, and retry. Never use real provider credentials or local runtime data as fixtures.

Alternative rejected: change the fingerprint string without converting envelope metadata. The same key can still decrypt the ciphertext, but runtime rejects it before decryption.

### Check active identity without rewriting history

Reuse the repository's existing reference/release hygiene checks where their ownership fits. Scan active first-party source, manifests, filenames, current docs, tests, first-party generated artifacts, and build metadata case-insensitively. Define narrow historical exclusions rather than excluding all documentation or all OpenSpec.

Historical references in this change explain migration. Archived changes, released changelog entries, accepted decision history, upstream notices, and user content retain their factual text. Allow former names only in identified cutover instructions, offline conversion input definitions, and negative test fixtures. Test that these exceptions cannot hide an old name in runtime code. Current operational examples and current requirement text use Maleo. No arbitrary new dependency is needed.

Alternative rejected: replacing every string in every tracked file, including historical and third-party legal records.

### Repository identity is prepared locally

Use `maleo` as the intended repository slug. Retain the current owner unless the operator chooses another target. Resolve the exact target before changing externally actionable links; never claim a remote repository exists without verification. Keep repo creation/rename, push, and production deployment outside source implementation. Update release titles, templates, and repository links together once target is confirmed.

## Risks / Trade-offs

- Renamed filters may omit workspaces -> assert workspace coverage and run full CI from a locked install.
- Stale WASM outputs may hide loader failures -> rebuild from renamed crates and exercise browser editor commands.
- Renamed database or volume may appear empty -> rehearse cutover on copied state and compare records and media access.
- Renamed fingerprints or setting keys may hide intact credentials -> transact offline conversion and verify provider and workspace-secret reads with the same master key.
- Partial rotation may retain inaccessible wrappings -> reject it before any writes and require completion or abandonment in the prior release.
- Existing API clients lose access -> replace keys and verify new acceptance and old rejection before declaring cutover ready.
- Installed icon refresh differs by device -> retain manifest identity on the same origin and report physical-device proof separately.
- Repository target may be unavailable -> keep remote changes separate and confirm target before publishing links.

## Migration Plan

1. Stop writes and drain durable work for production cutover. Back up database, media, and required secrets without committing them.
2. Complete or abandon pending master-key rotation in the prior release. Convert database/role and volume names using reviewed instructions. Verify restored records and keep the same master key.
3. Run offline conversion of persisted setting keys and envelope fingerprint against stopped state. Verify conversion and retry, then configure `MALEO_*` names and deploy the coordinated Maleo artifacts with rebuilt WASM and distinct API/media registrations.
4. Replace API keys, update clients, and invalidate old keys. Document editor layout reset.
5. Verify sign-in, existing project access, media delivery, credential decryption, generation dispatch, editor commands, and PWA metadata.
6. If cutover fails, stop the new stack and restore the prior artifact set, configuration, and backed-up resources. Do not run mixed-name services against live state.

Source implementation supplies and rehearses this procedure; it does not execute production cutover.

## Readiness Evidence

Read-only preflight on 2026-10-20 passed typecheck across 12 workspaces, lint, deployment parity, and release hygiene. The focused configuration-resolution and secret-store suites passed 46 tests. A synthetic cryptographic probe confirmed that changing the brand changes the fingerprint while the unchanged key still decrypts ciphertext. Eight existing SQL migrations contain no former-brand text.

Full CI stopped at formatting in this change's two delta specs. Correcting those files removes that known failure only; it does not establish full CI success. Re-run the required gates during implementation. The renamed build, converter, copied-state rehearsal, and installed-device icon refresh remain untested until their tasks land.
