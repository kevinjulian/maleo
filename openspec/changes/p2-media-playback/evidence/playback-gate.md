# Common playback gate

Task 6.3 adds readiness to `useRemotionPlayhead`. Its Player ref gates every
imperative Play call, including animation replay. It preserves inherited Player
event methods. Blocked calls do not seek or retain play intent. Losing readiness
pauses the Player, clears pending recovery and requires a fresh command.
Paused seeking remains available. Replay rejects before seeking and clears
pending replay when readiness changes.

The main editor supplies its current native readiness. Both transport layouts
use the existing disabled prop. Template Studio projects its audio placements
into the same native source owner. It gates cue resolution, complete local bytes
and validation, and substitutes local URLs only in preview inputs. Stale cue
lookups cannot supply the prior cue. Motion Studio has no external media and
retains its immediate host-clock path.

Normal preview pauses before owned URLs are removed. Sign-out marks its media
session closed and notifies readiness before releasing bytes. Existing compare
leases still wait for audio/decoder shutdown.

Checks:

- Eighteen transport tests passed, including blocked imperative Play, no queued
  autoplay, inherited event methods, paused seeking and canceled recovery.
- Three composition, five session and one cue lookup tests passed. Session proof
  checks stop-before-revoke and closed readiness on sign-out.
- Seven browser tests passed in one run (1.6 minutes): desktop/320px blocked
  Space/K, Retry without autoplay, fresh offline Play, compare audio ownership,
  all three transports and silent Motion without resumed audio output.
- `preview-template-loading.spec.ts` passed with warmup (25.2 seconds). Held cue
  lookup and held WAV bytes independently disabled Play. Remotion's pooled audio
  tags had no assigned source playback. Completion did not autoplay. Fresh Play
  advanced the transport and audio from complete local bytes while offline.
- `bun run check` passed formatting, lint, version, references and all twelve
  workspace typechecks.

An attempted plain-object copy of Player lost inherited event methods. Static
checks rejected it and browser warmup failed. The final implementation forwards
the original Player through a gated proxy. The inherited-method regression test
and subsequent seven-test browser run passed. No threshold was changed.
