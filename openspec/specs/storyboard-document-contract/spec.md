# storyboard-document-contract Specification

## Purpose

TBD - created by archiving change declare-storyboard-document. Update Purpose after archive.

## Requirements

### Requirement: One module owns the persisted storyboard document

The persisted video storyboard document SHALL have exactly one owning module in
`@maleo/shared`, exporting its type, a read from unknown input, and a write. Every producer
and consumer of `content_storyboards.storyboard_json` on the video path SHALL go through it.
No other module SHALL declare the document's shape, cast the blob to a local type, or read a
document field it did not obtain from the read.

#### Scenario: The agent reads the prior document through the module

- **WHEN** the agent needs the previously persisted document for a project
- **THEN** it obtains it through the shared read
- **AND** no `as` cast of `storyboard_json` to a locally-declared shape remains on that path

#### Scenario: The editor's load path reads through the module

- **WHEN** a video project is loaded
- **THEN** the document half of the payload is interpreted by the shared read
- **AND** the editor's own reader interprets only `editor_state_json`

### Requirement: Reading a persisted document never fails

The read SHALL accept any input and return a fully-populated document. Unknown input,
missing fields, values of the wrong type, and every historical spelling SHALL degrade to
that field's default rather than raising. The read SHALL NOT throw.

Documents written by three generations of the system are in production, and the write path
swallows its own failures, so a malformed document can reach storage without any signal. A
read that throws would surface that as a project which does not open.

#### Scenario: A pre-schemaVersion document loads

- **WHEN** a document with no `schemaVersion` and legacy per-type arrays is read
- **THEN** the read returns a document with those arrays interpreted into clips
- **AND** it does not throw

#### Scenario: Both historical spellings are accepted

- **WHEN** a document carries `text_overlays` in one version and `overlays` in another
- **THEN** both are read into the same field of the returned document

#### Scenario: Malformed input degrades rather than raising

- **WHEN** the read is given `null`, a string, or an object whose `clips` is not an array
- **THEN** it returns the empty document
- **AND** it does not throw

### Requirement: The read reports what it could not interpret

The read SHALL return, alongside the document, a diagnostic naming the input it could not
interpret — unrecognised keys and fields that fell back to a default. Consumers MAY ignore
it. Tolerance without a signal cannot be distinguished from correctness, so the signal SHALL
exist even where nothing yet consumes it.

#### Scenario: A known-good document reports nothing

- **WHEN** a current v2 document written by the shared write is read back
- **THEN** the diagnostic is empty

#### Scenario: An unrecognised field is reported

- **WHEN** a document carries a key the document type does not declare
- **THEN** the read returns the document
- **AND** the diagnostic names that key

### Requirement: Writing emits a total document

The write SHALL take the whole document and emit every field of it. No writer SHALL compose
a storyboard payload as a literal, and no writer SHALL carry a hand-listed set of fields
forward from a previously persisted document.

A writer that does not own a field SHALL obtain it from the prior document through the read
and supply it explicitly. Adding a field to the document type SHALL therefore fail to
typecheck in every writer that does not account for it.

#### Scenario: The agent supplies fields it does not own

- **WHEN** the agent persists a document for a project whose editor set captions, pacing
  devices or an infographic style
- **THEN** the agent reads the prior document and supplies those values to the write
- **AND** the persisted document carries them unchanged

#### Scenario: A new document field cannot be silently dropped

- **WHEN** a field is added to the document type
- **THEN** every writer that does not supply it fails to typecheck

#### Scenario: The save route stops re-attaching artifacts

- **WHEN** the editor autosaves a document for a project with a longform plan in progress
- **THEN** the saved document carries the plan's artifacts because the writer supplied them
- **AND** the save route does not re-attach them from the previous version

#### Scenario: No writer composes a payload by hand

- **WHEN** the video persistence paths are inspected
- **THEN** no writer — agent, editor, save route or caption alignment — builds a storyboard
  object literal
- **AND** no carry-forward helper enumerating field names exists in any package

### Requirement: A field belongs to the versioned document or to editor state

The system SHALL place a persisted field according to whether restoring a storyboard version
requires it. A field that must come back with storyboard version N for N to render as N
SHALL belong to the document; every other persisted field SHALL belong to editor state.

The document persists as a version — `content_storyboards` appends a row per write — so it
MUST be self-contained. Editor state persists as one overwritten cell with no history, so
losing it MUST cost only convenience.

#### Scenario: Provenance belongs to the document

