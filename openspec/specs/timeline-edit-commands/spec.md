# timeline-edit-commands Specification

## Purpose

How every edit to the editor document is expressed, undone and redone: as serializable command data run by one shared function, so the editor, the server and any other implementation produce the same result for the same command.

## Requirements

### Requirement: Edits are reversible command objects

Every mutation of the editing document SHALL be a plain serializable command with deterministic compatibility information. One shared pure engine SHALL execute the command against its admitted editing scope and return the new scope and inverse command. Execution SHALL leave input unmutated, and applying the inverse SHALL restore the exact prior scope. Every controller, starting with web and API, SHALL use this execution authority rather than parallel language-specific editing implementations. Existing image/text commands SHALL remain operational during video-core migration.

#### Scenario: Command produces a new document immutably

- **WHEN** a command executes against scope `S`
- **THEN** it returns scope `S'` without mutating `S`

#### Scenario: Invert restores prior state

- **WHEN** a command produces `S'` and its returned inverse executes against `S'`
- **THEN** the result equals `S` exactly

#### Scenario: A command survives serialization

- **WHEN** a command or inverse is serialized and admitted by another supported runtime
- **THEN** its execution produces the same scope and validation outcome

#### Scenario: Invert removes a field the edit added

- **WHEN** an update command adds a field to an entity that did not have it and its inverse executes
- **THEN** the entity no longer has that field and equals its prior state exactly

### Requirement: Command-based undo and redo

Undo/redo SHALL be driven by a command stack, replacing the debounced full-document snapshot ring. Undo MUST invert the most recently applied command; redo MUST re-apply the most recently undone command. Undo/redo MUST cover the `image` and `text` content types as well, since commands target the document object rather than clips specifically.

#### Scenario: Undo inverts the last command

- **WHEN** the user issues undo (Cmd/Ctrl+Z) after applying a command
- **THEN** the last command is inverted and the document returns to its prior state
- **AND** the redo stack now contains that command

#### Scenario: Redo re-applies an undone command

- **WHEN** the user issues redo (Cmd/Ctrl+Shift+Z) after an undo
- **THEN** the previously undone command is re-applied
- **AND** the document matches the state before the undo

#### Scenario: New edit clears the redo stack

- **WHEN** a new command is applied after one or more undos
- **THEN** the redo stack is cleared

#### Scenario: Undo works for slides and posts

- **WHEN** an `image` or `text` project edit is applied as a command and the user issues undo
- **THEN** the edit is reversed via command inversion, without a clips document

### Requirement: Batched and text-input-safe commands

Related mutations SHALL be groupable into a single batch command so that one undo reverses the whole group. Undo/redo keybindings MUST be suppressed while focus is in a text input, textarea, or contenteditable, and while a studio modal is active.

A batch's undo SHALL target the scope the batch started from. It SHALL NOT be expressed as the inverse of one command in the batch, however that command is chosen. Inverting the most recent command satisfies the words of "reverses the whole group" for a batch that touches one entity repeatedly — a sustained drag emitting a command per frame — and fails every batch that touches more than one, restoring the last entity and leaving the rest where the batch put them. Seven operations were in the second category: paste, duplicate, delete, ripple delete, z-order reorder, organize-range and track reorder.

Batching SHALL remain bounded. A sustained drag emits a command per animation frame, so a batch that retained every command it collapsed would grow without limit; the batch's starting scope is one value and is already retained for this purpose.

#### Scenario: Batch reverses as one unit

- **WHEN** multiple mutations are applied within one batch command and the user issues undo
- **THEN** all mutations in the batch are reversed together in a single undo step

#### Scenario: A batch touches several entities

- **WHEN** one batch moves three clips and the user issues undo once
- **THEN** all three clips return to where they were before the batch, not only the last one the batch touched

#### Scenario: A batch touches one entity many times

- **WHEN** a sustained drag records a command per frame under one batch
- **THEN** the stack holds one entry for the drag, and undo returns the clip to where the drag started

#### Scenario: Undo suppressed in text fields

- **WHEN** the user presses Cmd/Ctrl+Z while focus is in an input, textarea, or contenteditable, or a studio modal is active
- **THEN** the editor undo does not fire and the event is left to the focused control

