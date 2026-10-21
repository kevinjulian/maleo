# template-background-music Specification

## Purpose

How a timeline template decides what music plays under a video, and where that music comes from.

A template carries one background-music configuration in the same shape as its sound effects, plus a map from emotion to cue, so a nine-section documentary can shift its bed as the narrative turns instead of running one flat track throughout. An emotion's pinned asset expresses a choice; its cue expresses intent, and is resolved against the curated music library.

Covers the resolution chain and its precedence, how adjacent spans sharing a bed are merged, and the preview that lets an operator audition a cue before saving.

## Requirements

### Requirement: A timeline template declares its background music

A timeline template SHALL carry background-music configuration in the same shape it carries sound-effect configuration: a cue string describing the desired music, an optional pinned asset URL, a volume, a resolution policy, and a map from emotion to cue. The pinned URL SHALL be validated as an HTTP(S) URL or a managed relative path, matching the validation applied to sound-effect asset URLs.

Background music SHALL NOT be derived from the project brief, the planning brief, or any other free-form project text.

#### Scenario: Operator sets a default music cue

- **WHEN** an operator saves a timeline template with a music cue and no pinned URL
- **THEN** the template stores that cue, and longform videos built with that template resolve their background music from it

#### Scenario: Operator pins a specific music asset

- **WHEN** a template carries both a pinned music URL and one or more music cues
- **THEN** the pinned URL is used for every bed, and no cue is resolved against an audio provider

#### Scenario: Pinned URL is rejected when malformed

- **WHEN** a template is saved with a music URL that is neither HTTP(S) nor a managed relative path
- **THEN** the save is rejected with a validation error and the stored template is unchanged

#### Scenario: Existing template gains the fields without a migration

- **WHEN** a timeline template stored before this capability existed is read
- **THEN** it parses successfully and its music configuration takes the schema's default values

### Requirement: One template defines many background beds, one per emotion

A timeline template SHALL support a sparse map keyed by the system's fixed emotion vocabulary. Each entry SHALL carry a music cue and an optional pinned asset URL, the same pair the template's sound-effect fields carry. An emotion absent from the map, or whose entry is blank, SHALL resolve to the template's default music. An operator SHALL be able to populate only the emotions they care about without supplying the full vocabulary.

The emotion keys SHALL be fixed by the system's vocabulary rather than authored per template, so an operator chooses music for a known set of emotions and cannot introduce one the planner will never emit.

#### Scenario: Emotion present in the map

- **WHEN** a section's emotion has an entry in the template's emotion map
- **THEN** that section's bed resolves from that entry

#### Scenario: Emotion absent from the map

- **WHEN** a section's emotion has no entry in the template's emotion map
- **THEN** that section's bed resolves from the template's default music

#### Scenario: Section carries no emotion

- **WHEN** a section has no emotion recorded
- **THEN** that section's bed resolves from the template's default music

#### Scenario: Entry stored before pinned assets were supported

- **WHEN** an emotion's entry was persisted as a bare cue string
- **THEN** it is read as that cue with no pinned asset, and resolves normally

### Requirement: An emotion's pinned track wins over its cue

When an emotion's entry carries a pinned asset URL, the system SHALL use that asset for the sections it governs and SHALL NOT search the library for them. The template-level pinned URL SHALL apply to the single-bed policy and to emotions with no entry of their own, and SHALL NOT override an emotion's own pinned asset.

An emotion with a cue but no pinned asset SHALL resolve that cue against the curated library.

Pinning remains the way an operator makes an emotion's music exact. Library search narrows the gap — the beds are curated and labelled rather than drawn from an open catalogue — but a cue still expresses intent while a pin expresses a choice.

#### Scenario: Emotion has a pinned track

- **WHEN** an emotion's entry carries a pinned asset and a cue
- **THEN** the pinned asset is used and the library is not searched for that emotion

#### Scenario: Emotion has a cue only

- **WHEN** an emotion's entry carries a cue and no pinned asset
- **THEN** that cue is scored against the library and the best-matching bed is used

#### Scenario: Template-wide pin does not flatten per-emotion choices

- **WHEN** the policy is per-emotion, the template carries a pinned URL, and one emotion carries its own pinned asset
- **THEN** that emotion keeps its own asset while emotions with no entry use the template's

#### Scenario: Two emotions pinned to the same track

- **WHEN** adjacent sections resolve to the same pinned asset through different cues
- **THEN** they merge into one continuous bed

### Requirement: The default template ships a usable emotion palette

The default timeline template SHALL define a music cue for every emotion in the fixed vocabulary. Switching any template derived from it to per-emotion music SHALL therefore produce distinct beds without further configuration.

#### Scenario: Default template's palette is complete

- **WHEN** the default timeline template is read
- **THEN** its emotion-to-cue map contains an entry for every emotion in the fixed vocabulary

#### Scenario: Shipped palette does not change existing output

- **WHEN** the default template is read and its music policy has not been changed
- **THEN** the policy is still `single` and the shipped emotion map has no effect on the assembled timeline

#### Scenario: Existing stored default row picks up the palette

- **WHEN** a default template row stored before this capability existed is read
- **THEN** it carries the shipped emotion map through the schema's defaults, with no backfill

### Requirement: The plan table shows each section's emotion