- **WHEN** deciding where the entities locked for a generation persist
- **THEN** they persist in the document, because a restored version must describe what
  produced it

#### Scenario: Ambient editing state belongs to editor state

- **WHEN** deciding where the chat log, media library, saved hook takes or creative direction
  persist
- **THEN** they persist in editor state, because a restored version does not need them to
  render

### Requirement: Only the video variant is modelled

The document contract SHALL cover the video storyboard only. The `image` (`slides`) and
`text` (`posts`) variants SHALL remain opaque: their writers keep composing their payloads
and the read SHALL NOT claim their shape.

The persisted blob has no internal discriminant — `schemaVersion` appears on video documents
alone — so a variant union would have to be tagged from outside the document.

#### Scenario: A carousel project is unaffected

- **WHEN** an image project's storyboard is written or read
- **THEN** it does not pass through the document contract
- **AND** its persisted bytes are unchanged

### Requirement: No persisted-format or user-visible change

Adopting the contract SHALL NOT change the bytes written for a given document, and every
document already in storage SHALL load to the state it loads to today.

#### Scenario: Documents from every generation load unchanged

- **WHEN** a corpus of persisted documents spanning pre-`schemaVersion`, v2, both array
  spellings, and the four-bucket reference selection is loaded before and after the change
- **THEN** the resulting editor state is identical for every document in the corpus

#### Scenario: The written payload is unchanged

- **WHEN** the same document is saved before and after the change
- **THEN** the persisted payload is byte-identical

### Requirement: Reveal metadata is persisted document state

Reveal metadata for a visual clip SHALL belong to the versioned storyboard
document because restoring a storyboard version must reproduce the reveal in the
rendered video. Reading a document without reveal metadata SHALL default to no
reveal and SHALL NOT throw.

#### Scenario: Reveal survives a version round-trip

- **WHEN** a storyboard document containing a visual clip reveal is written and
  read back
- **THEN** the reveal type, direction, phase, delay, and manual duration mode are
  preserved
- **AND** the restored document renders the same reveal behavior

#### Scenario: Historical document has no reveal

- **WHEN** a storyboard document created before reveal effects is read
- **THEN** every visual clip defaults to no reveal
- **AND** the read does not report a fatal error or throw

#### Scenario: Auto reveal stores no derived duration

- **WHEN** a visual clip uses Auto reveal duration
- **THEN** the document stores the reveal as Auto rather than copying the clip
  duration into the reveal metadata

### Requirement: Scene visual reference assignments are persisted document state

Scene visual reference assignments SHALL belong to the versioned storyboard document because restoring a storyboard version must restore the reference set that produced or will reproduce each scene. Reading a document without scene visual reference assignments SHALL default to an empty assignment or the existing historical cast field without throwing.

The document read/write owner SHALL remain the single module in `@maleo/shared`. No writer SHALL hand-compose a partial storyboard payload that omits scene reference assignment fields.

#### Scenario: Scene references survive a version round-trip

- **WHEN** a storyboard document stores scene references for Anna, the office location, and the product
- **THEN** writing and reading the document preserves those reference ids in order
- **AND** a restored storyboard version regenerates against the same assigned references

#### Scenario: Historical document loads without scene references

- **WHEN** a storyboard document created before typed scene references is read
- **THEN** the read returns a valid document with no scene-specific typed assignments unless historical cast data supplies them
- **AND** it does not throw

#### Scenario: New field cannot be silently dropped

- **WHEN** scene visual reference assignments are added to the document type
- **THEN** every document writer must supply them through the shared write contract or fail typecheck

### Requirement: Scene documents store assignments, not selection hints

Storyboard scene documents SHALL continue to store ordered reference ids for scene visual reference assignments. They SHALL NOT store scene-level `selectionHint` values. Selection hints belong to Visual Material reference settings and are used to derive or suggest scene assignments before the scene document is written.

#### Scenario: Scene stores selected id only

- **WHEN** a scene auto-selects Anna because her Visual reference has `selectionHint: Anna, woman`
- **THEN** the scene document stores Anna's reference id
- **AND** it does not copy `selectionHint` into the scene

#### Scenario: Restored scene keeps explicit selection

- **WHEN** a storyboard version is restored
- **AND** the restored scene already stores Anna's reference id
- **THEN** generation uses that stored id
- **AND** it does not re-run hint matching to replace the assignment

### Requirement: A scene's duration mode is persisted document state

