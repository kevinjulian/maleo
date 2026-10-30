# Integrated acceptance (tasks 7.3–7.7)

Status on 2026-10-29: **not accepted**. 7.3 passes on the named machine. 7.4
passes its offset targets but not settling. 7.5 lacks physical iPhone proof.
7.6 records the repository gate below. No threshold changed. Grandplan
milestones stay open (7.7).

Named desktop acceptance machine (D10): MacBookPro18,3, Apple M1 Pro, 16 GiB,
macOS 26.5.2, Chromium 151.0.7922.34 headless, WebGPU through ANGLE Metal.

## 7.3 Dual 1080p30 playback and latest seeks

```sh
bun run --cwd apps/web playwright test perf/preview-media-stress.spec.ts --project=perf
```

Fixture: `scripts/media-playback-stress-fixtures.ts`, two 60-second 1920x1080
30 fps H.264 sources plus narration and music (106 MB). Three consecutive
runs, all passing every assertion in the spec (`stress-1080p.json`):

| Run | Wall time to 59.9 s | Presented | Dropped | Draw p50 / p95 | Peak tree RSS |
| --- | ------------------: | --------: | ------: | -------------- | ------------: |
| 1   |             60.59 s | 1787/1800 |   0.72% | 5.2 / 6.6 ms   |       829 MiB |
| 2   |             60.49 s | 1786/1800 |   0.78% | 5.0 / 7.3 ms   |       831 MiB |
| 3   |             60.13 s | 1787/1800 |   0.72% | 5.1 / 6.5 ms   |       857 MiB |

Readiness took 476–510 ms. Budgets held in every run: visual peak 265,420,800 B
(limit 268,435,456), PCM peak 2,499,576 B (limit 16 MiB), 2 video slots. The 100
latest seeks end at the final target (55 s) within the visual budget. Disposal
releases visual and PCM bytes to 0 and closes the AudioContext. The spec now
polls position every 100 ms instead of every second, so wall time is measured
to 0.1 s; the 61.5 s threshold is unchanged.

Before the fixes the same fixture dropped 55–69% and peaked at 1758 MiB. Two
changes brought it into target:

1. **GPU frame supply.** Per-frame profiling put decode at 0.4 ms and the
   reservation at 0.3 ms, but the CPU YUV-to-RGBA conversion at 18–22 ms
   (2D canvas readback; `VideoFrame.copyTo({ format: "RGBA" })` measured the
   same). The video worker now transfers the `VideoFrame`; the renderer copies
   it into a texture with `copyExternalImageToTexture` and registers it with
   vello (`Renderer::cache_media_texture`, wasm `cache_video_frame`). The copy
   now costs 0.015 ms. A renderer test proves a registered texture draws exactly
   like the same CPU RGBA, and that device replacement drops it.
2. **Shared prefetch decoder.** A placement and its prefetch share one decoder
   worker (design D5). A prefetch-only change that cancelled prefetch while its
   placement missed was tried and rejected: it serialized decoding and made the
   sync fixture play at 0.37x real time. Disabling prefetch dropped 72%.

Residual: in about one run in four before the shared decoder, startup showed a
1.3–1.5 s buffering burst. The three final runs had none.

## 7.4 Synchronization

See `synchronization.md`. Offsets pass: overall p95 33 ms, maximum 67 ms (1x
p95 17 ms, 2x p95 28 ms, 0.5x p95 61 ms). Every 1x and 2x transition settles in
under 125 ms. Starts at 0.5x settle in about 480 ms, and the first Play of a
session varies from 0.2 to 2.2 s, against 250 ms.

## 7.5 Browser and device checks

- Chromium codec matrix: `codec-matrix-chromium.json` (`codecs.md`).
- WebKit 26.5 codec matrix: `codec-matrix-webkit.json`. VP9 is a named
  unsupported-codec failure on this host.
- WebKit 26.5 output: `visual/preview-audio-output.spec.ts` now follows the
  same `MEDIA_CODEC_BROWSER` switch as the codec matrix. Gesture-owned worklet
  output of real Rust blocks, gaps, seek flush and suspension pass:

  ```sh
  MEDIA_CODEC_BROWSER=webkit bun run --cwd apps/web playwright test visual/preview-audio-output.spec.ts --project=visual --workers=1
  ```

  Result: two passed, including warmup.

- Physical iPhone Play, sound, suspension and memory: **no device proof**. The
  task stays open; emulation cannot close it.

## 7.6 Repository gates

