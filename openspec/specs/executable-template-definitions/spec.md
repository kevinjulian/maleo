# executable-template-definitions Specification

## Purpose

Makes the video-planning template explorer reflect the executable planning structure and prompt recipe within an explicit inspection boundary, while preserving existing approval, persistence, and resume behavior.

## Requirements

### Requirement: Pilot exposes an explicit fidelity boundary

Video planning structure, conditions and prompts SHALL be inspected from the workflow definitions and prompt templates production executes. Registered operations, named rules, facts and formatters SHALL be shown as opaque code identified by their identifier, declared contracts, prompts, tools and capabilities. The catalog SHALL NOT claim that inspecting a definition proves the internals of an operation, a helper or third-party behavior. Runtime resolution SHALL be represented separately from provenance.

#### Scenario: Owner inspects a pilot condition

- **WHEN** an owner inspects a planning branch
- **THEN** the displayed condition is the expression or rule reference in the executed definition
- **AND** request-specific values remain unresolved in the template view

#### Scenario: Owner follows a dependency outside the pilot

- **WHEN** inspection reaches a registered operation
- **THEN** its declared input, output, prompts, tools and capabilities are shown
- **AND** its body is identified as opaque code rather than derived structure

### Requirement: Catalog revisions identify inspected structure precisely

Schema 2 SHALL expose fidelity and structured pilot behavior with stable existing definition identities. Changes to executable references, exposed conditions, prompt blocks, bindings, composition, or contracts SHALL change affected content revisions. Revisions SHALL NOT imply coverage of unrepresented helper bodies or storage of historical definitions. Consumers SHALL accept schema 2 only and reject other schema versions explicitly.

#### Scenario: Executable condition changes

- **WHEN** an executable pilot condition changes without changing its display label
- **THEN** its exposed structure and affected revision change

#### Scenario: Opaque helper changes internally

- **WHEN** an opaque helper changes without changing its exposed contract
- **THEN** inspection continues to identify its opacity
- **AND** does not use an unchanged catalog revision as evidence that its implementation is unchanged

### Requirement: Inspection remains read only and private

The extended catalog SHALL retain active-instance-owner access, public definition data only, and zero execution during inspection. Catalog construction SHALL NOT evaluate request predicates, render prompts with real private inputs, perform research, start runs, generate media, write runtime state, or incur provider charges.

#### Scenario: Owner reads structured branches repeatedly

- **WHEN** an owner reads or refreshes the extended catalog with private runtime data and credentials present
- **THEN** only public definitions are returned
- **AND** no predicate requiring a run, external request, model invocation, or runtime write occurs