### Requirement: Director agent edits become commands

Director tools editing an existing timeline SHALL emit commands of the same admitted vocabulary used by direct manipulation and execute them through the shared authority. A settled result SHALL carry those executed commands for client application through the existing history path. Whole-plan generation and image/text collection callers that cannot name a discrete edit SHALL retain the checked document-diff adapter. Agent tool wiring SHALL be coordinated with `move-agent-tools-to-editor-commands` rather than implemented independently twice.

#### Scenario: Agent edit applied as a command

- **WHEN** the Director edits an existing timeline and its settled result is applied
- **THEN** the named commands enter the same history as manual edits and one undo restores the settled edit's prior state

#### Scenario: Generation produces a whole document

- **WHEN** a generation caller returns a whole plan rather than a named timeline edit
- **THEN** its checked document adapter preserves the resulting state and undo behavior without guessing commands for tools that already emitted them

### Requirement: The commit seam takes a command

The store's commit entry point SHALL accept a `Command`. A caller that knows which
edit it performed SHALL construct that command and commit it, rather than producing a
whole document and leaving the edit to be inferred.

A document-shaped commit SHALL remain available for callers that genuinely produce a
whole document, implemented as an adapter that derives the command and commits it.

#### Scenario: A drag commits the move it performed

- **WHEN** a clip is dragged to a new position
- **THEN** the command reaching the undo ledger is the move that call site constructed
- **AND** no structural comparison of the whole document is performed to identify it

#### Scenario: A document-shaped caller still works

- **WHEN** a caller holds a whole document rather than an edit
- **THEN** it commits the document and the seam derives the command
- **AND** the resulting ledger entry is the same as before this requirement

### Requirement: Structural inference is reserved for callers that cannot name their edit

Deriving a command by comparing two documents SHALL be used only where the caller
cannot know its edit: a bulk application of an agent run's generation output (a run
that created or regenerated content through the job model rather than editing the
existing timeline through commands), and edits to the slide and post collections,
which have no per-entity command vocabulary.

An agent run whose document changes were all made by editing tools SHALL NOT be
applied through structural inference; it arrives as the commands the run executed.

The module that performs that inference SHALL name those callers, so that it is not
read as leftovers from a migration.

Its correctness check — re-applying the derived command and comparing the result
against the target before trusting it — SHALL be retained, because a structural guess
can still be wrong on those paths.

#### Scenario: An agent run still commits as one step

- **WHEN** an agent run that generated content is applied to the document
- **THEN** it is committed through the document-shaped seam
- **AND** a single undo reverses the whole application

#### Scenario: An editing run is not diffed

- **WHEN** an agent run whose only document changes came from editing tools settles
- **THEN** its result is applied from the commands it carries
- **AND** no structural comparison of the whole document is performed to identify them

#### Scenario: A slide edit stays undoable

- **WHEN** a slide or post is added, changed or removed
- **THEN** the edit is recorded on the undo ledger
- **AND** undo restores the previous collection

### Requirement: Undo produces the same result however the command was obtained

Whether a command is constructed at the call site or derived by comparison, undo and
redo SHALL produce the same document. Graduating an edit from an inferred coarse
command to a constructed precise one SHALL change what is recorded, and SHALL NOT
change what the user sees.

#### Scenario: A precise command undoes to the same state as the coarse one it replaces

- **WHEN** an edit that previously produced a whole-scope replacement now produces a
  typed command
- **THEN** undoing it restores the same document the replacement would have restored
- **AND** redoing it produces the same document as before

### Requirement: A batch's bracket spans every write the action causes

A batch SHALL remain open until every write caused by the action has been recorded, including writes made from effects that run in response to it. An action whose consequences land in an effect SHALL NOT be bracketed synchronously.

Synchronous bracketing is correct only when the action writes everything itself. `moveFreeRow` and `organizeRange` move clips, and row compaction — an effect keyed on the clip list — then closes the gaps the move opened. That write is wanted, but with a bracket that closed when the op returned it landed outside the batch as a separate undo entry, and undo popped the compaction rather than the reorder. The correct shape is the one the drag path already used: open the batch on the action, close it in an effect declared after the normalising effects, because effects in one commit run in declaration order.

#### Scenario: An action's consequences arrive in an effect

