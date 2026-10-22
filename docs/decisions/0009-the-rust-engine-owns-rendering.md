# ADR 0009: The Rust engine owns rendering; Remotion retires after a parity window

- Status: Accepted
- Date: 2026-10-22
- Deciders: Kevin Julian
- Related: OpenSpec `platform-grandplan` (D1, D3), `platform-p0-foundations`;
  evidence in [spike A](../../spikes/gpui-wgpu/README.md) and
  [spike C](../../spikes/rust-captions/README.md)

## Context

Preview and export render through Remotion: React compositions drawn by a
headless Chrome. That puts a browser in every client that previews and in
every server that exports. A desktop UI in gpui and a mobile UI in Kotlin
cannot draw a React composition.

Two other roads were argued:

- **Keep Remotion and wrap the editor in Tauri.** It ships a desktop app
  sooner, but Chromium stays in every client, and the gpui and Kotlin clients
  still cannot draw a composition.
- **A native renderer for desktop, Remotion for web and export.** Two
  renderers drift apart, and every visual feature is built twice.

Two risks were open, and P0 measured both:

- A wgpu frame must play inside a gpui window, because gpui does not draw
  through wgpu. Spike A uploaded a 1920x1080 frame each tick, composited it
  with wgpu, and showed it in the gpui preview pane on an M1 Pro. It ran 60 s
  at 30 fps with zero dropped frames, had a p95 frame time of 4.83 ms at
  60 fps, dropped no frame through 20 pane and window resizes, and answered
  every click within one playback frame. It used the simplest path:
  offscreen render, readback, gpui image.
- Captions are the hardest visual feature. Spike C drew 14 caption fixtures
  with parley and vello, and compared them with Remotion stills of the
  product's own `Captions.tsx`, rendered in the production image. Full-frame
  SSIM was at least 0.9909 (caption region 0.928 to 0.992). Line breaks, the
  active word on each frame, and the box position matched within 2 px. Stroke,
  shadow and highlight look the same side by side.

## Decision

- The Rust engine renders both preview and export, through one wgpu
  compositor. Compositions and templates are data the engine reads, not
  React code.
- Text and captions are laid out with parley and drawn with vello.
- The desktop preview shows engine frames inside gpui through offscreen
  render and readback. Use a shared GPU texture only if a resolution above
  1080p needs it.
- Remotion keeps rendering exports until the Rust renderer reaches parity
  with it on every composition in use. Through that window, both renderers
  run on the same storyboards and their frames are compared. Remotion is
  removed when the comparison holds, not before.

## Consequences

- Clients and export servers no longer need Chrome. Preview and export share
  one renderer, so they cannot drift.
- Every Remotion composition needs a Rust port before Remotion retires. The
  parity window keeps two renderers alive, and every visual change lands in
  both until then.
- The renderer must bundle its own fonts, emoji included. The production
  image installs no emoji font today, so Remotion exports draw emoji as empty
  boxes. The Rust renderer must not inherit that by relying on system fonts.
- vello has no blur for arbitrary shapes. The caption shadow needs a wgpu blur
  pass.
- Readback copies each preview frame through CPU memory twice. At 4K the
  60 fps budget can fail. A shared texture (IOSurface on macOS) is the next
  step if that becomes a requirement.
- Spike A ran on macOS only. Revisit the gpui part of this decision if the
  same harness fails on Windows or Linux in P4. The fallback is egui with
  `egui-wgpu`, which shares the wgpu device by design.
