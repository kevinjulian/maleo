## ADDED Requirements

### Requirement: Reference-video analysis starts from a constrained source

Library > Project Presets SHALL offer `Generate from video` as a full-page creation flow. The flow SHALL accept a canonical YouTube watch or share URL, normalize it to a video id and HTTPS URL, and SHALL reject arbitrary hosts, playlists without one selected video, malformed ids, and non-HTTPS sources before network access.

A YouTube URL SHALL identify and embed the source but SHALL NOT by itself authorize media or caption download. Analysis SHALL become ready only when it has a timestamped transcript and, for frame or cadence analysis, frame-readable media supplied through an authorized source or operator upload. The system SHALL NOT scrape captions, download arbitrary YouTube media, import browser cookies, or expose a generic remote-media fetch endpoint.

#### Scenario: Valid YouTube URL becomes source identity

- **WHEN** an operator submits a supported YouTube watch or share URL
- **THEN** the flow stores its normalized video id and canonical HTTPS URL
- **AND** displays source readiness separately for transcript and frame-readable media

#### Scenario: Arbitrary URL is rejected without fetching

- **WHEN** an operator submits a URL whose host or video id is unsupported
- **THEN** validation rejects it before any server-side outbound request

#### Scenario: URL lacks analyzable source data

- **WHEN** source metadata is available but no authorized timestamped transcript or frame-readable media is available
- **THEN** the flow retains source identity and embedded playback
- **AND** requests SRT, VTT, timestamped text, local video, or timestamped screenshots for the missing capability

### Requirement: Analysis progress and review state are durable

Starting analysis SHALL create a workspace-scoped import with durable status, phase, progress, revision, source identity, review snapshot, error state, and timestamps before provider work begins. Reloading the page SHALL restore transcript-derived structure, measurements, review edits, and selected-frame metadata from the latest persisted revision.

The full local video SHALL NOT be persisted. After reload, the flow SHALL mark local frame media disconnected and SHALL permit the operator to reselect it without losing other review work. A stale or abandoned running analysis SHALL become a recoverable error rather than remain running forever.

#### Scenario: Page reload restores review work

- **WHEN** an operator reloads after analysis or after editing the generated recipe
- **THEN** the latest persisted structure, template draft, evidence, confidence, and edits are restored
- **AND** the operator is not required to run analysis again

#### Scenario: Local media must be reconnected

- **WHEN** an import is restored after its browser-selected video file is no longer available
- **THEN** transcript and review state remain available
- **AND** frame controls request the local source file again before another frame is captured

#### Scenario: Stale edit conflicts

- **WHEN** a review edit names an import revision older than persisted canonical state
- **THEN** the write is rejected as a revision conflict
- **AND** the client reloads canonical review state instead of overwriting it

### Requirement: Story analysis produces transferable structure with evidence

Transcript analysis SHALL produce an editable structure containing a name, fit guidance, ordered stable function keys, human-readable labels and obligations, relative position windows, default emotions, midpoint function, and turn function. Each inferred function SHALL carry source timestamp evidence and confidence in the import draft.

Reusable structure SHALL describe transferable narrative grammar. It SHALL NOT contain copied transcript passages, source creator/channel identity, source branding, or instructions to imitate recognizable identity. A deterministic overlap and named-identity check SHALL report blocking violations before finalize.

#### Scenario: Structure explains each chapter job

- **WHEN** transcript analysis succeeds
- **THEN** the Structure step shows every inferred function in order with its obligation, relative window, evidence timestamps, and confidence
- **AND** activating evidence seeks source playback to that timestamp

#### Scenario: Operator corrects generated logic

- **WHEN** an operator edits, reorders, adds, or removes a structure function
- **THEN** the visible structure timeline updates from that reviewed value
- **AND** finalize uses the reviewed value rather than the original inference

#### Scenario: Source wording is copied

- **WHEN** generated reusable structure contains a prohibited transcript overlap or named imitation instruction
- **THEN** the flow identifies the blocking content
- **AND** does not permit finalize until the content is edited or regenerated

### Requirement: Operator selects exact source frames

The Frames step SHALL keep source playback and timestamp visible, support seeking with pointer and keyboard, offer suggested frame candidates, and let the operator add the current frame. It SHALL support multiple selected frames and SHALL show timestamp, preview, selected state, role, and removal control for each one.

Frames selected from local video SHALL be captured at the displayed source timestamp. A timestamped screenshot MAY be used when local video is unavailable. Suggested frames SHALL remain drafts and SHALL NOT create Reference entities merely because analysis found them.

#### Scenario: Operator captures current frame

- **WHEN** an operator seeks local source video to a timestamp and activates `Use current frame`
- **THEN** the displayed frame is added to selected frames with that source timestamp
- **AND** no workspace Reference entity is created before finalize

#### Scenario: Operator selects several style frames

