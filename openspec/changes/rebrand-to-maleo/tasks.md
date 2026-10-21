# Tasks

## 1. Data-preservation contract before runtime rename

- [x] 1.1 Capture a synthetic pre-cutover fixture with stored plain/branded secret keys, a single envelope wrapping, sealed workspace value, and owned record IDs. Record hashes for all eight SQL migrations and inventory all 12 workspace manifests. Verify fixture reads through existing configuration and secret-store APIs without accessing local runtime data.
- [x] 1.2 Add explicit offline state conversion and focused tests before renaming runtime readers. Convert only branded setting keys and envelope fingerprint metadata in one transaction, preserving ciphertext and master-key value. Verify conflict, wrong/missing key, malformed envelope, pending/multiple wrappings, no-envelope state, repeat execution, and mixed-state failures with isolated databases and no secret output.
- [x] 1.3 Document converter invocation, stopped-service and backup preconditions, pending-rotation recovery in the prior release, and backup-based rollback in the owning development/self-hosting docs. Verify the documented conversion and retry against synthetic state. Keep old-name conversion definitions outside normal runtime entrypoints and bundles.

## 2. Workspace and build identity

- [x] 2.1 Rename root and private package identities, imports, dependency declarations, task filters, aliases, fixtures, and lockfile entries to Maleo without dependency upgrades. Verify `bun install --frozen-lockfile`, unchanged 12-workspace coverage, and relevant workspace typechecks.
- [x] 2.2 Rename Rust crate/module identifiers and WASM artifact references in Cargo manifests, root `Dockerfile` build/copy/optimization steps, local build scripts, engine loaders, parity tools, tests, and lockfiles. Verify `bun run check:rust` and browser engine loading from a fresh renamed artifact without using old output paths.
- [x] 2.3 Update workspace maps and contributor commands in current owning docs with the new names. Verify representative focused package commands pass their positional arguments and `bun run check:references` passes.

## 3. Runtime configuration and state boundaries

- [x] 3.1 Rename first-party environment reads, stored-setting consumers, root env template, root Dockerfile environment defaults, setup/dev scripts, worker launchers, test preloads, and configuration tests to `MALEO_*`. Rename fingerprint domain to Maleo. Verify converted task 1 fixture resolves identical settings, provider secrets, and sealed workspace values; test obsolete-only environment values have no effect and new values retain precedence.
- [x] 3.2 Rename first-party symbols, browser globals, branded storage keys, logs, download/output defaults, MCP client snippets, and service registration values. Update consumers and fixtures together. Verify editor persistence under the new key and distinct API/media durable registrations with focused tests.
- [x] 3.3 Rename embedded database/role defaults and database-facing helpers without changing schema ownership or record IDs. Verify fresh embedded startup, existing converted installation access, and unchanged migration hashes using disposable clusters.
- [x] 3.4 Issue `maleo_` API keys and remove old-prefix runtime compatibility. Test creation, authentication, authorization boundaries, and old-key rejection after explicit invalidation. Document key replacement and updated MCP client configuration without printing secrets.
- [x] 3.5 Complete local cutover/rollback docs with concrete database/role conversion and browser-layout reset behavior. Rehearse combined conversion on disposable state and record record counts, media references, unchanged ciphertext/checksums, and credential decryption proof.

## 4. Deployment identity and cutover

- [x] 4.1 Rename branded service names, databases, volumes, image references, registrations, and deployment environment keys in both compose variants and their checks. Verify compose rendering with dummy values and `bun run check:deploy` parity, including all 12 Dockerfile workspace-manifest copies.
- [x] 4.2 Update self-hosting/Coolify docs and deployment records to distinguish desired new names from observed live resource IDs. Supply explicit volume/database conversion, durable-job drain, secret preservation, and rollback instructions. Rehearse resource reuse against disposable copies without modifying production; identify actual image build/run checks that remain unperformed.

## 5. Logo, application, and PWA

