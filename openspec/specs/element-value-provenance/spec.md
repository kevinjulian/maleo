# element-value-provenance Specification

## Purpose

TBD - created by archiving change defaulter-element-provenance. Update Purpose after archive.

## Requirements

### Requirement: Every seedable element records where its value came from

The system SHALL persist, for each element that can be seeded from a defaulter, the layer that last
supplied its value and the identity of the supplying defaulter. Provenance SHALL be stored as
recorded fact, and SHALL NOT be inferred by comparing a value against a default.

The layers SHALL be a closed, ordered set: code default, workspace default, project preset, render
template, operator. Operator SHALL rank above every other layer.

An element's overridden state SHALL be derived from its recorded layer being the operator layer, and
SHALL NOT be stored as a second field that can disagree with the layer.

For fixture-backed defaulters, provenance SHALL record the local id used by that database. When fixture slug metadata is available, the system MAY also carry the immutable slug for import/export or migration resolution, but normal in-database provenance SHALL remain valid when ids differ across devices.

Provenance already recorded against a virtual built-in identity SHALL remain readable. The system SHALL resolve such a recorded identity to the fixture row through an alias from the virtual built-in identity to the fixture slug, and SHALL NOT require rewriting stored project state to keep it resolvable.

#### Scenario: A seeded element records its defaulter

- **WHEN** a preset seeds an element's value
- **THEN** the element records the project-preset layer and that preset's local identity

#### Scenario: A fixture-seeded element can resolve locally

- **WHEN** a fixture Project Preset seeds a material group
- **THEN** the element source records the local fixture preset id
- **AND** the source remains valid even if the same fixture has a different id on another device

#### Scenario: Legacy built-in provenance still resolves

- **WHEN** a project element records a virtual built-in preset identity written before fixtures existed
- **THEN** the system resolves it to the fixture preset row through the built-in alias
- **AND** the stored project state is not rewritten to make that work

#### Scenario: An operator edit records the operator layer

- **WHEN** an operator edits a seeded element
- **THEN** the element records the operator layer
- **AND** the element reads as overridden

#### Scenario: Overridden is not independently stored

- **WHEN** an element's recorded layer is read
- **THEN** its overridden state is derived from that layer
- **AND** no separate stored flag can contradict it

#### Scenario: A deliberate value equal to the default is not treated as unset

- **WHEN** an operator sets an element to a value that happens to equal the code default
- **AND** a preset is later seeded over the project
- **THEN** the operator's value is preserved, because the element records the operator layer

### Requirement: An element with no recorded source is treated as operator-owned

The system SHALL treat an element with no recorded source as carrying the operator layer.

A project persisted before provenance was recorded SHALL NOT have its values overwritten by seeding
on the strength of that absence.

#### Scenario: A pre-provenance project is seeded

- **WHEN** a project persisted before provenance existed is opened and a preset is applied
- **THEN** its existing values are treated as operator-owned and are preserved unless the operator opts in to overwriting them

#### Scenario: Absence is not backfilled

- **WHEN** a project with no recorded sources is read
- **THEN** it loads successfully with every seedable element reading as operator-owned
- **AND** no migration writes sources it cannot know

### Requirement: Seeding is decided by recorded layer, not by value comparison

Seeding SHALL fill an element only when that element's recorded layer ranks below the seeding layer.
Seeding SHALL NOT compare an element's current value against a code default to decide whether it is
unset, and SHALL NOT compare a whole axis as one unit when its elements are independently recorded.

#### Scenario: An untouched element is seeded

- **WHEN** a preset is applied to a project whose element records the code-default layer
- **THEN** the element takes the preset's value and records the project-preset layer

#### Scenario: One touched element does not freeze its neighbours

- **WHEN** an operator has overridden one element of a multi-element axis and a preset is applied
- **THEN** the overridden element is preserved and the remaining elements of that axis are seeded

#### Scenario: Agent tool output is not overwritten by a later preset

- **WHEN** an agent tool writes a seedable element during a run
- **THEN** the element records the operator layer
- **AND** a preset applied afterwards preserves it

### Requirement: Applying a defaulter replaces inherited values only

Applying a defaulter to a scope SHALL replace the values of elements whose recorded layer ranks below
that defaulter, and SHALL preserve elements recording the operator layer.