A scene SHALL carry an explicit duration mode of either pinned or auto. The mode
SHALL be part of the versioned storyboard document, not editor state, because
the render reads it. A scene document that does not declare a mode SHALL read as
pinned, so that every document written before this change keeps its current
timing.

#### Scenario: A pinned scene round-trips

- **WHEN** a scene with a pinned duration is written and read back
- **THEN** it reads as pinned with the same duration

#### Scenario: An auto scene round-trips

- **WHEN** a scene with an auto duration is written and read back
- **THEN** it reads as auto

#### Scenario: A document written before this change

- **WHEN** a scene document with no duration mode is read
- **THEN** the scene reads as pinned with its persisted duration unchanged

### Requirement: An auto duration follows the rendered content

A scene in auto mode SHALL take its timeline duration from its rendered speech
length plus a gap, recomputed when that speech asset changes. A scene in pinned
mode SHALL keep its duration when its speech changes, and the document SHALL
carry enough information to report that the content no longer fits.

#### Scenario: Speech renders for an auto scene

- **WHEN** speech is admitted for a scene in auto mode
- **THEN** the scene's duration is recomputed from the measured content duration

#### Scenario: Speech renders longer than a pinned scene

- **WHEN** the measured content duration of a pinned scene's speech exceeds the
  scene's duration
- **THEN** the scene's duration is unchanged
- **AND** the overflow is reportable from the persisted document

#### Scenario: Text edited before speech is regenerated

- **WHEN** the narration of an auto scene is edited and no speech has been
  regenerated
- **THEN** the scene's duration is unchanged

### Requirement: Chapters are persisted document state, and a scene names its chapter

The versioned storyboard document SHALL carry a list of chapters, each with a
stable identity, a title and an optional authored brief. A scene SHALL carry the
identity of the chapter it belongs to. A chapter's order SHALL be derived from
the position of its earliest scene and SHALL NOT be persisted, and chapter
running times, word counts and cumulative totals SHALL NOT be persisted.

Scene markers SHALL be unchanged by this: they remain one per scene and keep
their existing derived range and membership.

#### Scenario: Chapters round-trip

- **WHEN** a document carrying two chapters and scenes naming them is written
  and read back
- **THEN** both chapters read back with their identities, titles and briefs
- **AND** each scene names the same chapter it named before

#### Scenario: A chapter with no brief

- **WHEN** a chapter carrying no brief is written and read back
- **THEN** it reads back without one

#### Scenario: A chapter outlives its scenes

- **WHEN** every scene naming a chapter is removed
- **THEN** the chapter is still present in the document

#### Scenario: Order and totals are not persisted

- **WHEN** a document with chapters is written
- **THEN** no chapter order, running time, word count or cumulative total is
  emitted

#### Scenario: Markers are untouched

- **WHEN** a document with chapters is written and read back
- **THEN** its markers are one per scene, as they were before chapters existed

### Requirement: A document without chapters is seeded on read

A document carrying no chapters SHALL have them derived when it is read, and
every scene SHALL resolve to a chapter. Section provenance SHALL seed them where
it exists, runs of story beats otherwise, and a single untitled chapter when
neither does.

Seeding SHALL be a derivation, not a write: it SHALL NOT modify the scenes or
clips it read, so a document that is loaded and saved without an edit SHALL
persist exactly what it carried. Chapter membership becomes persisted state only
when an operator assigns it.

#### Scenario: Seeding from section provenance

- **WHEN** a document whose scenes carry section identifiers and no chapters is
  read
- **THEN** one chapter is derived per distinct section
- **AND** each scene names the chapter derived from its section

#### Scenario: Seeding without section provenance

- **WHEN** a document whose scenes carry story beats but no section identifiers
  and no chapters is read
- **THEN** chapters are derived from runs of consecutive scenes sharing a beat

#### Scenario: Seeding with neither

- **WHEN** a document whose scenes carry neither section identifiers nor beats
  is read
- **THEN** a single untitled chapter is derived containing every scene

#### Scenario: Reading does not dirty the document

- **WHEN** a document with no chapters is read and nothing else is done
- **THEN** the document is not reported as changed

#### Scenario: Loading and saving without an edit changes nothing

- **WHEN** a document with no chapters is read and then written back with no
  edit in between
- **THEN** what is written is what was read, scene for scene and clip for clip

#### Scenario: Existing chapters are not re-seeded

- **WHEN** a document that already carries chapters is read
- **THEN** its chapters are used as they are, and no seeding occurs

### Requirement: Generated-asset input hashes are persisted document state