The longform plan table SHALL display the recorded emotion for each section alongside its existing title, status, and narration excerpt. A section with no recorded emotion SHALL render as it did before this capability existed.

#### Scenario: Section with an emotion

- **WHEN** the plan table is emitted for a section carrying an emotion
- **THEN** that row identifies the emotion

#### Scenario: Section without an emotion

- **WHEN** the plan table is emitted for a section carrying no emotion
- **THEN** that row carries no emotion label and is otherwise unchanged

### Requirement: Per-emotion music is opt-in per template

A timeline template SHALL carry a music policy with two values. Under the `single` policy the system SHALL resolve exactly one bed for the whole video from the template's default cue or pinned URL. Under the `per_emotion` policy the system SHALL resolve a cue per section from the emotion map. The default policy SHALL be `single`.

#### Scenario: Default policy produces one bed

- **WHEN** a longform video is built with a template that has not changed its music policy
- **THEN** the timeline carries exactly one background-music bed spanning the whole video

#### Scenario: Per-emotion policy produces a bed per emotional span

- **WHEN** a longform video is built with a template whose policy is `per_emotion` and whose sections carry differing emotions
- **THEN** the timeline carries one bed per contiguous span of sections sharing a resolved cue

### Requirement: A longform section records its emotion

A longform plan section SHALL carry an optional emotion drawn from the system's fixed emotion vocabulary, emitted by the planner alongside the section's other creative fields. The field SHALL be optional so that plans created before this capability existed remain valid.

#### Scenario: Planner emits an emotion

- **WHEN** the planner returns a section with an emotion from the fixed vocabulary
- **THEN** the section stores that emotion and it is available to music resolution

#### Scenario: Planner omits or returns an unknown emotion

- **WHEN** the planner returns a section with no emotion, or with a value outside the fixed vocabulary
- **THEN** the section stores no emotion, the plan remains valid, and the section resolves to the default music cue

### Requirement: Adjacent sections sharing a cue play one continuous bed

When resolving per-emotion music, consecutive sections that resolve to the same cue SHALL be merged into a single bed spanning them, before any audio provider is consulted. The system SHALL NOT emit a separate bed per section when neighbouring sections share a cue.

#### Scenario: Consecutive sections share an emotion

- **WHEN** three consecutive sections all resolve to the same cue
- **THEN** one bed spans all three, and the track does not restart at their boundaries

#### Scenario: Non-consecutive sections share an emotion

- **WHEN** sections one and three resolve to the same cue but section two resolves to a different one
- **THEN** three beds are placed, and sections one and three do not share a single bed

#### Scenario: Beds do not overlap

- **WHEN** two adjacent beds meet at a boundary
- **THEN** the earlier bed ends before the later bed begins, and each fades at its own boundaries

### Requirement: Music cues resolve through the cached royalty-free provider path

A music cue SHALL resolve to a playable asset from the curated music library, through the same cached stock-audio lookup used for sound effects, keyed by kind and query. A pinned asset URL SHALL short-circuit the lookup. When a cue cannot be resolved, the system SHALL omit that bed rather than emit a clip with an unusable URL.

Resolution SHALL NOT consult a live third-party music search. That path was removed: it answered valid queries with an empty success roughly a quarter of the time, its free tier was not licensed for commercial output, and keyword matching over a large catalogue could not be steered toward a tone.

#### Scenario: Cue resolves to a stock track

- **WHEN** a music cue is resolved and the library is published
- **THEN** the bed carries the best-matching library asset's URL

#### Scenario: Repeated cue does not re-query the provider

- **WHEN** the same music cue is resolved again within the cache lifetime
- **THEN** the cached library is used and no new request is made

#### Scenario: Cue matches no bed well

- **WHEN** a music cue shares no terms with any bed in a non-empty library
- **THEN** the best-scoring bed is still used, because a slightly wrong bed is better than a silent span

#### Scenario: An emotion cue cannot be resolved

- **WHEN** an emotion's cue yields no bed because no library is published, but the template's default carries a pinned asset
- **THEN** that span plays the default's bed rather than falling silent

#### Scenario: No cue can be resolved

- **WHEN** a music cue and the template's default both yield nothing, no library is published, and no placeholder is configured
- **THEN** no bed is placed for that span and the rest of the timeline is assembled normally

#### Scenario: Resolved bed is long enough to cover its span

- **WHEN** the library holds both full-length beds and short ones
- **THEN** a bed long enough to hold the span is preferred, falling back to the longest available rather than refusing to place one

#### Scenario: Regeneration agrees with the original build

- **WHEN** a single section is regenerated after a full build
- **THEN** the reassembled timeline's beds are resolved by the same rules and match what a full rebuild would produce

### Requirement: An operator can audition a music cue before saving

The system SHALL expose a preview that resolves a candidate music cue against the curated library without saving the template, mirroring the existing sound-effect preview.

#### Scenario: Cue previewed

- **WHEN** an operator requests a preview for a non-empty music cue
- **THEN** the response carries the bed that cue would resolve to, or an empty result when no library is published

#### Scenario: Empty cue previewed

- **WHEN** an operator requests a preview with an empty cue
- **THEN** the response carries an empty result and the library is not searched

#### Scenario: Preview agrees with generation

- **WHEN** a cue is previewed and later resolved during generation against an unchanged library
- **THEN** both yield the same bed