Recorded across the full `bun run ci` runs on 2026-10-29:

- `check:version`, `check:references`, `vp check` (3356 files), `typecheck`
  (12 workspaces): pass.
- `check:rust`: fixture check, `cargo fmt --check`, workspace Clippy with
  warnings denied, `cargo test --workspace` (renderer goldens 31 passed in
  1241 s) and both WASM builds: pass.
- `check:deploy`: pass.
- `check:release-hygiene`: failed on `mediabunny@1.45.0.patch` in
  `package.json`, read as an email address. Fixed in
  `scripts/check-release-hygiene.ts` (the first domain label needs a letter)
  with a test; now passes.
- `check:fixtures`: pass.
- Portable suites: 512 files, 4687 tests passed, 1 skipped.
- Bun suites: one run had 394 failures from embedded Postgres clusters
  refusing connections while ten workspaces started in parallel; the rerun had
  5 failures, all in untouched `packages/media` processing jobs at the 5 s
  default timeout. Those files pass alone (21 tests) with a 30 s timeout. No
  failure involves this change's code.
- `check:layers`: failed on a relative cross-directory import this review
  introduced in `app/preview-media-routes.ts`; fixed to the `@services`
  alias. `check:census`: pass.
- Browser visual suite: 814 passed, 8 failed.
  - `account-shell` dark 1440: passed on rerun (flake).
  - `library-chrome` template row: **real defect**. Library's template editor
    mounted `usePreviewMedia` before any route had loaded the editor engine,
    and the modal crashed. Fixed: the session waits for `loadEditorEngine()`.
  - `media-expiry`, `source-crop` and four `pending-media` cases: the specs
    predated complete-source preview. They now stub `/api/media/<id>/sign`,
    look for the preview's `blob:` image, scope to the upload badge
    (`[data-upload-phase]`), and compare clip geometry after preview readiness
    settles.
- `openspec validate p2-media-playback --strict`: pass.

Last full run (`RUST_TEST_THREADS=2 bun run ci`, 2026-10-29, after the 7.3
and 7.4 fixes): version, references, `vp check`, typecheck, the Rust gate
(fmt, Clippy, workspace tests, goldens, both WASM builds), deploy, release
hygiene and fixtures pass. Portable suites: 512 files, 4691 tests passed, 1
skipped. The Bun step failed on embedded Postgres connection refusals with ten
clusters starting in parallel. Re-run alone, the Bun suites pass except two
`packages/media` caption jobs that time out under load; that file passes alone
(10 tests). This change does not touch `packages/media` or `packages/db`.

The remaining CI steps were run individually: `check:layers` and
`check:census` pass. Browser visual suite: 821 passed, 1 failed. The failure was
`timeline-chrome` "a clip dragged across lanes": with media now reaching
readiness during the test, the readiness notice disappears in the first few
hundred milliseconds and moves the lanes under a press measured before it. The
spec now waits for the notice to settle. The jump itself is open (below).

`preview-readiness-acceptance` is unreliable after these changes: in normal
mode it fails about one run in three. After a pause, a ruler seek to 4 s and
Play, the timecode returns to 0:00 and playback stops within 150 ms; the spec
then waits on a Pause button with no timeout. Restoring the original
synchronous session creation in `usePreviewMedia` did not change it, and with
tracing on it passes. The cause is not yet found.

## 7.7 Grandplan

Milestones 5.1–5.5 in `openspec/changes/platform-grandplan/tasks.md` stay
unchecked: 5.4 depends on 7.4 settling, 5.1–5.5 on the phase closeout, and
physical-device proof is missing.

## Open items

1. **Settling at 0.5x and on first Play (7.4).** Audio bounds both. First Play
   pays device activation (129 ms) plus cold decodes of the first audio
   windows, which spawn a worker and parse the source per 0.25 s window and have
   600–800 ms outliers. A persistent audio decode worker per source would remove
   that cost but changes D6's one-codec-lifetime-per-job rule.
2. **Physical iPhone proof (7.5).**
3. **Readiness notice moves the timeline.** The notice is in normal flow under
   the toolbar, so its arrival and departure shift the lanes by 25–41 px. An
   overlay was tried and rejected: it covered the ruler and clipped the message.
   The options are a permanently reserved row (changes every ready-state
   baseline) or a status inside the toolbar row.
4. **`preview-readiness-acceptance` normal mode (7.6).** Intermittent reset to
   0:00 after Play following a seek; see above.
5. **Seek-latency distribution (7.3)** is not yet recorded.
