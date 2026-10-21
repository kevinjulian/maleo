# narration-writer-style Specification

## Purpose

TBD - created by archiving change add-writer-style. Update Purpose after archive.

## Requirements

### Requirement: A fixed writer style profile library

The system SHALL define a closed library of named writer style profiles in `@maleo/shared`.
The library SHALL be data, not prose: each profile SHALL carry a stable key, a display label,
narrative person, tense, sentence rhythm, concreteness guidance, a figuration level, whether the
narration addresses the viewer, an opening move, a list of forbidden prose moves, and a sentence
density expressed as sentences per hundred words. Each profile SHALL also carry a separate list
of literal forbidden phrases suitable for deterministic scanning; descriptive forbidden moves
SHALL remain prompt guidance rather than pretending to be machine-detectable.

The library SHALL be fixed rather than authored per story, because a writer style is a channel
constant whose value is consistency across many videos. Profiles SHALL NOT be named after real
authors; a profile SHALL be identified by its craft parameters so it neither imitates an
identifiable person nor degrades into pastiche.

Adding, removing, or renaming a profile SHALL be a change to this library and nowhere else. No
generation stage SHALL define its own profile vocabulary.

#### Scenario: Library is closed

- **WHEN** a caller resolves a writer style by key
- **THEN** the system returns a profile from the fixed library, or nothing when the key is unknown
- **AND** the system does not synthesize a profile that is absent from the library

#### Scenario: Profile carries craft parameters as fields

- **WHEN** a profile is read
- **THEN** person, tense, sentence rhythm, concreteness, figuration, viewer address, opening move, forbidden moves, forbidden phrases, and sentence density are available as separate fields
- **AND** none of them requires parsing a prose blob to recover

#### Scenario: Profiles are not author impersonations

- **WHEN** the library is enumerated
- **THEN** no profile key or label names a real writer

### Requirement: Writer style is selected per workspace

The system SHALL store the writer style selection as workspace configuration. A project SHALL
inherit its workspace's selection rather than carrying its own, so every video produced in a
workspace narrates in one voice.

A workspace SHALL be permitted to have no selection. An unset selection SHALL mean the absence of
a writer style, never a silently substituted default, so a workspace that has never chosen one
keeps the narration behavior it had before this capability existed.

An unknown or retired profile key stored on a workspace SHALL resolve to no writer style rather
than failing the plan.

#### Scenario: Project inherits the workspace selection

- **WHEN** a story plan is drafted in a workspace with a writer style selected
- **THEN** planning resolves that workspace's profile

#### Scenario: Unset selection changes nothing

- **WHEN** a story plan is drafted in a workspace with no writer style selected
- **THEN** no writer style layer is added to the planning prompt
- **AND** the planning word budget is computed without a sentence density adjustment

#### Scenario: Unknown key degrades to unset

- **WHEN** a workspace stores a writer style key that is absent from the library
- **THEN** planning proceeds with no writer style
- **AND** planning does not fail

### Requirement: A resolved profile compiles into the planning prompt as labelled fields

The system SHALL compile a resolved writer style profile into the story planning prompt as a
labelled craft block whose lines correspond to the profile's fields. The block SHALL be rendered
identically for a given profile on every run so the same inputs produce the same prompt.

The profile's forbidden moves SHALL be rendered into the block as an explicit prohibition.

The profile's opening move SHALL also shape the first skeleton slot's obligation before drafting.
It SHALL NOT alter later slots' arc obligations.

The compiled block SHALL govern narration text only. It SHALL NOT be routed into image prompt
composition, beat visual authoring, or speech synthesis.

#### Scenario: Craft block renders from fields

- **WHEN** a profile is compiled into the planning prompt
- **THEN** the block states the profile's person, tense, sentence rhythm, concreteness, figuration, and forbidden moves

#### Scenario: Compilation is stable

- **WHEN** the same profile is compiled twice
- **THEN** the rendered block is byte-identical

#### Scenario: Opening move shapes only the opening slot

- **WHEN** a story skeleton is built with a resolved writer style
- **THEN** slot 0's obligation includes the profile's opening move
- **AND** later slot obligations remain the arc's unchanged obligations

#### Scenario: Writer style does not reach visual authoring

- **WHEN** beat visual authoring runs for a section
- **THEN** the writer style profile is absent from the authoring inputs

#### Scenario: Writer style does not reach speech synthesis

- **WHEN** narration is synthesized
- **THEN** the writer style profile does not alter voice, provider, or synthesis parameters

### Requirement: Planning word budget accounts for sentence density

Narration synthesis inserts a breath at each sentence boundary, so two profiles that produce the
same word count at different sentence densities produce different runtimes. The system SHALL fold
a resolved profile's sentence density into the planning word budget so the planner writes toward
a target that reflects the silence its own prose style will earn.

The adjustment SHALL apply to the planning estimate only. Final timing SHALL continue to come
from measured synthesized audio, never from this estimate.

When no writer style is resolved, the budget SHALL be computed exactly as it is today.

#### Scenario: Denser prose earns a smaller word budget

- **WHEN** two profiles differ only in sentence density and the same target duration is requested
- **THEN** the profile with the higher sentence density yields the smaller word budget

#### Scenario: Estimate never replaces measurement

- **WHEN** narration audio has been synthesized and measured
- **THEN** section timing comes from the measured audio
- **AND** the writer-style-adjusted word budget does not override it

#### Scenario: No profile leaves the budget unchanged

- **WHEN** no writer style is resolved
- **THEN** the word budget equals the budget computed before this capability existed

### Requirement: Forbidden prose phrases are reported, never enforced by blocking

The system SHALL scan every initial or revised narration draft for the resolved profile's literal
`forbiddenPhrases` and SHALL report each hit against the section it occurs in. Descriptive
`forbiddenMoves` SHALL guide the drafting prompt but SHALL NOT be substring-scanned.

A forbidden-move hit SHALL be a warning surfaced for operator review. It SHALL NOT fail the plan,
mark a section failed, or prevent asset generation. Prose taste is not a correctness property,
and a plan that is blocked over a banned word costs more than the word does.

#### Scenario: Hit is surfaced on the plan

- **WHEN** initial or revised narration contains a phrase from the resolved profile's forbidden phrases
- **THEN** the plan reports the hit and the section it occurred in

#### Scenario: Hit does not block generation

- **WHEN** a plan carries forbidden-phrase warnings
- **THEN** the plan can still be approved
- **AND** asset generation proceeds

#### Scenario: No profile means no scan

- **WHEN** no writer style is resolved
- **THEN** no forbidden-phrase warnings are produced
