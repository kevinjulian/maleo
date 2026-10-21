# Implementation evidence

All checks below use synthetic state or repository source. Local `.env`, runtime database, credentials, and production resources were not changed. Remote repository target `kevinjulian/maleo` was confirmed by the operator; remote creation/rename/push remains unperformed.

- Frozen Bun installation succeeded without dependency upgrades. All 12 workspace names map exactly to the new namespace. `baseline.json` records original workspace inventory and the unchanged SHA-256 hashes of all eight SQL migrations.
- State conversion suite: 16 tests passed. It verifies atomic conversion, ciphertext and real project/storyboard preservation, provider and sealed-value reads, wrong/missing key, collision, mixed state, pending/multiple wrapping, malformed/corrupt input, idempotent retry, obsolete-only environment rejection, documented CLI invocation, and administrative database/role conversion with unchanged SQL migration bookkeeping.
- Rust gate passed: formatting, Clippy, native tests, TypeScript generation check and rebuilt `maleo_editor_wasm.optimized.wasm`.
- MCP integration: 19 tests passed, including new prefix rejection, account/workspace authorization, real key creation, explicit key invalidation, edits and synthetic generation.
- Setup fixture regression passed after overlaying current tracked changes onto its archived snapshot. This exercises renamed imports/manifests together and preserves repeat-run data.
- Both compose variants rendered 14 services with synthetic environment values. `check:deploy` passed with distinct `maleo`/`maleo-media` registrations and all 12 manifest copies.
- Disposable Docker volume copy preserved synthetic media bytes and numeric ownership/mode `1234:1234:640`. Both temporary volumes were removed; see `volume-rehearsal.json`. Production volume migration and full application image build/run were not performed.
- Production smoke passed: browser rendered, manifest names and bundled/stable PNG links resolved with correct MIME types, installation assets existed, and service worker registered.
- Focused browser run passed 7 tests: desktop collapse/reload and phone drawer navigation/focus, branded 320px sign-in form, and zero clipped artwork pixels under circle, squircle and rounded-square masks.
- Release-hygiene regression suite passed 7 tests, including runtime references adjacent to migration exceptions and emitted JavaScript detection. Repository release-hygiene gate passed.

Physical-device installation and existing home-screen icon refresh were not tested. Connected converted-state proof passed with real API, production web, media worker and local Inngest. It verified preserved project identity, stored credentials, unchanged managed-media bytes, account access, Maleo MCP key, desktop/phone editor, durable edit dispatch and durable image generation using the explicitly selected local sandbox provider. No external provider was called. The final full CI command passed after the approved playback repair, as recorded below.

- Policy reference: all 8,040 current gesture traces matched prior digests after reversing only the branded error prefix. Reference digests were then updated for the new prefix; focused policy suite passed without a semantic change.

- Final focused converter suite passed 16 tests, including real workspace MCP header decryption and corrupt-workspace-header rollback. Production smoke also scanned served first-party JavaScript/CSS for the former identity and passed.
- Full CI passed all 4,395 portable tests and its Bun suites, then stopped on the pre-existing hook-test upward import identified by `check:layers`. Operator approved moving that unchanged test into the editor component layer; only its hook import changes.
- Reviewed and updated four account/MCP screenshots for the new client command, environment name and API-key prefix. Layout remains the same; the shorter name changes command/text wrapping. Account behavior checks passed all 15 tests against these baselines.

- God Mode header now uses the supplied bird logo. Seven focused browser checks passed, including God Mode reachability and the three reviewed Security/Authentication screenshots. Their existing General navigation row was already present in committed source; it was stale in those baselines. The first seven screenshot baselines changed across MCP and God Mode; the later full run identified 13 more.

Playback test placement repair: focused suite passed 14/14 tests. Web layer check passed with 199 cross-cluster imports. The move changed only the hook import.

Full visual run exposed 13 additional 1024px admin/settings baselines. Each diff was inspected. Raw RGB comparison verified zero changed pixels outside the 248px sidebar. The diffs show the new logo/name and an existing navigation row absent from stale baselines. Updated those 13 baselines; 20 total screenshots changed. No runtime layout change was needed.

Final acceptance audit:

- Product identity: sign-in, main navigation, collapsed rail, God Mode, README, document title and current operational docs use Maleo. Source logo is byte-identical to the supplied file.
- Technical identity: all 12 workspace names match the new namespace; frozen install, TypeScript, Rust/WASM, runtime configuration and deployment registration checks passed. Negative environment and credential tests prove no runtime aliases.
- Owned state: converted isolated records, ciphertext, provider values, workspace headers and managed media remained readable and unchanged. All eight migration hashes match the baseline. Conversion failure cases roll back and completed conversion retries make no changes.
- Repository history: archived changes, accepted decisions and released changelog sections remain unchanged. Current release-hygiene and emitted-bundle checks detect former identity with narrow migration exceptions.
- PWA: manifest names, retained `/` identity paths, ordinary and maskable PNGs, favicon, Apple touch asset, MIME responses and service-worker registration passed production smoke. Mask checks clipped zero artwork pixels. Physical-device refresh remains untested.
- External operations: repository target is `kevinjulian/maleo`; no remote rename, creation, push, live resource migration, application Docker image build/run or deployment occurred.