- **WHEN** an operation writes to the document and an effect writes again in response to that change
- **THEN** the batch stays open until the effect's write is recorded, so one undo reverses both

#### Scenario: An action writes everything itself

- **WHEN** an operation's writes are all synchronous
- **THEN** a synchronous bracket is sufficient and no effect ordering is required

### Requirement: A normalising effect does not fight undo

An effect that edits the document in response to the document changing SHALL determine whether the state it is looking at was produced by undo or redo, and SHALL NOT rewrite it.

Such an effect cannot otherwise distinguish an undo from a user edit. Row compaction rewrote the state an undo had just restored, which both defeated the undo and — because recording clears the redo stack — left it looking inert rather than wrong, hiding the defect behind a symptom that pointed elsewhere.

The determination SHALL be made by identity, comparing against the document undo committed, and SHALL NOT be a flag meaning "a command is being applied right now". Timing cannot answer it: such a flag is cleared on a timer while the effect re-runs on later renders as its inputs take new identities, so it reads false exactly when it is needed. A document produced by undo is a state that already existed and was already normalised, so declining to normalise it again is correct rather than a suppression.

#### Scenario: Undo restores a state a normaliser would change

- **WHEN** undo restores a document layout that a normalising effect would otherwise rewrite
- **THEN** the effect leaves it alone, and the undone state survives

#### Scenario: A user edit produces the same layout

- **WHEN** a user edit produces a layout the normaliser wants to change
- **THEN** the effect runs normally, because the document is not the one undo committed

### Requirement: Reveal edits are undoable commands

Every reveal edit SHALL be recorded as a timeline edit command. Undo SHALL
restore the previous reveal state exactly, and redo SHALL reapply the reveal
edit exactly.

#### Scenario: Undo enabling reveal

- **WHEN** the operator enables a reveal effect on a clip and then issues undo
- **THEN** the clip returns to having no reveal metadata
- **AND** redo restores the reveal effect

#### Scenario: Undo manual duration change

- **WHEN** the operator changes reveal duration from Auto to a manual duration
  and then issues undo
- **THEN** the clip returns to Auto reveal duration
- **AND** redo restores the manual duration

#### Scenario: Clear reveal is undoable

- **WHEN** the operator clears reveal metadata from a clip and then issues undo
- **THEN** the prior reveal type, direction, phase, delay, and duration mode are
  restored

### Requirement: Reveal edits are one undo step per user action

Changing one reveal control SHALL create one undo step. A compound reveal preset
action that changes several reveal fields at once SHALL undo as one step.

#### Scenario: Preset action changes several fields

- **WHEN** the operator applies a reveal preset that sets type, direction, phase,
  and duration mode together
- **THEN** one undo restores all affected reveal fields to their prior values

### Requirement: Value-adjacent keyframe controls

Every inspector row holding animatable properties SHALL show one keyframe toggle before its row label, covering every animatable property in the row: off when no property of the row has a key at the inspected time, on when any does. Activating the toggle SHALL add a key holding each row property's sampled value at the inspected clip-local time where that property has none, or remove the row's keys at that time. Editing a value in a row where any property is keyed SHALL write a key for every animatable property of the row at the inspected time, in one undo step. Editing a value in a row with no keys SHALL change static values. Values SHALL use sampled clip-local animation at the inspected time; scale and opacity SHALL display percentages, rotation degrees and gain dB. Key timing, easing and removal SHALL be edited from the timeline (selected keys, the Easing control, Delete), not from an inspector section. Undo, locking and phone access SHALL remain available.

#### Scenario: First key and value edit

- **WHEN** an operator activates the toggle before the Scale label and then edits the scale value at another time
- **THEN** keys exist at both inspected times, and each completed numeric gesture is one undo step

#### Scenario: Row edit is one undo step

- **WHEN** an operator edits Y in a keyed Position row
- **THEN** keys for X and Y are written at the inspected time and one undo removes both

#### Scenario: Navigate keys

- **WHEN** an operator activates a keyframe marker on the selected clip
- **THEN** the editor seeks to that key without changing the document, and the toggles of the rows keyed there show as on

#### Scenario: Toggle sits before the label

