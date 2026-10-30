# Diagnostic audio ownership

Task 5.4 keeps reference audio selected on entry. The compare panel uses the
canonical Select below its existing PanelHeader. This is one choice control,
not a new shared pattern. The Select's normal popup and editor phone Sheet keep
the same options reachable at narrow widths. Existing panel spacing, canvas
geometry and tokens own layout. Canonical Note and Button expose buffering,
suspension and Retry. No feature control styling is added.

The existing caption form, Select stories and playback-speed selector supply
the production references. PanelHeader's actions slot is unchanged. The audio
choice stays session-local and changes no document, source URL or undo entry.

Selecting Rust first mutes the reference Player. AudioContext creation waits for
Play, or the explicit switch while reference playback is active. Reference mute
changes cannot make a second owner audible while Rust is selected. Returning to
reference waits for Rust output closure before restoring the prior mute state.
Unmount follows the same ordering before renderer/File disposal. Source removal
waits for main-thread audio shutdown before requesting its File acknowledgement.

Rust receives reference positions only as drift measurements during playback.
Its clock uses worklet consumption and output timestamps. Rate changes retain
its accepted position. The panel receives the actual transport rate on mount,
including an already-selected non-1x rate.

Focused ownership tests verify default selection, mute-before-start, early
unmute rejection, close-before-restore, rate routing and restoration of both
original mute states on unmount. The source bridge test verifies audio shutdown
precedes File removal.

Production browser proof passed at 1440px and 320px with coarse touch on the
narrow case. `bun run --cwd apps/web visual --project=visual
preview-compare-audio.spec.ts --workers=1` completed with no failed tests.
Both cases used complete local video/audio Files with the network offline.
They captured nonzero worklet output (peak 0.0624847412109375), observed Rust
audio clock ownership, and checked that reference audio stayed inaudible.
Switching back closed Rust output before reference sound resumed. Selecting
Rust while paused created no context until Play. Navigation closed both
created contexts. Both cases recorded zero ownership writes and page errors.
The desktop and phone screenshots were inspected. The narrow diagnostic pane
truncates its closed Select label, but its phone Sheet exposes both full labels.
The tests exercise that Sheet. This is browser output capture, not physical
speaker or iPhone proof.

Hook, bridge and media projection checks passed: 16 tests across three files.
Focused static checks passed. UI layers passed with 196 cross-cluster imports.
UI census passed with 337 cross-cluster classes and 229 inline style objects.
Captured reports are `compare-audio-1440.json` and `compare-audio-320.json`.
`bun run check` passed: version, references, formatting, lint and all twelve
workspace typechecks.

Write monitoring was refreshed against the current command log. The browser
test now observes command submissions, legacy storyboard writes and presentation
patches. The legacy fixture first admits media identities through one existing
`scope.replace` save. The test waits for that named startup save before exercising
ownership controls. The refreshed run passed all three cases including warmup
(45.5 seconds). Both widths recorded one startup save and zero ownership writes.
The captured reports distinguish `initialWrites` from `ownershipWrites`.