The first full browser run completed with 790 passed and 14 failed: 13 reviewed stale sidebar screenshots plus one unchanged Motion Studio fixed-wait playback assertion. The final full CI run uses the reviewed baselines; the playback test and production playback code remain unchanged.

Earlier full CI attempt: static checks, all-workspace typecheck, Rust, deploy, identity, 4,396 portable tests (one skip), 2,279 Bun integration tests, web layers and census passed. Browser suite finished 803 passed and one failed in 12.9 minutes. All 13 updated admin baselines passed. Remaining failure is `studio-parity.spec.ts:402`, Motion Studio timecode remaining at zero after its fixed 1.2-second wait. A focused unchanged-test run reproduced the failure. The playhead hook, shared preview and test source are unchanged; Motion Studio imports changed only package namespace. Playback repair exceeds the approved placement-only move. The operator subsequently approved playback repair, recorded below.

Playback repair approved and implemented: browser diagnostics captured an AudioContext device error when Motion Studio opened after the other two players. Its timecode remained zero for six additional seconds. Installed Remotion waits for an advancing audio output clock before scheduling frames on an unmuted player. Motion layers contain text/shapes only. The shared preview now forwards Remotion's existing `initiallyMuted` prop, defaulting false; Motion Studio enables it. Main editor and Template Studio audio behavior stays unchanged. A regression that keeps AudioContext.resume pending failed before the fix and passed after it. The original three-surface playback assertions also passed unchanged (3 focused results including warmup). Temporary diagnostics were removed and the playhead hook remains unchanged. The final full CI run includes this fix.

Final verification completed:

- `bun run ci` exited 0 from the final source: formatting, lint, all 12 workspace typechecks, version/reference checks, Rust formatting/Clippy/tests/WASM, deployment parity, release hygiene, all 4,396 portable tests (one existing skip), 2,279 Bun integration tests, web layer/census checks, and all 805 browser tests passed. Browser duration was 12.9 minutes. The original transport assertions and the new unavailable-audio regression both passed in that full run.
- `openspec validate rebrand-to-maleo --strict` and `git diff --check` passed. Source logo, historical records, released changelog and migration-preservation audits passed. No archive, commit, push or deployment was performed.

Full application Docker image build/run, production migration, external provider calls and physical-device installation/icon refresh remain unperformed. They are not implied by the isolated runtime, compose, volume, production smoke or Chromium evidence.

Coolify configuration follow-up authorized on 2026-10-20:

- Verified the existing Maleo project and unchanged core application UUID. Renamed core and four supported infrastructure application labels to Maleo. Core already targeted `kevinjulian/maleo`; updated the other four source repositories to match, retaining `main`, their existing `/infra/*` build directories and `/Dockerfile` paths.
- Paused core auto-deploy through the documented application API. The MCP application tool explicitly ignored this field, so the API update was verified by a fresh readback. Saved core auto-deploy is false; no deploy, restart, stop, volume operation or database conversion was performed.
- Verified all five applications still report `running:healthy`. Existing domains, UUIDs, core compose location and build paths stayed unchanged. Re-read environment metadata and verified identical variable UUIDs, keys, preview scopes and build/runtime flags. No credential value was printed or changed.
- The new Git repository had no refs during this check. Eighteen distinct old-prefix environment keys remain on the prior runtime configuration. Their value-preserving conversion must accompany stored settings/envelope, database, volume and durable-job cutover before the new core deployment. Re-enable auto-deploy only after cutover acceptance.
- Two retired deployments remain outside the supported source migration: affiliate uses its separate repository, while Supertonic uses a removed application path. Their labels, domains, source settings and running containers were left unchanged. Retargeting them to the new monorepo would reference absent code.
- This follow-up verifies saved configuration and running-health readback. It does not claim that production now runs the rebranded revision. The prior full source CI result remains valid; only deployment records and OpenSpec evidence changed locally.

Local checkout cutover authorized and completed on 2026-10-21 after the directory changed to `maleo`:

- Diagnosed local root environment and existing embedded role/database still using the former namespace. Created a cold copy of stopped Postgres plus root environment and unchanged file master key outside the checkout in the user's Maleo backup directory. No runtime database was initialized or replaced.
- Ran the existing offline converter against the explicitly selected local database: seven stored setting keys and one envelope fingerprint converted. Renamed existing database and role to Maleo, reset the documented local password, and removed the temporary maintenance administrator. Converted 34 root environment names with every value preserved byte-for-byte.
- Compared every row in all 144 non-settings tables before/after conversion: all 34,684 rows identical. All five stored encrypted payloads and the file master key remained byte-identical. Actual Maleo runtime secret readers successfully opened all five credentials. Conversion retry returned zero changes.
- Ran the user's `MALEO_MEDIA_STORAGE_BACKEND=local bun run restart` from the renamed checkout. API, web, media worker and Inngest all reached ready state and returned HTTP 200. Browser loaded the Maleo application. No source code, runtime compatibility reader, production resource or remote deployment changed. Local stack remains running. Full source CI was not repeated for this operational data/environment conversion.
