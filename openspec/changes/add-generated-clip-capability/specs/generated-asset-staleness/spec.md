## ADDED Requirements

### Requirement: A generated clip records the brief that produced it

When a generated clip is admitted, the system SHALL record a hash of the inputs that
produced it: the brief and the theme it was generated against. Editing those inputs SHALL
make the clip visibly stale rather than leaving a clip that no longer matches its purpose.

#### Scenario: Editing the purpose makes the clip stale

- **WHEN** a clip's narrative purpose is edited after generation
- **THEN** the clip reads as stale on the surfaces that show staleness

#### Scenario: Editing the brand theme makes the clip stale

- **WHEN** the project's brand palette changes
- **THEN** clips generated against the previous theme read as stale

### Requirement: Clip staleness and bake invalidation are separate

A generated clip SHALL distinguish staleness of its composition from invalidation of its
rendered file. A change to duration, aspect or frame rate SHALL invalidate the rendered file
only and SHALL be resolved by re-rendering the stored composition. A change to the brief or
theme SHALL make the composition stale and SHALL be resolved only by regeneration.

#### Scenario: Duration change re-bakes without regenerating

- **WHEN** a slot's duration changes
- **THEN** the rendered file is re-derived from the stored composition and the clip is not stale

#### Scenario: Brief change requires regeneration

- **WHEN** a clip's brief changes
- **THEN** re-rendering the stored composition does not clear the staleness; only regeneration does

### Requirement: Clip regeneration is an explicit, scoped action

Regenerating a stale clip SHALL remain an explicit per-clip decision, because it spends
credits and produces a different composition. Staleness SHALL NOT trigger regeneration on
its own, and a render SHALL report stale clips without blocking.

#### Scenario: Stale clip does not self-regenerate

- **WHEN** a stale generated clip is opened
- **THEN** no regeneration starts until the operator asks for it

#### Scenario: Render reports rather than blocks

- **WHEN** a project containing a stale generated clip is rendered
- **THEN** the render proceeds and reports the stale clip