A scene SHALL persist the input hash recorded when its speech and frame assets
were generated. These hashes SHALL survive the document write and read
unchanged, and SHALL be absent rather than defaulted when no asset has been
generated.

#### Scenario: Hashes round-trip

- **WHEN** a scene carrying speech and frame input hashes is written and read
  back
- **THEN** both hashes read back unchanged

#### Scenario: A scene with no generated assets

- **WHEN** a scene with no generated assets is written and read back
- **THEN** it carries no input hashes

### Requirement: Scenes generated from a sectioned plan carry their section

A scene generated from a story plan's section SHALL record that section's
identifier as its section provenance. The first scene generated from a section
SHALL additionally be marked as that section's introduction, so a chapter derived
from the run can take the section's title rather than a positional name.

Provenance SHALL be stamped where the section and the scene still exist together
— at the point the plan is flattened into scenes. It SHALL NOT be reconstructed
downstream from scene names or any other display string, because renaming a scene
would then silently regroup the video.

#### Scenario: A plan of several sections

- **WHEN** scenes are generated from a plan of four sections
- **THEN** every scene records the identifier of the section it came from
- **AND** scenes from different sections record different identifiers

#### Scenario: A section generating several shots

- **WHEN** one section generates six shots
- **THEN** all six record that section's identifier
- **AND** only the first is marked as the section's introduction

#### Scenario: Chapters follow from the provenance

- **WHEN** a document of scenes generated from four sections is read with no
  chapters
- **THEN** four chapters are derived
- **AND** each takes the title of the section it was derived from

#### Scenario: Provenance is not reconstructed from names

- **WHEN** a scene generated from a section is renamed
- **THEN** its section provenance is unchanged
- **AND** the chapters derived from the document are unchanged

### Requirement: Chapters can be re-derived on request

A document whose chapters no longer describe its scenes SHALL be able to have
them re-derived, replacing the chapters it carries with ones derived from its
scenes' current provenance.

Re-derivation SHALL happen only when it is asked for. Reading a document SHALL
NOT re-derive chapters it already carries, however degenerate those chapters look
— a document carrying chapters, including none at all, is carrying an operator's
decision, and a read is not the place to overturn it.

Because re-derivation discards authored chapter titles and briefs, the operator
SHALL be told what will be lost before it proceeds.

#### Scenario: A project frozen at one chapter

- **WHEN** a document whose scenes carry section provenance holds a single
  chapter spanning all of them, and re-derivation is requested
- **THEN** its chapters are replaced by ones derived from that provenance

#### Scenario: Reading does not re-derive

- **WHEN** a document carrying chapters is read
- **THEN** its chapters are returned as they were stored
- **AND** no chapter is derived, replaced or removed

#### Scenario: Every chapter deleted stays deleted

- **WHEN** an operator has deleted every chapter and the document is read
- **THEN** it still carries no chapters

#### Scenario: Authored titles are declared before they are lost

- **WHEN** re-derivation is requested for a document whose chapters carry
  authored titles or briefs
- **THEN** the operator is told those will be replaced
- **AND** nothing is changed until they confirm

### Requirement: Membership can be recovered for documents generated without it

A document whose scenes carry no section provenance MAY have it recovered from
the sections its plan recorded, by matching each scene's name against those
section titles. Recovery SHALL write the recovered membership onto the scenes as
their section provenance, so that every later read groups on the recorded field
rather than on the names it was recovered from.

Recovery SHALL refuse rather than guess. It SHALL produce nothing unless the
sections account for every scene exactly once, no two sections claim a scene
equally, and the scenes of each section are consecutive. A document it cannot be
certain about SHALL be left unchanged rather than partially grouped.

Recovery SHALL NOT be part of any read, and SHALL NOT be a rule any live surface
applies. Grouping a document by parsing display names would let renaming a scene
re-chapter a video; recovery is a one-time repair that replaces names with a
recorded field.

Recovery SHALL write only provenance. It SHALL NOT write, replace or remove
chapters, because a document's chapters may carry titles an operator authored.

#### Scenario: A document whose plan still names its sections

- **WHEN** a document's scenes carry no section provenance, and its plan records
  four sections whose titles account for every scene exactly once and in order
- **THEN** each scene records the section its name matches
- **AND** the first scene of each section is marked as that section's
  introduction

#### Scenario: A scene no section accounts for

- **WHEN** one scene's name matches none of the plan's sections
- **THEN** nothing is recovered for that document
- **AND** no scene is given partial provenance

#### Scenario: Sections whose scenes are interleaved

