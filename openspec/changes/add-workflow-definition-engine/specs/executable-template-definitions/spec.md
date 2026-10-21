# Spec Delta

## MODIFIED Requirements

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

## REMOVED Requirements

### Requirement: Pilot execution and inspection share authoritative structure

**Reason**: Structure is no longer derived from TypeScript closures; the definition is the structure, and execution and inspection read the same data by construction.
**Migration**: See `workflow-definitions` — "Workflows are validated data run by one engine".

### Requirement: Required boundary coverage cannot silently disappear

**Reason**: Static source analysis of closures is deleted for planning. Coverage is enforced by load-time validation of definitions and by refusing undeclared prompts, tools and capabilities at runtime.
**Migration**: See `workflow-definitions` — "Operations run only with declared capabilities".

### Requirement: Pilot prompt recipe is the production recipe

**Reason**: Prompt recipes bound by TypeScript functions are replaced by data templates rendered by one compiler.
**Migration**: See `prompt-templates`.

### Requirement: Planning preserves current-runtime suspension and replay

**Reason**: Legacy runtime and checkpoint formats are not supported. Suspension and replay are defined per node by the engine.
**Migration**: See `workflow-definitions` — "Completed nodes are durable and never repeated" and "Suspension is a saved cursor tied to one pending action". Runs suspended before deploy end or time out.
