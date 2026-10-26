# Spec Delta

## Purpose

Define reusable user-authored motion from plain text and basic shapes, with one declarative rendering contract and explicit cleanup of retired stock presets.

## ADDED Requirements

### Requirement: Visual definitions use retained primitives only

Visual element definitions SHALL use plain text or Circle, Rectangle, Triangle, Star and Cross. Star SHALL have five points. Cross SHALL be a plus sign. A reusable motion definition SHALL be user-created data containing these primitives with relative timing, layer order, styles, layout and animation. The product SHALL ship no built-in motion definitions or styled text presets.

Definitions SHALL carry a supported format version and SHALL contain no executable scripts. Unsupported versions, invalid values and unsupported primitive references SHALL be rejected before persistence. Existing compatible definitions SHALL preserve authored values when migrated to the supported format.

#### Scenario: A supported composition is saved

- **WHEN** a user saves plain text and an animated Star as a motion definition
- **THEN** the stored definition preserves their content, relative timing, layer order, styles and keyframes
- **AND** it carries the supported format version

#### Scenario: A retired preset is submitted

- **WHEN** a client submits a definition referencing a retired stock visual preset
- **THEN** the write is rejected with an actionable error
- **AND** no partial definition is persisted

#### Scenario: A newer format is submitted

- **WHEN** a definition declares an unsupported format version
- **THEN** it is refused before any existing definition is overwritten

### Requirement: User motion keeps the existing authoring lifecycle

Users SHALL be able to create motion from supported text and shape layers, preview and edit it, save it to their library, place it in a project and edit or delete its saved definition. A new workspace SHALL have no motion entries until the user creates one. Saving or deleting a definition SHALL NOT silently modify previously placed instances.

The lifecycle SHALL preserve existing save/update behavior, placement timing, animation semantics and undo behavior. Definition storage SHALL remain scoped by the existing authorization boundary. No built-in or fixture-created motion entry SHALL be offered as a user creation.

#### Scenario: Save then place motion

- **WHEN** a user saves a two-layer motion and places it at a chosen time and track
- **THEN** the instance preserves layer order and relative timing through the supported placement flow
- **AND** undo reverses the placement without deleting the saved definition

#### Scenario: Delete a saved definition

- **WHEN** a user deletes a saved motion definition
- **THEN** it disappears from Motion in both the library and editor
- **AND** previously placed instances remain unchanged

### Requirement: Retired project clips are deleted without ripple

Migration SHALL delete project clips that resolve to retired stock text or motion presets. It SHALL remove retired layers inside placed compositions and delete a placed composition clip if no layers remain. Missing or empty legacy preset IDs SHALL be classified using their old effective preset before cleanup, not converted to plain text.

Surviving clip identities, start times, durations, tracks, content, styles and keyframes SHALL remain unchanged. Surviving composition layers SHALL retain their relative times and the composition's original span. Cleanup SHALL NOT ripple the timeline, compact gaps, delete media assets or remove unrelated captions, media clips, transitions, camera motion or effects.

Migration SHALL be repeatable without additional changes after the first successful cleanup. It SHALL report counts of removed clips and layers without exposing private clip content.

#### Scenario: Remove a title between surviving clips

- **WHEN** a project contains a retired title clip between a plain-text clip and a media clip
- **THEN** cleanup removes the title clip
- **AND** the surviving clips retain their identities, start times, durations and values

#### Scenario: A composition keeps its late surviving layer

- **WHEN** a placed composition contains a retired first layer and a supported layer starting later
- **THEN** cleanup removes the retired layer without shifting the surviving layer or shortening the composition span

#### Scenario: Cleanup runs twice

- **WHEN** cleanup runs again on successfully migrated data
- **THEN** it removes nothing further and creates no additional project version

### Requirement: Saved definitions lose retired layers and empty records

Migration SHALL remove retired layers from saved user motion definitions. It SHALL preserve surviving layer values, relative timing and the stored span. A saved definition left with no supported layers SHALL be deleted. A custom variant whose sole base is retired SHALL also be deleted. A compatible custom variant based on retained text or shape primitives SHALL survive.

Definitions SHALL NOT be flattened to images, replaced with stock alternatives or reseeded after deletion. Cleanup SHALL preserve retained record identity and existing library ownership.

#### Scenario: A mixed saved motion survives

- **WHEN** a saved motion contains a retired logo preset and a supported Rectangle
- **THEN** cleanup removes the logo layer and preserves the definition and Rectangle values

#### Scenario: A saved motion becomes empty

- **WHEN** all layers in a saved motion are retired
- **THEN** cleanup deletes the saved record
- **AND** no replacement built-in entry appears

#### Scenario: A custom stock variant is retired

- **WHEN** a custom text template uses a retired styled preset as its only base
- **THEN** cleanup deletes that record instead of converting it to plain text

### Requirement: Persistence and producers cannot reintroduce retired presets

Project and template writes, agent edits, imports and restoration SHALL enforce the retained primitive contract. A historical restore SHALL apply cleanup before becoming a writable current document. Stale commands SHALL NOT resurrect retired clips through undo, replacement or synchronization. Migration SHALL remain visible through the authoritative project persistence and command feed.

New generation SHALL emit plain text with explicit supported style/layout data when on-screen text is requested. It SHALL NOT select a retired preset or depend on removed preset metadata. Loading an existing project SHALL NOT recreate clips removed by migration.

#### Scenario: A stale client replaces the document

- **WHEN** an old client submits a whole-document replacement containing a retired title after migration
- **THEN** the server refuses the incompatible write and directs the client to reload
- **AND** the cleaned head remains unchanged

#### Scenario: A historical version is restored

- **WHEN** a user restores a historical storyboard containing retired clips
- **THEN** the new current version contains only surviving supported content
- **AND** the command feed and subsequent reload observe that cleaned version

#### Scenario: Generation requests a section title

- **WHEN** a new generation run creates on-screen section text
- **THEN** it emits plain text with supported authored style and layout
- **AND** no retired visual preset is referenced

### Requirement: Primitive and composition interpretation has parity evidence

Remotion and Rust SHALL interpret the same validated primitive/composition data. Evidence SHALL cover all five shapes, plain text and user compositions at representative sizes and animation boundaries. It SHALL include saved/reloaded values, layering, transparency, zero opacity and direct seeking.

Remotion SHALL remain normal preview/export authority during this phase. Rust SHALL remain in hidden compare mode. Unsupported fonts, malformed definitions and unsupported fields SHALL not disappear silently from errors or coverage.

Plain-text composition layers SHALL apply authored weight, alignment and casing
consistently with standalone plain text. Compatible unversioned definitions SHALL
preserve stored values when normalized. Their frames MAY change where the old
packed renderer ignored these values. No legacy interpretation flag is required.

#### Scenario: A saved text layer carries authored styling

- **WHEN** a saved composition contains left-aligned, uppercase plain text with weight 900
- **THEN** packed playback applies those values as standalone plain text does
- **AND** normalization preserves the stored values without a legacy rendering branch

#### Scenario: A user composition is compared

- **WHEN** the same saved motion with plain text and a stroked Triangle is drawn at its entrance, middle and exit
- **THEN** both renderers use the same timing, layer order and authored values
- **AND** the parity gate compares the frames using the existing thresholds