- **WHEN** the clip inspector shows a row of animatable properties
- **THEN** its keyframe toggle precedes the row label in reading order and is unavailable while the playhead is outside the clip

#### Scenario: Unkeyed row stays static

- **WHEN** an operator edits the rotation value of a row with no keys on an otherwise animated clip
- **THEN** the static rotation changes and no rotation track is created

### Requirement: Quick trim keeps the requested side of the playhead

The editor SHALL offer trim before playhead and trim after playhead for a selected visual or audio clip. These actions SHALL keep the selected side without rippling other clips, respect frame boundaries and source-time mapping, and create one reversible edit. Out-of-range playheads, zero-length results, and locked tracks SHALL refuse mutation with legible disabled state or feedback.

#### Scenario: Keep the later portion

- **WHEN** trim before playhead is applied inside a selected clip
- **THEN** the clip starts at the playhead, ends at its previous end, and plays the same source content that previously occupied that range

#### Scenario: Keep the earlier portion

- **WHEN** trim after playhead is applied inside a selected clip
- **THEN** its prior start and source in-point are retained, its end becomes the playhead, and neighboring clips do not move

#### Scenario: Locked or invalid trim

- **WHEN** the selected clip is locked or the playhead would yield an empty range
- **THEN** no document or undo-ledger entry changes

### Requirement: User bookmarks are independent of scene markers

Editors SHALL add, rename, move, remove, and navigate named point bookmarks at arbitrary valid project times. Bookmarks SHALL persist independently of scene markers and chapters, SHALL NOT alter render duration, and SHALL support undo/redo. Removing a scene SHALL NOT silently remove a bookmark. Bookmarks beyond a shortened timeline SHALL remain recoverable and be identified as out of range.

#### Scenario: Bookmark survives scene edits

- **WHEN** an editor bookmarks a time and later deletes or resequences a scene
- **THEN** the bookmark retains its authored time and label and remains independently editable

#### Scenario: Bookmark survives reload

- **WHEN** a project containing bookmarks is saved and reopened
- **THEN** the bookmarks and navigation targets are restored without creating scene markers

### Requirement: Compound media edits commit atomically

Import-and-place, bulk placement/removal, source replacement/relinking, extract/recover audio, and keyframe gestures SHALL commit as one undoable user action over all affected project media and timeline state. Asynchronous work SHALL publish document edits only after output validation and only to its originating project and applicable source revision. Undo SHALL restore logical media membership and clip references; it SHALL NOT physically delete bytes needed by redo or other projects.

#### Scenario: Undo source replacement

- **WHEN** one replacement updates three clips and the editor issues undo
- **THEN** all three clips and project media references return to their exact prior state

#### Scenario: Pending extraction becomes stale

- **WHEN** source media changes while audio extraction is pending
- **THEN** the result is not silently applied to the changed source and the user can retry against current media

#### Scenario: Redo import and placement

- **WHEN** an editor undoes then redoes a completed file import-and-place action
- **THEN** its media identity and clips are restored together without another file upload

### Requirement: The command vocabulary is shared outside the browser

The command vocabulary and the function that executes it SHALL live in a shared library with no browser, UI framework or IO dependency. Server code SHALL be able to execute a command with the same result the editor produces.

#### Scenario: The server executes an editor command

- **WHEN** server code executes a command against a scope
- **THEN** the resulting scope and inverse are identical to what the editor produces for the same input

#### Scenario: The shared library is imported by a non-browser runtime

- **WHEN** the shared editor module is loaded in a server process
- **THEN** it loads without a DOM, React or network access

### Requirement: Command behavior is pinned by golden fixtures

Each command kind SHALL have at least one committed fixture recording an input scope, a command, the expected resulting scope and the expected inverse, as data. The command implementation SHALL pass every fixture. A fixture SHALL change only together with a deliberate change to that command's behavior.

#### Scenario: A command's behavior changes by accident

- **WHEN** an edit to the command implementation changes the result for any fixture
- **THEN** the fixture test fails and names the command kind and the fixture

#### Scenario: A new command kind is added

- **WHEN** a command kind is added to the vocabulary
- **THEN** the fixture test fails until at least one fixture for that kind exists

#### Scenario: Another implementation of the vocabulary is introduced