- **WHEN** the scenes matching one section are separated by scenes matching
  another
- **THEN** nothing is recovered for that document

#### Scenario: Two sections claiming a scene equally

- **WHEN** two sections have the same title and a scene matches both
- **THEN** nothing is recovered for that document

#### Scenario: Scenes that already record their section

- **WHEN** a document's scenes already carry section provenance
- **THEN** their recorded provenance is used and their names are not matched
  against anything

#### Scenario: Recovery leaves chapters alone

- **WHEN** membership is recovered for a document carrying an authored chapter
- **THEN** that chapter, its title and its brief are unchanged
- **AND** the recovered provenance is what later grouping reads

### Requirement: Stable section identity remains chapter identity

Canonical section id SHALL propagate unchanged through unit lifecycle source id, generated scene section id, and chapter id. Opaque ids SHALL replace positional ids without changing grouping behavior. Reorder SHALL NOT change chapter identity.

#### Scenario: Identified sections generate chapters

- **WHEN** approved plan sections generate scenes and timeline document
- **THEN** each scene section id and chapter id equal source section id

#### Scenario: Section reordered

- **WHEN** section is reordered before generation
- **THEN** its chapter retains same id and moves according to earliest scene

#### Scenario: Plan section round trip

- **WHEN** unit lifecycle is read by `planSectionsOf`
- **THEN** returned ids equal opaque source section ids

### Requirement: Story beat provenance reaches semantic markers

Generated clips from semantic story beat SHALL group under `SceneMarker` carrying optional stable `storyBeatId` and source revision. Numeric marker id remains valid; clip ids and range remain derived.

#### Scenario: Beat generates several clips

- **WHEN** one beat generates several timeline clips
- **THEN** marker groups them with same story beat id and revision

#### Scenario: Beat reordered

- **WHEN** beat is reordered before generation
- **THEN** marker carries unchanged beat id

### Requirement: Plan and timeline retain separate ownership

Plan edits SHALL NOT retime, delete, or rewrite timeline clips. Timeline edits SHALL NOT mutate story draft, approval, or authored beat fields. Divergence SHALL be reported through provenance and staleness rather than copy/sync.

#### Scenario: Plan edited after generation

- **WHEN** narration changes in draft
- **THEN** timeline clips remain unchanged
- **AND** affected generated media reports stale

#### Scenario: Timeline retimed

- **WHEN** generated clip moves or resizes
- **THEN** marker range follows clips
- **AND** source plan remains unchanged

### Requirement: Legacy chapters and markers remain readable

Documents lacking opaque section or beat provenance SHALL load and save without invented identifiers. Existing section ids, chapter ids, numeric marker ids, and clip grouping SHALL remain valid.

#### Scenario: Legacy document round trip

- **WHEN** legacy chapters and markers load and save
- **THEN** existing identity is preserved
- **AND** no beat id or revision is fabricated

### Requirement: Legacy text animation is read into the single animation model

The storyboard read SHALL convert legacy text overlay animation into the overlay's animation value. Key time SHALL become normalized time multiplied by the overlay's rendered duration (its duration rounded down to whole render frames), so converted keys land on the frames they rendered on before. Legacy content motion SHALL fold into the overlay's box properties: an offset becomes the box position plus the offset scaled by the box size, scale becomes box scale, rotation adds to the box rotation, and opacity multiplies the box opacity. Width/height and text style tracks SHALL map to the property of the same meaning. Old text motion MAY render differently where it relied on moving content within a fixed box, such as a background that stayed put. Malformed legacy keys SHALL degrade to no animation for that track, never a failed read, and SHALL be reported as uninterpreted. The write SHALL emit only the single animation model for text overlays and SHALL NOT emit the legacy field. Scene and visual camera motion SHALL be read and written unchanged.

#### Scenario: Legacy text animation keeps its timing

- **WHEN** a document with a text overlay carrying legacy offset, scale, opacity, size and colour tracks is read and exported
- **THEN** at every rendered frame, size, style and colour values match the pre-change export, opacity equals the old content opacity times the box opacity, and position equals the box position plus the old offset scaled by the box size

#### Scenario: Saved document drops the legacy field

- **WHEN** a legacy document is read and written back
- **THEN** its text overlays carry animation values and no legacy text animation field, and its camera motion is unchanged

#### Scenario: Malformed legacy track

- **WHEN** a legacy text animation track has non-numeric keys
- **THEN** the read returns the overlay without that track, reports it, and does not throw