- [x] 5.1 Commit supplied logo source under web static assets and derive favicon, 180px Apple touch, 192/512px ordinary, and padded maskable PNG assets. Record source and every derived asset path in `THIRD_PARTY_NOTICES.md` without inventing third-party ownership. Verify dimensions, actual favicon readability, circle/squircle/rounded-square masks, and `bun run check:release-hygiene`.
- [x] 5.2 Replace app title, sidebar name/initial, breadcrumb identity, and other active product labels. Add logo to existing navigation and auth surfaces using approved design-system owners. Update stories/tests and drive desktop, mobile drawer, sign-in, and editor surfaces in a browser, checking accessible labels and unchanged editor geometry.
- [x] 5.3 Update manifest names and icon entries, HTML icon links, static asset routes, MIME checks, and production smoke assertions. Retain manifest identity paths. Verify bundled and stable URLs return images, manifest resolves all assets, and `bun run --cwd apps/web smoke:prod` boots the production browser with registered service worker.
- [x] 5.4 Add logo to README with a relative committed path and update static asset ownership docs. Verify README asset resolves from checkout. Record fresh-install and existing-install acceptance separately; identify any physical-device icon refresh proof that remains unperformed.

## 6. Repository and current documentation

- [x] 6.1 Resolve exact Maleo repository target from current ownership and operator intent before publishing actionable links. Update issue templates, security/contribution links, release titles, and repository/image metadata locally. Verify consistent targets and clearly record remote operations as unperformed; do not create/rename/push a remote repository.
- [x] 6.2 Update active guidance, current specs, API/tool descriptions, examples, and first-party ownership text to Maleo. Preserve released changelog entries, historical decisions, archived changes, and upstream legal attributions. Add `Unreleased` entry documenting breaking configuration, explicit offline conversion, and key cutover. Verify `bun run check:version` and `bun run check:references`.
- [x] 6.3 Extend the appropriate existing repository hygiene check to detect former identity across active source/config/docs/filenames and first-party build output. Keep exceptions narrow for historical records, identified cutover docs, offline conversion definitions, and explicit negative fixtures. Add regression tests proving these exceptions cannot exempt runtime code or hide bundle references.

## 7. Integrated acceptance

- [x] 7.1 Run `bun run typecheck`, relevant workspace tests, root tests, and full `bun run ci` after coordinated changes. Record exact results and any baseline/environment failures separately; confirm renamed task filters do not skip any of the 12 packages.
- [x] 7.2 Start the renamed stack against converted isolated data using only `MALEO_*`. Exercise sign-in, existing project read/edit, shared WASM commands, media delivery, credential reads, and durable generation dispatch. Record runtime and browser evidence without claiming external provider or physical-device behavior not exercised.
- [x] 7.3 Audit active source, filenames, current docs, emitted first-party metadata, and served app/PWA surfaces for old identity. Run `openspec validate rebrand-to-maleo --strict` and review every acceptance scenario against recorded proof. Leave external repository/deployment operations and any unperformed device checks explicit in closeout.

- [x] 7.4 Move playback integration tests from the hooks layer to `components/editor/transport-playback.test.tsx`, updating only the hook import. Preserve every assertion. Verify the focused suite and `bun run --cwd apps/web check:layers` pass. This baseline repair was explicitly approved during implementation.

- [x] 7.5 Diagnose and fix the reproducible Motion Studio transport playback failure approved during closeout. Preserve the playback contract and verify focused browser coverage before rerunning integrated gates.

- [x] 7.6 Update saved Coolify names and repository settings for core and four supported infrastructure applications after operator authorization. Pause core auto-deploy until production state conversion is ready. Verify live readback, health, unchanged resource UUIDs, domains and build paths. Record environment/state cutover and new-repository contents as deployment prerequisites; do not deploy during configuration staging.

- [x] 7.7 Complete authorized local cutover after checkout directory rename: back up stopped Postgres, root environment and master key; convert existing embedded database/role and stored settings without runtime aliases; verify preserved records, credential reads and successful restart from the new path. Keep production untouched.

- [x] 7.8 Fill the authorized Coolify production environment from existing production values. Resolve duplicate storage credentials through read-only authentication, preserve master key and third-party settings, align public origins with configured domains, verify every destination before removing obsolete production keys, and keep disabled preview configuration unchanged. Record readback in `evidence/coolify-environment.json`; retain the production cutover pause.

- [x] 7.9 Correct the Compose build-variable scope failure exposed by deployment logs. Reproduce missing variables using only saved build-visible values, enable build availability for the 16 referenced Maleo variables without changing values or preview scope, and verify actual-value Compose rendering passes. Record correction in `evidence/coolify-environment.json` and the owning Coolify guide without triggering production cutover.
