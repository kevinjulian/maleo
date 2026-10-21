# timeline-render-budget Specification

## Purpose

What may cause the timeline to re-render, what must not, and how the cost of a
render is bounded as the clip count grows.

Everything here is invisible in the rendered output — the editor looks identical
whether a click commits once or four times — so none of it can be held by a
screenshot, a type check, or by reading a diff. That is why the last requirement
is about measurement rather than about behaviour: without a recorded
before-and-after there is no way to show the budget is met, and no way for a
later change to notice it was lost.

The instrument is `apps/web/src/models/timeline/render-probe.ts` (components
tally their own renders, off unless a harness turns counting on) driven by
`apps/web/perf/render-budget.spec.ts` (`bun run perf` in `apps/web`), which
reports per-component counts for a click, a re-click, an A→B→A and a second of
playback at a stated clip count.

Acceptance is attribution, not a target number. Some commits are legitimate: a
surface displaying the current time has to update when time changes. The defect
this budget exists to prevent is the commit that carries no new information, and
the render that repaints something the interaction never touched.

## Requirements

### Requirement: Selecting a clip re-renders only what changed

Changing the timeline selection SHALL re-render the interactive elements whose selected state changed, and SHALL NOT re-render elements whose selected state is unchanged, lanes containing no affected clip, or the preview stage. Where clips are painted rather than mounted, the selection SHALL invalidate only the regions the affected clips occupy, and SHALL NOT invalidate the whole timeline.

Selection is the most frequent action in the editor and the cheapest one to get wrong. It was originally component state in the editor's root, so every selection repainted every clip, every waveform and the player subtree — and because clicking a clip also seeks, the repaint happened three or four times per click. Making the selection a subscription rather than a prop is what turned an O(all clips) operation into an O(2) one, and the same bound has to survive the move to a painted timeline: a canvas that repaints entirely on selection has given the cost back in a form that no render counter would show.

#### Scenario: A clip is selected while another is already selected

- **WHEN** the operator selects a clip while a different clip is selected
- **THEN** only the two clips whose selected state changed re-render, and only the regions those two occupy are repainted

#### Scenario: The same clip is selected twice

- **WHEN** the operator selects a clip that is already the selection
- **THEN** nothing re-renders and nothing is repainted

#### Scenario: Selection does not repaint the preview

- **WHEN** the timeline selection changes
- **THEN** the preview stage does not re-render as a consequence of the selection itself

### Requirement: An interaction does not re-enter its own cycle

A state write made in response to a timeline interaction SHALL NOT cause a further write whose only cause is that first write. Specifically, a playhead position reported by the player SHALL NOT cause the player to be seeked back to the position it just reported.

Every commit an interaction produces SHALL correspond to a distinct state change the interaction genuinely caused. Commits that exist only as an echo of an earlier commit SHALL be eliminated.

This is deliberately not "one interaction, one commit". Some commits are legitimate: a surface that displays the current time has to update when time changes, and panel bookkeeping has to run when the selected kind changes. Those are real state changes with real consumers, and a rule forbidding them would either be violated on day one or met by hiding the write somewhere less visible. The defect worth specifying against is the commit that carries no new information.

A click on a clip currently produces up to four commits: the batched select-and-seek, the player's `frameupdate` echo, the clip-tab effect, and a seek effect that fires because the playhead changed after the player itself changed it. The last is a feedback loop whose guard is cleared on a microtask while the event it guards against arrives on an animation frame — the guard cannot win that race, and a timing flag is the wrong instrument for the question. Identity is the right one, as the row-compaction effect already records.

#### Scenario: A seek originating from the player does not echo back

- **WHEN** the player reports a frame and the playhead updates to match
- **THEN** no effect seeks the player back to the position it just reported

#### Scenario: A clip is clicked

- **WHEN** the operator clicks a clip
- **THEN** the interaction produces no commit whose only cause is an earlier commit of the same interaction

#### Scenario: A time-dependent surface updates

- **WHEN** a surface displaying the current time updates during an interaction
- **THEN** that commit is permitted, and it does not re-render lanes, clips or the preview stage

#### Scenario: A derived panel field is written only when it changes

- **WHEN** the selection changes to a clip of the same kind as the previous selection
- **THEN** no additional commit is produced by panel-state bookkeeping

### Requirement: Playback does not re-render the timeline

Advancing the playhead during playback SHALL move the playhead indicator without re-rendering clips, lanes or the lane container.

The playhead is drawn as a React `left` offset driven by the player's frame events, so continuous playback repaints the whole timeline at frame rate — the single largest source of render work in the editor, and it produces no change to anything except one element's position. The same file already solves this exact problem for the hover cursor by writing styles through a ref, with a comment stating that the point is to avoid a re-render per pointer move.

#### Scenario: The timeline is played

- **WHEN** the preview is playing and the playhead advances
- **THEN** the playhead indicator moves and no clip re-renders

#### Scenario: The playhead is dragged

- **WHEN** the operator drags the playhead or scrubs the ruler
- **THEN** the playhead follows the pointer and no clip re-renders

#### Scenario: Playback still updates surfaces that depend on time

