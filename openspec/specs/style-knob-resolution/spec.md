# Style Knob Resolution

## Purpose

How a video's creative style reaches the deterministic director, blueprint and render layers. A style is a plain value object of knobs carried on a content preset, never an identifier resolved against a registry, so resolution stays synchronous and side-effect free and an operator-authored style behaves exactly like a shipped one.

## Requirements

### Requirement: Style knobs are data, not a code registry

A style SHALL be a plain value object of creative knobs — pacing, average scene duration, camera intensity, transition intensity, text density, sfx density, music mood, music description, voice speed, colour mood, and an optional transition system — carried inside a content preset's bundle. The system SHALL NOT require a style to be registered in code before it can be used, and SHALL NOT expose a registry lookup as the way a caller obtains a style.

#### Scenario: An operator-authored style drives a render

- **WHEN** a content preset carries knob values that match none of the nine shipped builtins
- **THEN** the director, blueprint, and render-storyboard layers resolve camera moves, transitions, music mood, and pacing from those knob values, with no lookup against a known-style list

#### Scenario: A knob set is validated on save

- **WHEN** a preset is saved with a knob value outside its allowed range or with an unknown music mood
- **THEN** the save is rejected with a validation error naming the offending field

### Requirement: Resolvers receive knobs, not an identifier

The director, blueprint, transition, and render-storyboard resolvers SHALL accept a resolved knob object as a parameter. They SHALL NOT accept a style identifier and SHALL NOT perform a lookup to obtain knobs. Resolution SHALL remain synchronous and free of IO so it can run inside pure document-building code.

#### Scenario: A resolver runs with no style

- **WHEN** a resolver is called with no knob object
- **THEN** it returns its input unchanged (director) or falls back to its documented defaults (blueprint, render storyboard), exactly as it does today when no style is selected

#### Scenario: Resolution performs no IO

- **WHEN** any of the director, blueprint, or render-storyboard resolvers is called
- **THEN** it completes synchronously without reading a database, filesystem, or network, so a caller inside document-building code needs no await

### Requirement: Style-specific behaviour is expressed as knobs, never as an identifier comparison

No resolver SHALL branch on a style's name or identifier. Behaviour that today is reachable only by one named style — the paper-thread section-transition motif, its reusable plates, and the per-scene section transitions derived from them — SHALL be expressed as knob data, so any preset can opt into it.

#### Scenario: A custom preset opts into section transitions

- **WHEN** an operator sets a transition system on a preset that is not the shipped explainer-essay builtin
- **THEN** the blueprint emits the transition system's motif and plates, and derives per-scene section transitions from scene visual types, exactly as the shipped builtin does

#### Scenario: A preset with no transition system

- **WHEN** a preset carries no transition system
- **THEN** the blueprint emits no transition system and preserves any section transitions the source scenes already carried

### Requirement: Persisted style identifiers are migrated, not resolved at read time

No identifier-to-knobs table SHALL survive this change. Every stored style identifier SHALL be converted to a knob object by a one-time backfill, and the conversion table SHALL be deleted once the backfill reports no identifiers remaining. The system SHALL NOT retain a fallback lookup for identifiers it failed to migrate.

Reading a document is never allowed to fail on this, so a style value that is not a knob object SHALL be read as no style, reported as unresolved, and SHALL NOT throw.

#### Scenario: A migrated project loads

- **WHEN** a project whose style identifier was converted by the backfill is opened
- **THEN** it carries the knob values that identifier represented before the change, and directs and renders as it did previously

#### Scenario: The backfill gates deletion

- **WHEN** the backfill reports any stored style identifier it could not convert
- **THEN** the conversion table is retained and the deletion step does not proceed

#### Scenario: An unconverted value is read after deletion

- **WHEN** a persisted style value is a string rather than a knob object
- **THEN** the read succeeds with no style applied and the document reports the value as unresolved, rather than throwing or silently substituting a default style

#### Scenario: A blueprint no longer overrides the project's style

- **WHEN** a stored blueprint carries a style identifier field
- **THEN** the field is ignored and the style resolved from the project's own knobs is used, because the blueprint's identifier field is removed from the schema

### Requirement: The chat agent receives knobs and a described style, never an identifier

The context handed to the chat agent SHALL carry the resolved knob object and a rendered style directive naming the style and describing it. It SHALL NOT carry a style identifier, and no prompt sent to a planning model SHALL contain a bare style identifier, so the model's planning depends only on stated creative direction and not on what it associates with a style's name.

No agent tool SHALL select a style. Style selection is an operator action.

#### Scenario: The planner prompt describes the style

- **WHEN** a video is planned for a project with a style applied
- **THEN** the prompt states the style's name, description, pacing, scene duration, colour mood, and music description, and contains no bare style identifier line

#### Scenario: An operator-authored style plans correctly

- **WHEN** a video is planned for a project whose style came from an operator-authored preset that matches no shipped builtin
- **THEN** the planner receives the same fields it would for a builtin, and the resulting plan honours the style's pacing and emotional direction

#### Scenario: Server-side direction uses the job's knobs

- **WHEN** an agent job resolves transitions, enriches a blueprint, or normalises a plan
- **THEN** it reads the knob object carried on the job, and no code path looks up a style by identifier
