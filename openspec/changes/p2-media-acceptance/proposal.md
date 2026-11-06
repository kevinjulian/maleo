# Proposal

## Why

`p2-media-playback` delivered roadmap milestones 5.1–5.5 and was archived on 2026-11-01. Its acceptance did not finish. Tasks 7.3–7.7 stay open, and the grandplan keeps 5.1–5.5 unchecked until they close (see `archive/2026-11-01-p2-media-playback/evidence/acceptance.md`). This change closes those open items so that the media milestones can be accepted before the export phase (6.x) uses them.

## What Changes

- **Audio decode startup (closes old 7.4).** Keep one decode worker for each audio source while its decoder lease is held. Now each 0.25 s window starts a new worker and parses the source again, and the first Play of a session and Play at 0.5x take 0.2–2.2 s to settle against a 250 ms target. The worker yields its lease under contention in the same way as the video placement client. This revises the D6 rule "one codec lifetime per job" from the archived design (approved by the user on 2026-11-06). The decoder count and the PCM budget do not change.
- **Seek then Play (closes old 7.6 flake).** Find and fix the intermittent reset to 0:00 after a paused ruler seek and Play in normal preview. `preview-readiness-acceptance` must then pass in repeated runs.
- **Readiness status geometry (closes old open item 3).** The status now sits in the toolbar row. Measure that its arrival and departure do not move the timeline lanes. Remove the settle wait that `timeline-chrome` uses as a workaround.
- **Seek-latency distribution (closes old 7.3).** Record seek latency in the existing 100-seek stress run.
- **Physical iPhone proof (old 7.5).** Record Play, sound, suspension and memory on a physical iPhone. This task is gated on a device. It stays open if no device is available, and emulation cannot close it.
- Run the full gate, then update grandplan 5.1–5.5 only where the evidence is complete.

Non-goals: export (6.x), cutover to the normal-preview renderer, native adapters, new codecs, threshold changes, and new transport or pitch controls.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `media-playback`: audio decoders persist for each source within their lease, and they yield when another source needs the slot.
- `preview-runtime`: synchronized playback has measured offset and settling budgets, including the first Play and every transport rate. Play starts from the current position after a seek.
- `preview-media-readiness`: the readiness status does not move the timeline geometry.

## Impact

- `apps/web/src/services/preview-media/audio-client.ts`, `audio-worker.ts` and `preview-audio-protocol.ts`. The consumers that request audio windows use the new per-source client. `decoder-leases.ts` and the Rust grant broker are reused without change.
- The session, transport and preview hook path involved in the seek/Play reset. The location is found by investigation in task 2.1.
- Perf specs `preview-media-sync.spec.ts` and `preview-media-stress.spec.ts`, visual specs `preview-readiness-acceptance.spec.ts` and `timeline-chrome`.
- Docs: the web preview runtime documentation for the audio decoder lifetime, and `CHANGELOG.md` Unreleased.
- No HTTP, database, renderer or WASM ABI change.