- **WHEN** the playhead advances past a boundary that a time-dependent surface displays
- **THEN** that surface updates, without the lane container re-rendering

### Requirement: Per-render work is linear in clip count

Rendering the timeline SHALL NOT perform work that is quadratic in the number of clips. Lane membership and clip-to-overlay lookups SHALL be computed once per render, not once per lane or once per clip.

Per-frame work — mounted interactive elements, paint calls, and geometry computation — SHALL be linear in the number of clips within the visible range, and SHALL NOT grow with the number of clips outside it.

The lane map filtered the whole clip array for every lane, and four separate call sites ran a linear `.find()` over an overlay array for every clip drawn. At ten clips this is invisible; the cost curve is what makes a large project feel different from a small one. Bounding the work by the visible range rather than by the document is the same argument taken one step further, and it is what makes a project of a few thousand clips behave like the one on screen.

#### Scenario: Clips are distributed across lanes

- **WHEN** the timeline renders lanes containing clips
- **THEN** lane membership is derived from one pass over the clips, not one pass per lane

#### Scenario: A clip needs its backing overlay

- **WHEN** a clip renders and requires a field from its backing overlay record
- **THEN** the record is retrieved by key, not by scanning the overlay array

#### Scenario: A large project is opened

- **WHEN** a project holding an order of magnitude more clips than fit on screen is opened
- **THEN** the mounted interactive element count and the per-frame paint work are proportional to the clips within the visible range, not to the project's total

#### Scenario: The viewport scrolls

- **WHEN** the visible range moves across a large project
- **THEN** work per frame stays proportional to the visible range, and no per-frame cost accumulates with distance scrolled

### Requirement: A render allocates no value that defeats memoization

Rendering SHALL NOT allocate collections or object literals whose identity is compared by a downstream memo boundary.

The editor builds `new Set(selectedFreeIds)` at eight call sites per render and hands both children freshly built prop bags. Any memo boundary placed downstream is defeated by these before it can help, which is why this must be removed first rather than alongside. A memo boundary that silently never holds is worse than none — it reads as protection while providing nothing.

#### Scenario: The editor renders

- **WHEN** the editor re-renders without the selection having changed
- **THEN** the selection collections it passes to children keep their identity

#### Scenario: A memo boundary is added downstream

- **WHEN** a memoized lane or clip receives props derived from an unchanged document and an unchanged selection
- **THEN** the memo holds and the component does not re-render

### Requirement: A waveform costs one element

An audio clip's waveform SHALL cost no mounted element per sample bar, and its cost SHALL be independent of its resolution. Where the timeline is painted, a waveform SHALL cost no mounted element at all; where it is not, it SHALL occupy a single element.

Waveform decoding and decimation SHALL NOT run on the main thread, and a waveform's summary SHALL be reusable across renders and across zoom changes that do not increase the density it needs.

Each audio clip emitted up to 256 DOM nodes, re-created on every render of the lane that held it — multiplied by the commit count per click and the render rate during playback. Making the waveform's cost independent of its resolution is the requirement; painting it is how that is met once the timeline paints, and it is also what makes a taller-resolution waveform affordable.

#### Scenario: An audio clip is drawn

- **WHEN** an audio clip with a decoded waveform renders
- **THEN** its waveform costs no element per sample bar, regardless of how many it displays

#### Scenario: A waveform is redrawn at a new width

- **WHEN** zoom changes an audio clip's rendered width
- **THEN** the waveform redraws at the appropriate resolution without adding elements, and requests new summary data only when the existing summary is insufficient

#### Scenario: Audio has not decoded yet

- **WHEN** an audio clip renders before its waveform has decoded, or after a decode failure
- **THEN** the clip falls back to its label, and remains selectable and editable

#### Scenario: A long asset is summarised

- **WHEN** a waveform summary is produced for a long asset
- **THEN** decoding and decimation happen off the main thread, and the timeline continues to respond while they proceed

### Requirement: Render behaviour is measured, not asserted by inspection

The change SHALL record profiler-measured commit counts for a click, a re-click and one second of playback, before and after, against a project of a stated clip count. Each commit remaining after the change SHALL be attributed to the state change that caused it.

Every requirement here is about work that is invisible in the rendered output — the app looks identical whether it commits once or four times. Without a recorded before-and-after there is no way to know the change achieved anything, and no way for a later change to notice it regressed.

Attribution is what replaces a fixed commit target. A count on its own cannot distinguish a legitimate commit from an echo, so the acceptance is that every surviving commit has a named cause — which is falsifiable, and which fails loudly for exactly the defect this change exists to remove.

#### Scenario: The change is completed

- **WHEN** the work is finished
- **THEN** profiler-measured commit counts for select, re-select and playback are recorded alongside the clip count they were measured against

#### Scenario: A commit survives the change

- **WHEN** an interaction still produces more than one commit after the change
- **THEN** each commit is recorded with the state change that caused it, and none is an echo of another

#### Scenario: Behaviour is unchanged

- **WHEN** the timeline is exercised after the change
- **THEN** every interaction produces the same edits, selections and preview state as before, and the visual regression baselines are unchanged