The system SHALL report, before applying, how many inherited values will be replaced and which
operator-owned elements will be preserved. Overwriting operator-owned elements SHALL require an
explicit opt-in, and SHALL NOT be the default.

#### Scenario: Applying a preset preserves operator edits

- **WHEN** an operator applies a different preset to a project carrying operator-owned elements
- **THEN** the inherited elements take the new preset's values and the operator-owned elements are unchanged

#### Scenario: The operator is told what will change

- **WHEN** the apply confirmation is shown
- **THEN** it states the count of inherited values that will be replaced and names the operator-owned elements it will keep

#### Scenario: Overwriting everything is opt-in

- **WHEN** an operator explicitly opts in to overwriting their own edits and confirms
- **THEN** every element takes the new preset's value and records the project-preset layer

### Requirement: An element can be reverted to its defaulter's value

An overridden element SHALL be revertible to the value its defaulter supplies. Reverting SHALL
restore that value and record the defaulter's layer.

Revert SHALL act on one element without disturbing other overridden elements in the same scope.

#### Scenario: Operator reverts one element

- **WHEN** an operator reverts an overridden element
- **THEN** the element takes its defaulter's current value and records that defaulter's layer

#### Scenario: Revert is scoped to the element

- **WHEN** an operator reverts one of several overridden elements in a scope
- **THEN** the other overridden elements remain overridden with their values unchanged

### Requirement: An operator value can be pushed into its defaulter

The system SHALL let an operator write an overridden element's value back into the defaulter that
would otherwise supply it. Pushing SHALL act on one element, and SHALL clear that element's override
so it reads as inherited afterwards.

Where the defaulter ships in code and is read-only, the system SHALL clone it into a writable record
and repoint the scope at the clone before writing.

Where the defaulter is shared, the system SHALL report how many other scopes will be affected before
the write.

#### Scenario: Pushing into a workspace defaulter

- **WHEN** an operator pushes an overridden element into a workspace-owned defaulter
- **THEN** the defaulter carries the new value
- **AND** the element reads as inherited from that defaulter

#### Scenario: Pushing into a builtin forks it first

- **WHEN** an operator pushes an overridden element into a defaulter that ships in code
- **THEN** the defaulter is cloned into a writable record, the scope is repointed at the clone, and the value is written there
- **AND** the shipped defaulter is unchanged

#### Scenario: Blast radius is reported

- **WHEN** a push targets a defaulter used by other projects
- **THEN** the count of affected projects is shown before the write is committed

#### Scenario: Push leaves other overrides alone

- **WHEN** an operator pushes one of several overridden elements
- **THEN** only that element's override is cleared

### Requirement: A scope can diverge from a shared defaulter without mutating it

A project SHALL be able to override an element supplied by a defaulter shared with other projects,
without changing that defaulter and without forking it.

Resolution for such an element SHALL read the project's override first, then the shared defaulter,
then the code default.

#### Scenario: Project overrides a shared defaulter's element

- **WHEN** an operator overrides an element supplied by a defaulter that other projects also use
- **THEN** this project uses the operator's value
- **AND** the shared defaulter and every other project using it are unchanged

#### Scenario: Divergence does not create a near-duplicate defaulter

- **WHEN** a project diverges from a shared defaulter
- **THEN** no copy of that defaulter is created

#### Scenario: Resolution order is override, then defaulter, then code default

- **WHEN** an element supplied by a shared defaulter is resolved
- **THEN** the project's override is used when present, otherwise the defaulter's value, otherwise the code default

### Requirement: Restoring a persisted version does not launder provenance

When a restore overwrites an element's value, the system SHALL record the operator layer for every
element it overwrites, because the restore is an operator act.

Provenance SHALL NOT be left describing values that a restore has replaced.

#### Scenario: A restored version marks what it overwrote

- **WHEN** an operator restores a persisted version whose values differ from the current ones
- **THEN** every element the restore overwrote records the operator layer

#### Scenario: Untouched elements keep their source

- **WHEN** a restore leaves an element's value unchanged
- **THEN** that element's recorded source is unchanged

### Requirement: Provenance controls use product language

The user-facing panel SHALL describe provenance through Defaults and Elements. It SHALL NOT show the word "defaulter" in panel copy. Creative Style and Project Settings SHALL omit Changed/inherited indicators and change counts, while preserving the recorded layers and all existing default actions. In Project Settings those actions SHALL be reachable beside inline fields or through their action menu rather than an element-detail body.

