# Spike A: wgpu frame inside a gpui window

Question: can a gpui window show a wgpu-rendered frame at playback rate, with
the editor panes around it, on macOS?

Design: OpenSpec change `platform-p0-foundations` (archived 2026-10-22), decision D2.

## Pass criteria

All must hold on an Apple Silicon Mac, release build:

1. 30 fps sustained for 60 seconds with zero dropped frames.
2. p95 frame time at most 16.7 ms when driven at 60 fps.
3. A pane resize during playback drops at most one frame.
4. A click on a pane control responds within one frame while playback runs.

## What the spike does

- A gpui window with a toolbar, three panes (browser, preview, inspector) and a
  timeline strip.
- Each produced frame uploads a 1920x1080 RGBA buffer to a wgpu texture (a
  stand-in for a decoded video frame), runs one composite pass that draws the
  texture plus an animated overlay into a BGRA target, and reads the target
  back to CPU memory.
- Integration path 1: the read-back bytes become a gpui `RenderImage` shown by
  an `img` element in the preview pane. The previous frame's image is dropped
  from gpui's sprite atlas.
- Playback is clock-driven: each gpui frame computes the frame index the
  clock asks for and produces it if it is new. A gap of more than 1.5 frame
  periods between produced frames counts as dropped frames.

Measured per run (`src/main.rs`, `src/stats.rs`):

- **frame time**: upload + composite + readback + image build (wgpu work).
- **UI frame**: gpui render start to the end of paint, including the atlas
  upload of the new image. A zero-size canvas painted last marks the end.
- **produced-frame interval** and **gpui render interval**.
- `--resize`: the window toggles between 1440x900 and 1280x800 every 2 s.
  Drops within 500 ms after a resize are attributed to it.
- `--click`: every 2 s, a left click on the toolbar toggle. The toggle widens
  the inspector pane from 280 to 420 px, so each click is also a pane resize.
  Latency is from posting the click to the first render that shows it.

## Run

```bash
cd spikes/gpui-wgpu
cargo run --release -- --fps 30 --seconds 60
cargo run --release -- --fps 60 --seconds 60
cargo run --release -- --fps 30 --seconds 20 --resize
cargo run --release -- --fps 30 --seconds 20 --click
```

Run under `caffeinate -du` so the display does not sleep.

## Result

- Date: 2026-10-22
- Machine: Apple M1 Pro, 16 GB, macOS 26 (Darwin 25.5), external
  1920x1080 display at 60 Hz. wgpu adapter: Apple M1 Pro (Metal).
- Versions: gpui 0.2.2 (crates.io), wgpu 30.0.1, rustc 1.98.1. Pinned in
  `Cargo.toml` and `Cargo.lock`.
- Path used: **path 1** (offscreen render, readback, gpui image). Paths 2
  (IOSurface) and 3 (`CAMetalLayer`) were not tried, because path 1 passed.
- Raw output: `results/`.

| Run                  | Dropped | Frame time p50 / p95 / max | UI frame p50 / p95 / max | Other                                         |
| -------------------- | ------- | -------------------------- | ------------------------ | --------------------------------------------- |
| 30 fps, 60 s         | 0       | 2.74 / 5.22 / 12.12 ms     | 0.71 / 6.91 / 17.27 ms   | interval p95 34.31 ms                         |
| 60 fps, 60 s         | 1       | 2.71 / 4.83 / 8.37 ms      | 3.98 / 7.53 / 10.63 ms   | interval p95 17.60 ms                         |
| 30 fps, 20 s, resize | 0       | 2.76 / 4.89 / 9.51 ms      | 0.51 / 6.77 / 15.98 ms   | 10 window resizes, 0 drops each               |
| 30 fps, 20 s, click  | 0       | 2.66 / 3.19 / 6.89 ms      | 0.42 / 4.43 / 7.77 ms    | 10 clicks, latency p50 14.68 ms, max 30.84 ms |

The frame time splits about evenly between the upload (p50 1.34 ms) and
composite plus readback (p50 1.38 ms).

Criteria:

1. **Pass.** 1,800 frames in 60 s at 30 fps, zero dropped.
2. **Pass.** p95 frame time 4.83 ms, and p95 UI frame 7.53 ms, at 60 fps.
   The 60 fps run dropped one frame at 51 s (one 28 ms interval). The 0 dropped
   requirement applies to the 30 fps criterion only.
3. **Pass.** 10 window resizes and 10 inspector pane resizes during playback,
   zero dropped frames.
4. **Pass.** Every click showed within 30.84 ms, inside one 33.3 ms playback
   frame (at most two 60 Hz display refreshes).

Conditions that the numbers depend on:

- **Warm-up.** The first 0.5 s is not measured. Without it, every run dropped
  one frame at about 0.08 s: window show and the first atlas allocation.
  Playback in the editor starts after the window is shown.
- **Occlusion.** gpui stops drawing a window that macOS reports as occluded
  (`windowDidChangeOcclusionState`). Two early runs had render gaps of 16 s
  and 79 s when other windows covered the spike. The measured runs use
  `WindowKind::PopUp` to keep the window on top. This is correct product
  behavior, not a render cost.
- **Click path.** The click is an `NSEvent` posted to the app's own AppKit
  queue, so it goes through `sendEvent:` and gpui hit testing. A system-wide
  `CGEventPost` needs Accessibility permission, which the run did not have, so
  the HID layer is not in the measured latency.
- **No decode.** Source frames are synthetic. Decode cost belongs to the media
  trait (grand plan D13) and is measured in P2.

Not run: Windows, Linux, Intel Macs, a 120 Hz ProMotion display, and preview
resolutions above 1080p.

Risk for later phases: path 1 copies each frame twice through CPU memory
(readback, then the gpui atlas upload). At 1080p this costs about 3 ms p50.
At 4K the copies are four times larger, and the 60 fps budget can fail. If P4
needs a 4K preview, try path 2 (IOSurface shared texture) first. gpui 0.2.2
already draws `CVPixelBuffer` surfaces, but only in a biplanar YCbCr format,
so path 2 needs a conversion pass.

**Verdict: go.** Path 1 passes all four criteria on macOS. Grand-plan D3
(desktop UI is gpui) stands. P4 runs this harness on Windows and Linux before
the desktop ships.
