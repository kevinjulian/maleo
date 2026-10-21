# story-visual-bible Specification

## Purpose

A story's visual constants — subjects with the aliases its narration uses for
them, locations, medium, lighting, palette, camera language and negatives —
recorded once at plan time and rendered identically into every beat's image
prompt. It exists because the constants used to be prose that each beat had to
restate in order to use, and restating them is how one section came to open four
consecutive shots with four different spellings of the same style lock.

## Requirements

### Requirement: A story plan carries a structured visual bible

A story plan SHALL carry a structured Story Bible recording the constants of the
story's look: subjects, locations, medium, realism, visual treatment, lighting,
palette, default mood, camera language, and negatives.

Each subject SHALL carry a stable id, a label, the aliases by which the narration
names it, visible descriptors, and anything that subject must never show. Each
location SHALL carry a stable id, a label, and descriptors.

The bible SHALL be authored once, at plan time, from the same inputs that produce
the plan. It SHALL NOT be re-authored per section or per beat.

The plan SHALL retain a prose `summary` of the bible for display and review. The
summary SHALL NOT be the source the provider prompt is compiled from.

#### Scenario: Bible authored at plan time

- **WHEN** a story plan is produced
- **THEN** the plan carries a structured Story Bible with subjects, locations, medium, lighting, palette, camera language, and negatives
- **AND** it carries a prose summary of that bible for display

#### Scenario: Bible is not re-authored per beat

- **WHEN** visuals are authored for a section's beats
- **THEN** no model call produces or revises the story's medium, lighting, palette, or negatives

#### Scenario: Subject aliases are recorded

- **WHEN** a story's narration names a recurring subject
- **THEN** that subject's bible entry records the aliases the narration uses for it

### Requirement: Bible subjects do not require materialized cast

Story Bible subjects SHALL be derivable from the story brief alone. A story whose
plan carries no planned or materialized reference entities SHALL still produce a
bible with at least one subject.

A Story Bible SHALL have two kinds of entries. Descriptive entries — the style
constants plus subjects and locations authored by the Bible model call from the
brief — carry no reference link. Reference entries SHALL be derived
deterministically, without a model call, from validated story visual direction: one
entry per distinct bound logical reference identity (`entity:<id>` or
`planned:<key>`), whose entry id derives from that identity, which records exactly
that one link, whose label and description come from the roster entity or approved
planned-reference definition, and whose aliases come from direction's alias entry
for the identity. A reference with role `location` becomes a location entry; any
other role becomes a subject entry. Beat authoring and binding coverage SHALL map a
binding to a Bible entry only by this identity, never by label.

The Bible model call SHALL receive the labels of the bound identities and SHALL NOT
author entries for them. A descriptive entry whose normalized label or alias equals
a reference entry's label or alias SHALL be removed in favor of the reference entry.

Materialization SHALL resolve a planned key through the materialization record
without rewriting the entry's link. The resolved reference description SHALL be the
locked identity at compile time; descriptors MAY add compatible visible detail but
SHALL NOT replace or contradict it. Descriptive entries SHALL remain valid without a
link, and no reference SHALL be created solely because the bible contains a subject.

#### Scenario: Story with no cast still gets subjects

- **WHEN** a story plan carries no planned reference entities
- **THEN** its Story Bible still records subjects derived from the brief
- **AND** beat authoring is given a non-empty closed subject list

#### Scenario: Bible subject linked to a planned reference

- **WHEN** direction binds a subject to a planned-reference key
- **THEN** the Bible holds one reference entry for `planned:<key>` recording that key
- **AND** compilation uses the resolved reference description as the locked identity once the key materializes

#### Scenario: Existing entity locks Bible subject identity

- **WHEN** direction binds a subject to an existing roster entity
- **THEN** the Bible holds one reference entry for `entity:<id>` recording that entity id
- **AND** compilation uses the entity's resolved description as identity authority

#### Scenario: Two bound subjects never cross-link

- **WHEN** a planned shot binds two characters whose labels resemble each other
- **THEN** each binding maps to the reference entry derived from its own identity
- **AND** no label comparison decides which entry a binding uses

#### Scenario: Model duplicate of a reference is removed

- **WHEN** the Bible model call authors a descriptive subject whose label equals a bound identity's alias
- **THEN** the descriptive subject is removed
- **AND** the reference entry for that identity remains the only entry for the subject

#### Scenario: Revision reconciles links without re-authoring

- **WHEN** a revision re-runs direction and a subject's binding changes from a planned key to a roster entity
- **THEN** reference entries are re-derived from the new direction
- **AND** no model call re-authors the bible's medium, lighting, palette, descriptive entries, or negatives

#### Scenario: Unreferenced subject remains usable

- **WHEN** a bible subject appears only as descriptive story content and needs no reusable image reference
- **THEN** the subject remains available to beat authoring without an entity id or planned key
- **AND** no reference is created solely because the bible contains the subject

### Requirement: Style constants render identically across a story's beats

The style, lighting/colour, and negative portions of a provider-facing story image
prompt SHALL be rendered from the Story Bible, byte-identical across every beat of
a story, except where a beat's authored intent supplies a mood that overrides the
bible's default mood.

Beat authoring SHALL NOT emit medium, realism, visual treatment, lighting, palette,
or negatives. A story's style constants SHALL NOT be restated inside a beat's
visual moment text.

#### Scenario: Style block is constant within a section

- **WHEN** a section's beats are compiled into provider prompts
- **THEN** the style and negative portions of every prompt in that section are identical
- **AND** they were rendered from the Story Bible rather than from authored beat text

#### Scenario: Authoring cannot restate the style

- **WHEN** beat authoring returns its result
- **THEN** the result carries no medium, realism, visual treatment, lighting, palette, or negative fields

#### Scenario: Beat mood overrides the bible default

- **WHEN** a beat's authored intent supplies a mood
- **THEN** the compiled prompt uses that mood in place of the bible's default mood
- **AND** the remaining style and negative content is unchanged

### Requirement: Story negatives compile as constraints, not as scene content

Negatives declared by the Story Bible or by a subject's must-avoid list SHALL be
compiled into the image intent's negative and constraint fields. They SHALL NOT be
carried as sentences inside the scene's visual moment text.

#### Scenario: Story negatives reach the negative field

- **WHEN** a story's bible declares negatives such as no human presence or no modern objects
- **THEN** those negatives appear in the compiled intent's negative field
- **AND** they do not appear as prose inside the scene visual moment

#### Scenario: Base negatives are not duplicated

- **WHEN** a bible negative repeats an entry the compiler already emits by default
- **THEN** the compiled prompt lists that negative once
