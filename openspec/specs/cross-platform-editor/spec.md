# cross-platform-editor Specification

## Purpose

Keep editing behavior and portable projects consistent across every controller of the editor, starting with web and server, while preserving existing editor behavior during phased migration.

## Requirements

### Requirement: Controllers share authoritative editing behavior

The system SHALL execute admitted editor commands through one authoritative engine for web and server controllers, and any later controller SHALL bind the same engine. Identical compatible documents and commands SHALL produce equivalent documents, inverse commands and validation results. Platform presentation and IO SHALL NOT implement a second set of editing rules.

#### Scenario: An edit crosses clients

- **WHEN** each controller applies the same move or trim command to the same admitted fixture
- **THEN** resulting document and inverse are equivalent, and applying the inverse restores the prior document

#### Scenario: A binding fails

- **WHEN** a binding rejects incompatible data, encounters an execution error or is cancelled before commit
- **THEN** it returns a diagnosable failure without partially committing the document or leaking subscriptions or owned resources

### Requirement: Migration phases have evidence gates

Migration SHALL begin with a contract inventory. Runtime-binding proof and web presentation relocation SHALL each depend only on that inventory. Authoritative execution cutover SHALL depend on both. Each phase SHALL record its required proof before dependent production cutover. A binding fixture SHALL NOT count as a complete native editor.

#### Scenario: A dependent phase is considered ready

- **WHEN** production cutover for a phase is proposed
- **THEN** its predecessor exit evidence is recorded and its own implementation, tests and exercised surfaces are available for review

### Requirement: Cutover follows shadow parity

Before the shared engine becomes authoritative, production SHALL execute each committed edit through both the existing and the shared executor, apply only the existing result, and record any divergence without recording document content. Authority SHALL move only after a recorded window shows no unexplained divergence across every command type.

#### Scenario: Executors disagree during shadow execution

- **WHEN** the shared executor produces a different scope or inverse than the existing executor for a committed edit
- **THEN** the existing result is applied, the user sees no change in behavior, and the divergence is recorded with its command type and differing paths

#### Scenario: Cutover is proposed

- **WHEN** authority is proposed to move to the shared engine
- **THEN** a recorded shadow window with no unexplained divergence is available for review

### Requirement: Project exchange is versioned and lossless

Projects and commands SHALL carry deterministic compatibility information. Existing project fields, including captions, lane flags, references, materials, bookmarks, animation and compositing data, SHALL survive migration. Unsupported versions or fields that cannot be preserved safely SHALL be rejected before overwrite. Asset references SHALL use stable identities independently of device paths or transient preview URLs. Rational project/source time SHALL retain the existing time-model guarantees; legacy seconds boundaries SHALL use documented deterministic conversions.

#### Scenario: A legacy project is opened and saved

- **WHEN** a supported existing project is admitted by a migrated client and saved without changing an authored field
- **THEN** that field retains its value and absent-versus-empty semantics, and preview/export timing remains compatible

#### Scenario: An untouched value is saved

- **WHEN** a command changes one clip and the project is saved
- **THEN** every value the command did not touch, including binary-inexact seconds, serializes identically to its admitted form

#### Scenario: A field unknown to the engine is present

- **WHEN** a supported project carries a field the engine does not model
- **THEN** the field round-trips unchanged through admission, editing and save

#### Scenario: A newer project cannot be safely preserved

- **WHEN** a client encounters an unsupported schema or authored field it cannot preserve
- **THEN** it refuses a destructive save and explains the compatibility failure

#### Scenario: A project moves between devices

- **WHEN** another client opens the same project
- **THEN** its asset identities resolve through that client's asset resolver without persisting device paths, `blob:` or `data:` preview URLs

### Requirement: Successor owners preserve editor contracts

The shared engine SHALL retain applicable time, edit semantics, transaction and host-free kernel guarantees. Web-owned mechanisms SHALL retain applicable timeline surface, rendering budget, media pipeline, accessibility, overlay, keyboard and gesture guarantees. Existing VUI behavioral requirements SHALL apply to these successors after ownership migration; package distribution, external-consumer and default-theme obligations explicitly removed by this change SHALL NOT apply. Content, template and custom-element editors SHALL retain their distinct domain behavior. Existing image and text commands SHALL remain functional throughout video-core migration.

#### Scenario: A gesture is cancelled

- **WHEN** Escape, lost capture, pointer cancellation or teardown interrupts an edit
- **THEN** transient projection is discarded, committed state is restored and no undo entry is created

#### Scenario: A grouped edit is committed

- **WHEN** an action changes several linked items or properties
- **THEN** one undo restores all affected state, including normalization caused by that action

#### Scenario: Non-video editing is exercised

- **WHEN** an image or text project is edited during engine migration
- **THEN** its existing slide/post operations and undo/redo continue to work

### Requirement: Web appearance follows the current editor system

Relocated web presentation SHALL use current timeline/editor/inspector patterns, canonical controls and semantic tokens. It SHALL NOT adopt the former VUI default theme as the new appearance or copy its appearance rules into web styles. Required layout, hit-target and overlay behavior SHALL be preserved through web-owned structure and styles. Existing pane proportions, minimums, persisted sizing, phone housing, reduced-motion behavior and accessible focus/dismissal SHALL remain unless separately specified.

#### Scenario: An inspector needs styling

- **WHEN** a relocated editor presents inspector properties
- **THEN** it composes the existing approved section/row/control contracts rather than introducing VUI default appearance or a feature-local clone

#### Scenario: Default VUI CSS is removed

- **WHEN** an editor surface ceases importing VUI default styles
- **THEN** its preview, timeline and inspector retain usable geometry, controls and focus behavior at desktop, 320px and coarse-pointer landscape sizes