- **WHEN** a second implementation of the command function is built for another runtime
- **THEN** it is verified against the same fixture files, without rewriting them

### Requirement: Undo identifies steps without object identity

The undo history SHALL identify each recorded step by its own identifier, not by object identity of the command. Asking whether a given step is still the latest SHALL give the same answer for two structurally equal commands recorded as separate steps as it would for any other two distinct steps.

#### Scenario: Two identical edits are recorded

- **WHEN** the same command data is recorded twice as two steps, and an agent result asks whether its step is the latest
- **THEN** the answer refers to that agent result's own step, not the other equal one

### Requirement: Key tracks are edited through one command

The command vocabulary SHALL include the property-track replacement command defined by `keyframe-animation`, with committed fixtures for setting, replacing, clearing, and rejecting an invalid track. Inspector, key lane, and canvas key edits SHALL construct this command at the call site rather than derive it by comparing documents.

#### Scenario: Fixture round trip

- **WHEN** the track command fixture is applied and then its recorded inverse is applied
- **THEN** the resulting scope equals the fixture's input scope

### Requirement: A settled agent edit applies its executed commands once

A settled agent run that carries executed commands SHALL be applied to the editor as
one undo step built from exactly those commands, in the order the run executed them,
together with the admission of any media they place. The client SHALL apply a given
run's commands at most once: re-attaching to, polling or reloading an already-settled
run SHALL NOT apply them again.

The application SHALL be fenced against edits the user made while the run worked,
including a run this editor did not start (an MCP client's edit, another tab): such a
run SHALL carry what the document it started from contained, and the editor SHALL
fence against that. If
an entity a command touches changed in the editor since the run captured it, or if a
command is refused against the current document, nothing SHALL be written and the
result SHALL be held for the user with the reason, as a held generation result is.

#### Scenario: A settled edit is one undo step

- **WHEN** a run that shortened scene 3 and moved a text overlay settles and is applied
- **THEN** the document shows both edits
- **AND** one undo restores the document as it was before the application, and redo
  re-applies both

#### Scenario: The same result is not applied twice

- **WHEN** the editor re-attaches to a run whose settled commands it already applied
- **THEN** the document and the undo history are unchanged

#### Scenario: The user edited the same clip during the run

- **WHEN** a run's command updates a clip the user changed after the run started
- **THEN** no command from the run is applied
- **AND** the result is shown as held, naming the conflicting clip

#### Scenario: A run started outside the editor is fenced too

- **WHEN** an MCP client's edit to a clip waits for approval and the user deletes or
  changes that clip in the editor before approving
- **THEN** no command from the run is applied
- **AND** the result is shown as held, naming the conflict

#### Scenario: A command no longer applies

- **WHEN** a run's command targets a clip the user deleted while the run worked
- **THEN** no command from the run is applied and the document is unchanged
- **AND** the result is shown as held with the refusal as its reason

#### Scenario: An agent edit undoes like the same manual edit

- **WHEN** the agent changes a scene's duration and the user separately makes the same
  change by hand on an identical document
- **THEN** both record the same command and undo restores the same document

### Requirement: Caption actions and source consequences are atomic shared edits

Caption creation/import, accepted regeneration, correction gestures, timing changes, split/merge, deletion, style scope changes and linked source-edit consequences SHALL use the shared editing command boundary. Each completed user action SHALL have one exact undo/redo step across all affected cues, source clips and protection metadata. Caption actions SHALL obey track locks and applicable source/cue revision fences. Dependent changes SHALL NOT be deferred to browser-only synchronization effects.

#### Scenario: Undo a source split

- **WHEN** a source split also partitions linked captions and the editor undoes it
- **THEN** the source and every affected caption return to their exact prior state in one step
- **AND** redo restores the split and new bindings

#### Scenario: Locked linked captions

- **WHEN** a source action would modify a caption on a locked track
- **THEN** the entire source-plus-caption mutation is refused with feedback and no undo entry

#### Scenario: Correction gesture

- **WHEN** an editor completes one text correction gesture and undoes it
- **THEN** the previous cue text, word timing and edit provenance return together

#### Scenario: Server and browser parity

- **WHEN** identical caption or linked-source commands execute outside and inside the browser
- **THEN** they produce identical document state and inverse commands under committed behavioral fixtures