- **WHEN** an operator selects multiple frames without changing their roles
- **THEN** every selected frame defaults to the existing `style` role and style reference use
- **AND** all selected frames remain independently removable

#### Scenario: Product frame cannot be inferred automatically

- **WHEN** analysis suggests frames containing a product
- **THEN** none is assigned the `product` role automatically
- **AND** only an explicit operator role change may make a selected frame a Product reference

### Requirement: Video Template inference distinguishes evidence from defaults

The analysis SHALL create a valid ordinary Video Template draft. Fields derived from measurable source behavior SHALL be labeled `inferred` and carry evidence or confidence. Fields not supported by source evidence SHALL use current Video Template defaults and SHALL be labeled `defaulted`. Operator edits SHALL be labeled `changed`.

Initial inference SHALL be limited to supported measurable behavior such as visual-change cadence, dominant transition family, section-gap estimate, and chapter-title policy when confidence meets a documented threshold. The system SHALL NOT claim to extract music, SFX, or other unobservable policy from transcript or sparse still frames.

#### Scenario: Unsupported audio policy stays defaulted

- **WHEN** analysis has no reliable evidence for music or SFX policy
- **THEN** the template draft uses current defaults for those fields
- **AND** labels them `defaulted` rather than `inferred`

#### Scenario: Operator fine-tunes template

- **WHEN** an operator changes an inferred or defaulted field through advanced settings
- **THEN** the review summary shows the resulting value as `changed`
- **AND** the saved ordinary Video Template contains that value

#### Scenario: No frame-readable media is supplied

- **WHEN** an import has a transcript but no local video measurements
- **THEN** story-structure review remains available
- **AND** the Video Template remains a valid defaulted draft without fabricated cadence evidence

### Requirement: Review flow exposes logic without adding required decisions

The builder SHALL present Structure, Frames, Video Template, and Save as visible ordered steps. Structure SHALL open first after analysis. Generated values SHALL be usable without edits, while every reusable structural decision and selected frame remains inspectable before Save.

Desktop SHALL retain source context beside current review content. Mobile SHALL use a single-column layout, collapsible source player, two-column frame candidates, and one reachable sticky action bar. Source seeking, step navigation, frame selection, structure ordering, and finalize SHALL be keyboard reachable and carry accessible labels and state.

#### Scenario: Happy path remains short

- **WHEN** an operator accepts generated Structure and Video Template values
- **THEN** the required actions remain paste URL, provide any missing authorized source input, analyze, select frames, and save
- **AND** no advanced template control must be opened

#### Scenario: Mobile frame selection stays reachable

- **WHEN** an operator selects frames on a narrow viewport
- **THEN** source playback, selected count, frame candidates, and next action remain reachable without horizontal page scrolling

### Requirement: Finalize creates one complete Project Preset atomically

Finalize SHALL validate current import revision, completed analysis, record names, structured Story Material, valid Video Template, selected frame roles, managed frame images, and explicit rights confirmation. It SHALL create or reuse frame Reference entities, create Story and Visual Material records, create one Video Template, and create one Project Preset naming those Material and Video Template identities in one server-owned finalize operation.

The operation SHALL be atomic for database records and idempotent for a finalized import. A failed finalize SHALL leave no partial Material, Video Template, Reference entity, or Project Preset rows. Repeating finalize after success SHALL return the recorded output identities without creating duplicates.

#### Scenario: Complete import is finalized

- **WHEN** an operator confirms rights and saves a valid reviewed import
- **THEN** one Project Preset is created from the generated Story Material, Visual Material, and Video Template identities
- **AND** each selected frame resolves through a canonical workspace Reference entity named by Visual Material

#### Scenario: One output write fails

- **WHEN** any record write fails during finalize
- **THEN** all database writes from that finalize are rolled back
- **AND** retry can safely create the complete output later

#### Scenario: Finalize is repeated

- **WHEN** the same finalized import is submitted again
- **THEN** the API returns its previously recorded output identities
- **AND** no duplicate library records are created

### Requirement: Analysis and frame persistence require explicit rights confirmation

Before processing operator-supplied transcript or media, the flow SHALL require confirmation that the operator may analyze the source. Before persisting selected frames, finalize SHALL require confirmation that the operator may save and reuse those images. The confirmation and source identity SHALL be recorded without presenting Maleo as granting those rights.

Provider prompts, application logs, and errors SHALL exclude unnecessary source identity, transcript bodies, frame bytes, cookies, credentials, and signed media URLs.

#### Scenario: Analysis rights are not confirmed

- **WHEN** an operator has not confirmed authority to analyze supplied transcript or media
- **THEN** provider analysis does not begin

#### Scenario: Frame rights are not confirmed

- **WHEN** selected frames exist but reuse rights are not confirmed
- **THEN** finalize is blocked
- **AND** no selected frame is persisted as a workspace Reference entity
