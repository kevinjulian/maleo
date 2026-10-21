# generated-asset-staleness Specification

## Purpose

Whether a generated frame or a generated speech clip still matches the text that produced it. Inputs are hashed when an asset is admitted and compared on read, so editing narration or a prompt is visible as staleness rather than as an asset quietly no longer matching its words. Regeneration is always an explicit, per-scene decision, because it spends credits.

## Requirements

### Requirement: Generation records the inputs that produced an asset

When speech or a frame is admitted for a scene, the system SHALL record a hash
of the inputs that produced it alongside the existing asset reference. The
speech hash SHALL cover at least the narration text, the selected speaker, and
the provider. The frame hash SHALL cover at least the visual prompt, the
references used, the seed, and the style direction.

#### Scenario: Speech is generated

- **WHEN** speech is generated and admitted for a scene
- **THEN** a hash of that generation's inputs is stored with the scene's speech
  asset reference

#### Scenario: A frame is generated

- **WHEN** a frame is generated and admitted for a scene
- **THEN** a hash of that generation's inputs is stored with the scene's frame
  asset reference

### Requirement: An asset is stale when its inputs no longer match

An asset SHALL be reported stale when the hash of the scene's current inputs
differs from the hash recorded at generation. An asset with no recorded hash
SHALL NOT be reported stale.

#### Scenario: Narration edited after speech was generated

- **WHEN** the operator edits a scene's narration after its speech was generated
- **THEN** that scene's speech asset is reported stale

#### Scenario: Visual prompt edited after a frame was generated

- **WHEN** the operator edits a scene's visual prompt after its frame was
  generated
- **THEN** that scene's frame asset is reported stale

#### Scenario: An edit that does not affect generation

- **WHEN** the operator edits a field that is not part of the recorded hash
- **THEN** the asset is not reported stale

#### Scenario: An asset generated before hashes were recorded

- **WHEN** a scene has an asset with no recorded input hash
- **THEN** it is not reported stale

### Requirement: Staleness is visible on both surfaces

A stale asset SHALL be marked in the script view on its scene's row and on the
corresponding timeline clip.

#### Scenario: A stale scene

- **WHEN** a scene's speech is stale
- **THEN** its script row is marked stale
- **AND** its timeline speech clip is marked stale

### Requirement: Regeneration is always an explicit operator action

The system SHALL NOT regenerate an asset because it became stale. Regeneration
SHALL be offered per scene and per asset kind. No action SHALL regenerate every
stale asset in a project in one step.

#### Scenario: An asset becomes stale

- **WHEN** an asset becomes stale
- **THEN** no generation is started
- **AND** a per-scene regeneration action is offered

#### Scenario: No bulk regeneration

- **WHEN** several assets in a project are stale
- **THEN** no control is offered that regenerates all of them together

### Requirement: A render reports stale assets without blocking

Starting a render with stale assets SHALL report which scenes are stale before
the render proceeds. It SHALL NOT prevent the render.

#### Scenario: Rendering with stale assets

- **WHEN** the operator starts a render while some assets are stale
- **THEN** the affected scenes are reported
- **AND** the render proceeds using the existing assets

### Requirement: Story outputs record approved beat provenance

Story speech, captions, measured voice segments, authored visual segments, and frames SHALL record source semantic beat id, source approved revision, and generation-input hash for inputs they depend on.

#### Scenario: Story speech generated

- **WHEN** speech is generated for approved beat
- **THEN** output records beat id, revision, and speech hash

#### Scenario: Story frame generated

- **WHEN** frame is generated for measured visual beat
- **THEN** output records semantic beat id, revision, and frame hash

### Requirement: Story staleness follows pinned dependencies

Narration changes SHALL stale speech, captions, measured timing, authored visuals, and frames. Voice, speaker, provider, or delivery changes SHALL stale same complete set. Visual intent, references, or style changes SHALL stale authored visuals and frames while leaving speech/captions current. Metadata absent from provider inputs SHALL stale nothing.

Reuse SHALL require matching input hash. Equal segment, beat, or image count SHALL NOT establish compatibility.

#### Scenario: Narration changes with equal count

- **WHEN** changed narration produces same number of segments
- **THEN** old speech, captions, visuals, and frames remain stale

#### Scenario: Voice changes

- **WHEN** approved voice configuration changes
- **THEN** speech, timing, authored visuals, and frames become stale

#### Scenario: Visual-only change

- **WHEN** only visual intent changes
- **THEN** authored visuals and frames become stale
- **AND** speech remains current

### Requirement: Story regeneration remains explicit and scoped

Stale story media SHALL remain previewable and renderable with warnings. It SHALL regenerate only after appropriate approval and explicit request for affected beat and asset kind. Unaffected current outputs SHALL remain.

#### Scenario: Edit without regeneration

- **WHEN** beat changes without regeneration request
- **THEN** no provider call starts
- **AND** stale media remains available

#### Scenario: Frame-only regeneration

- **WHEN** operator regenerates stale frame for approved beat
- **THEN** current speech remains unchanged
