# Proposal

## Why

Rust preview cannot yet play video or audio, and current preview starts before all project media is available. Complete roadmap milestones 5.1–5.5 and prevent playback until every clip source loads, including muted audio and hidden video.

## What Changes

- Add browser video decoding through installed MediaBunny/WebCodecs, with shared source timing, bounded decoder pools and decoded-frame caching.
- Add shared audio mixing and a Web Audio AudioWorklet output adapter. Preserve narration, music, effects, embedded audio, trims, rate, reverse, pitch settings, fades, gain animation, ducking and mute rules.
- Use audio output position as the Rust playback clock when audio output is active. Keep host time for sessions without audio output.
- Load complete source bytes for every timeline clip before Play becomes available. Include muted, hidden and later clips, plus required processed derivatives. Exclude unused library assets. Deduplicate shared sources.
- Gate every playback entry point in normal and compare preview. Show per-clip loading progress, readiness, failures and Retry without preventing edits.
- Invalidate readiness on source changes, reject stale loading/decoding results and handle storage, decoder, audio and GPU failures without changing authored data.
- Keep Remotion as normal preview and production export owner. Exercise Rust audio through an explicit diagnostic compare owner so only one renderer is audible.

Non-goals: production export migration, normal-preview renderer cutover, Remotion removal, native adapters, project synchronization, media proxies, new source processing algorithms and unbounded full-timeline frame decoding.

## Capabilities

### New Capabilities

- `media-playback`: portable source timing, bounded decoding resources, shared audio mixing and browser media adapter contracts.

### Modified Capabilities

- `preview-runtime`: audio-led playback clock, media readiness enforcement, buffering/stall states and adapter lifecycle.
- `preview-media-readiness`: full-project media loading, all-entry-point playback gating, per-clip progress/retry and readiness invalidation.
- `engine-renderer`: decoded video compositing and explicit missing/unsupported media coverage.

## Impact

- `crates/preview`, `crates/renderer`, `crates/renderer-wasm` and a host-free `crates/media` boundary; existing editor WASM exposes shared readiness without loading the renderer on normal editor entry.
- Shared source inventory/timing projection and tests in `packages/shared`; browser media fetching/cache, preview worker/protocol, compare integration, transport and clip presentation in `apps/web`.
- Reuse MediaBunny 1.45.0, existing media authorization/resolution and pending-file staging. Temporary preview byte storage is local derived data, separate from pending uploads and authored persistence. No HTTP or database schema change is planned.
- Extend the feature-owned TimelineClip badge contract and existing approved TransportControls. Preserve pane geometry, gestures, accessibility and mobile access.
- Add real encoded-media fixtures, Rust/unit/browser proof, renderer parity cases and owning documentation updates during implementation. Retain existing reference gates and delayed-media measurements.
