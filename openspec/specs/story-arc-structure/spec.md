# Story Arc Structure Specification

## Purpose

Define the library of named story arcs, how a plan selects one, and how each section carries its job in that arc — the ordered functions, their obligations, their position windows, and the emotions they default to. Narrative coverage is verified by counting and reported for review, never enforced before provider submission.

## Requirements

### Requirement: A story arc library defines ordered narrative functions

The system SHALL define a library of named story arcs in `@maleo/shared`. Each arc SHALL specify
its ordered functions, and for each function an obligation stating what that part of the story must
do, a position window expressed as a fraction of total runtime, and a default emotion.

The library SHALL be data rather than prompt prose, so section shaping is derived by computation
in the same way `storyDensityFor` derives section count and word budget.

The library SHALL include `three_act`, `story_circle`, `seven_point`, `fichtean`, and
`pov_lifecycle`. `pov_lifecycle` SHALL carry the existing embodied POV lifecycle stages and
chapter functions as its function vocabulary, so POV planning gains an explicit selector rather
than a second structure.

#### Scenario: Arc specifies ordered functions with obligations

- **WHEN** an arc is read from the library
- **THEN** it yields its functions in canonical order
- **AND** each function carries an obligation, a position window, and a default emotion

#### Scenario: POV lifecycle is an arc

- **WHEN** the `pov_lifecycle` arc is read
- **THEN** its functions are the embodied POV lifecycle stages and chapter functions
- **AND** they are not defined anywhere outside the arc library

### Requirement: The planner selects the arc, with explicit override

The story plan SHALL carry the selected arc. The planner SHALL infer the arc from the brief and
plan kind unless a caller explicitly requests one, matching how `structure` and `planKind` already
resolve: an explicit request wins at any duration, and `auto` defers to inference.

Each `planKind` SHALL carry a default arc used when inference produces nothing usable.

An explicitly requested arc SHALL NOT be overridden by inference, duration, or plan kind.

#### Scenario: Planner infers an arc

- **WHEN** a brief is planned with no arc requested
- **THEN** the plan carries an arc chosen by the planner

#### Scenario: Explicit request wins

- **WHEN** a caller requests a specific arc
- **THEN** the plan carries exactly that arc
- **AND** neither inference, duration, nor plan kind changes it

#### Scenario: POV is selectable for any brief

- **WHEN** a caller requests `arc: "pov_lifecycle"` for a brief containing no POV topic words
- **THEN** the plan carries the POV lifecycle arc

#### Scenario: Plan kind supplies a default

- **WHEN** arc inference yields nothing usable
- **THEN** the plan carries the requested plan kind's default arc

### Requirement: Sections carry a positional chapter function

Each section SHALL carry a `chapterFunction` naming its job in the selected arc, drawn from that
arc's function vocabulary. The field SHALL keep the name it already has on embodied POV sections;
only its vocabulary source changes, from a hardcoded POV list to the selected arc.

A section's chapter function SHALL be distinct from the timeline chapter that contains it. A
chapter is a container with a span and a title; a chapter function is the narrative job the
container holds. Adding chapter functions SHALL NOT change how timeline chapters are derived,
ordered, or ranged.

#### Scenario: Section carries its arc function

- **WHEN** a plan is drafted with an arc
- **THEN** each section carries a `chapterFunction` from that arc's vocabulary

#### Scenario: Timeline chapters are unchanged

- **WHEN** chapter functions are assigned to sections
- **THEN** timeline chapter identity, ordering, and ranges are derived exactly as before

#### Scenario: Function vocabulary follows the arc

- **WHEN** two plans use different arcs
- **THEN** each plan's chapter functions come from its own arc's vocabulary

### Requirement: Section emotion defaults from its arc function

Each section's `emotion` SHALL default to its arc function's default emotion, so the emotional
arc — which selects background music — follows the narrative arc rather than being picked freely
per section.

The planner SHALL be permitted to override a section's default emotion when the section warrants
it. The default SHALL apply only where no deliberate choice was made.

#### Scenario: Emotion follows the arc by default

- **WHEN** a plan is drafted and no section emotion is deliberately chosen
- **THEN** each section's emotion equals its arc function's default emotion

#### Scenario: Deliberate emotion survives

- **WHEN** the planner chooses a section emotion that differs from its function default
- **THEN** the chosen emotion is kept

### Requirement: Narrative coverage is verified by counting

The system SHALL verify a drafted plan against its arc and SHALL report violations, using
countable checks rather than model judgment, in the same manner as story beat coverage.

The verified invariants SHALL be: every required arc function is present at least once; functions
appear in the arc's canonical order; the midpoint function falls inside its position window as a
fraction of estimated runtime; the section mapped to the engagement turn is the section carrying
the arc's turn function; and the emotional arc carries at least three distinct emotions.

Violations SHALL be reported against the plan with enough detail to act on without opening the
run. They SHALL surface for operator review and SHALL NOT block asset generation, because a plan
whose pacing is arguable is not a plan that is wrong.

#### Scenario: Missing function is reported

- **WHEN** a drafted plan omits a required arc function
- **THEN** the plan reports the missing function

#### Scenario: Out-of-order functions are reported

- **WHEN** arc functions appear out of canonical order
- **THEN** the plan reports the ordering violation

#### Scenario: Misplaced midpoint is reported

- **WHEN** the midpoint function falls outside its position window
- **THEN** the plan reports the position violation with the observed fraction

#### Scenario: Unfulfilled turn is reported

- **WHEN** the engagement turn does not map to the section carrying the arc's turn function
- **THEN** the plan reports that the turn is unfulfilled

#### Scenario: Flat emotional arc is reported

- **WHEN** a plan's sections carry fewer than three distinct emotions
- **THEN** the plan reports a flat emotional arc

#### Scenario: Coverage violations do not block generation

- **WHEN** a plan carries narrative coverage violations
- **THEN** the plan can still be approved
- **AND** asset generation proceeds

### Requirement: The arc and its functions are reviewable

The story plan SHALL present the selected arc and each section's chapter function and obligation,
so an operator reviewing a plan sees what each section is for rather than a list of structurally
identical rows.

#### Scenario: Plan table shows the arc

- **WHEN** an operator reviews a story plan
- **THEN** the plan reports the selected arc
- **AND** each section row shows its chapter function and obligation
