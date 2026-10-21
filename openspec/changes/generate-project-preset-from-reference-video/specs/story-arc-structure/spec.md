## ADDED Requirements

### Requirement: Story Materials may provide workspace-owned story structures

The story-structure contract SHALL accept workspace-owned recipes using the same function shape as built-in arcs: label, fit guidance, ordered stable function keys, obligations, relative position windows, default emotions, midpoint key, and turn key. Shipped Story Material fixtures SHALL be able to expose built-in recipes through that shape and SHALL remain copy-on-edit.

A workspace-owned recipe SHALL be selected through Story Material rather than a new top-level Story Template entity. Its material identity owns reuse; its structured value owns planning behavior.

#### Scenario: Workspace recipe uses built-in planning vocabulary

- **WHEN** a Story Material carries a valid workspace-owned recipe
- **THEN** skeleton derivation can read its functions, obligations, windows, emotions, midpoint, and turn through the story-structure contract

#### Scenario: Operator edits a shipped recipe

- **WHEN** an operator edits structured content supplied by a fixture Story Material
- **THEN** the edit creates a user-owned Material copy
- **AND** the shipped fixture remains unchanged

### Requirement: Explicit request, Story Material, and inference have deterministic precedence

Story planning SHALL resolve structure in this order: explicit user or tool arc request, structured recipe in project Story Material, then existing inferred built-in arc and plan-kind fallback. An explicit request SHALL NOT be overridden by Material. A Material recipe SHALL NOT be overridden by automatic inference.

#### Scenario: Explicit request overrides Material recipe

- **WHEN** a project has structured Story Material and the operator explicitly requests a built-in arc
- **THEN** planning uses the explicit arc

#### Scenario: Material recipe overrides inference

- **WHEN** a project has structured Story Material and no explicit arc request
- **THEN** planning uses the Material recipe
- **AND** plan-kind defaults do not replace it

#### Scenario: Existing fallback remains available

- **WHEN** a project has no structured Story Material and no explicit request
- **THEN** planning continues to infer and default a built-in arc as before

### Requirement: Custom structure is snapshotted into durable plan state

When planning uses a Story Material recipe, the durable plan SHALL carry the complete reviewed recipe snapshot alongside each section's assigned function and obligation. Skeleton derivation, rehydration, and coverage SHALL read that snapshot instead of re-reading mutable Library Material.

Coverage SHALL apply the same countable checks to built-in and workspace-owned recipes. Existing plans carrying only a built-in arc key SHALL continue resolving and reporting through the current built-in library.

#### Scenario: Library edit cannot change existing plan

- **WHEN** a Library Story Material is edited after a plan was created from it
- **THEN** the plan retains its original recipe snapshot and coverage result

#### Scenario: Custom recipe receives coverage reporting

- **WHEN** a drafted plan uses a workspace-owned recipe
- **THEN** missing functions, ordering, midpoint, turn, and emotion coverage are reported against that recipe
- **AND** violations remain advisory as for built-in arcs