Actions SHALL use product verbs:

- "Change" edits the project value and makes the element changed.
- "Use default" discards the project change and makes the element inherit again.
- "Reset to shipped default" discards a project change when no source default is known.
- "Update default" writes the changed project value into a writable default source.
- "Save as custom default" creates a writable default copy when the source is built-in or read-only.

The underlying provenance behavior SHALL remain unchanged.

#### Scenario: Changed row uses product wording

- **WHEN** an element in creative Style records the operator layer
- **THEN** the row and its detail omit Changed badges/counts while retaining provenance and available default commands
- **AND** the panel does not label it "overridden", "operator", or "you" in the main scan row

#### Scenario: Operator returns to inherited value

- **WHEN** an operator opens a creative row detail or the inline Project Settings actions for an operator-owned element whose source default is known
- **THEN** the action to discard the project value is labelled "Use default"
- **AND** the action surface names the default value or default source the element will use

#### Scenario: Operator resets without a known source

- **WHEN** an operator opens a creative row detail or the inline Project Settings actions for an operator-owned element whose source default is not known
- **THEN** the action to discard the project value is labelled "Reset to shipped default"
- **AND** the panel does not promise a named default source

#### Scenario: Operator writes back to a writable default

- **WHEN** an operator opens a creative row detail or the inline Project Settings actions for an operator-owned element whose source default is writable
- **THEN** the action to write the project value into that source is labelled "Update default"

#### Scenario: Operator writes back from a built-in source

- **WHEN** an operator opens a creative row detail or the inline Project Settings actions for an operator-owned element whose source default is built-in or read-only
- **THEN** the write-back action is labelled "Save as custom default"
- **AND** the panel states that the built-in default remains unchanged

### Requirement: Row actions target the project's active default and name it

A changed element's hand-back and write-back actions SHALL target the default the project
is currently on, not the default that originally supplied that element. Recording an
operator edit replaces the element's source, so the displaced supplier's identity is not
retained and cannot be targeted.

The two actions SHALL name their destinations separately, because those destinations can
differ. A default's bundle is partial, so being on a default does not mean it carries a
value for every element:

- A hand-back SHALL return to the active default only where that default carries a value
  for that element, and SHALL return to the shipped value otherwise.
- A write-back SHALL land in the active default in either case, because it adds the
  element to that default's bundle.

The label offered for a hand-back SHALL be decided by the same rule the write uses. Where
the active default carries no value for the element, the action SHALL be labelled "Reset
to shipped default" and SHALL NOT name that default.

Each action SHALL name its own destination in visible text before the operator commits,
rather than only in a tooltip.

#### Scenario: Hand-back to a default that carries the element

- **WHEN** an operator opens a creative row detail or the inline Project Settings actions for an operator-owned element whose active default carries a value for that element
- **THEN** the hand-back is labelled "Use default"
- **AND** the action surface states that it returns to the value that default supplies

#### Scenario: Hand-back where the active default carries nothing for the element

- **WHEN** an operator opens a creative row detail or the inline Project Settings actions for an operator-owned element whose active default carries no value for that element
- **THEN** the hand-back is labelled "Reset to shipped default"
- **AND** the action surface states that it returns to the value that ships in code
- **AND** the action surface does not name the active default as the hand-back's destination

#### Scenario: The two actions can name different destinations

- **WHEN** an operator opens a creative row detail or the inline Project Settings actions for an operator-owned element whose active default carries no value for that element but can receive one
- **THEN** the hand-back names the shipped value as its destination
- **AND** the write-back names the active default as its destination

#### Scenario: Actions target the active default, not the row's former supplier

- **WHEN** an element inherited a value from one default, the operator changed it, and the project is on a different default
- **THEN** the hand-back and write-back target the default the project is on
- **AND** the action surface names that default rather than the one that originally supplied the element

#### Scenario: Inline settings preserve default actions without badges

- **WHEN** an operator opens the actions beside an edited Project Settings value
- **THEN** the same permitted reset and write-back actions are reachable without a Changed badge or element-detail body
- **AND** shared-default impact and read-only-default copying confirmations remain required before their writes
