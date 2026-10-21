# executable-template-definitions Specification

## Purpose

Makes the video-planning template explorer reflect the executable planning structure and prompt recipe within an explicit inspection boundary, while preserving existing approval, persistence, and resume behavior.

## Requirements

### Requirement: Pilot exposes an explicit fidelity boundary

The pilot SHALL cover the `plan_story` workflow's guard, direction, clarification, and planning stages, including meaningful planning calls, branching conditions, prompt assembly, and applicable repair/retry paths. The catalog SHALL distinguish executable-derived structure, declared documentation outside the pilot, opaque implementations, and values resolved at execution. It SHALL NOT claim that inspecting a template proves arbitrary helper logic or third-party behavior. Runtime resolution SHALL be represented separately from provenance.

#### Scenario: Owner inspects a pilot condition

- **WHEN** an owner inspects a planning condition
- **THEN** the displayed structured condition and possible continuations come from the condition used during execution
- **AND** request-specific values remain unresolved in the template view

#### Scenario: Owner follows a dependency outside the pilot

- **WHEN** inspection reaches an unmigrated helper, shared implementation, or third-party service
- **THEN** the boundary and its fidelity are explicit
- **AND** the parent workflow does not imply that the implementation's internals are fully derived

### Requirement: Pilot execution and inspection share authoritative structure

Stage order, meaningful operation references, branching, approval actions, and prompt invocations inside the pilot boundary SHALL be projected from the structures execution consumes. Editing those structures SHALL update inspection without requiring an independently maintained list of dependencies or behavioral conditions. Human-authored labels SHALL NOT determine or certify execution behavior.

#### Scenario: Developer changes a branch target

- **WHEN** a developer changes a pilot branch's executable operation reference
- **THEN** the projected relationship changes to that operation
- **AND** no catalog-only relationship edit is necessary

#### Scenario: Branch is not taken for a particular request

- **WHEN** a request skips a conditional operation
- **THEN** the template still shows the possible operation with its executable condition
- **AND** does not present it as work that occurred in that request

### Requirement: Required boundary coverage cannot silently disappear

Unmapped in-scope tool or prompt calls, unresolved operation references, and unsupported structural constructs SHALL fail pilot validation. A developer SHALL NOT obtain a complete-fidelity claim by marking a required in-scope call opaque or by adding an informational wrapper around otherwise unrestricted execution. Opaque exclusions SHALL be explicit and limited to the declared inspection boundary. Invalid catalog construction SHALL NOT disable existing execution safety checks or publish invented relationships.

#### Scenario: Developer adds an unregistered prompt call

- **WHEN** a pilot owner introduces a direct or indirect application prompt invocation that bypasses the executable definition boundary
- **THEN** the scoped verification gate fails and identifies the offending owner or call path

#### Scenario: Instrumented callback hides an additional operation

- **WHEN** an operation body invokes another required pilot operation without a structural reference
- **THEN** verification fails even when the outer operation has an identifier

### Requirement: Pilot prompt recipe is the production recipe

Pilot prompt definitions SHALL expose the fixed blocks, ordered composition, variable bindings, defaults, omission conditions, transforms, and response contract used by production rendering. Optional and corrective prompt paths SHALL use the same definitions. Existing supported inputs SHALL produce the same request text and response validation as before migration. A synthetic fixture or template SHALL NOT be labeled as a submitted request.

#### Scenario: Optional guidance is omitted

- **WHEN** a pilot prompt input has no optional language or material guidance
- **THEN** production rendering and inspection use the same omission condition and fallback
- **AND** parity verification compares the complete rendered request with the pre-migration result

#### Scenario: Research and voice guidance affect different inputs

- **WHEN** planning contains Story, Visual, Voice, and Rules guidance
- **THEN** the existing research-topic separation and material ordering are preserved
- **AND** inspection shows those same bindings and composition order

### Requirement: Planning preserves current-runtime suspension and replay

Planning SHALL retain its public entry point, stage identifiers, pending action identities, checkpoint formats, completed-stage replay keys, project scope, and approval/cancellation semantics. A current-runtime suspended run SHALL resume after restart using its held data without repeating completed frame or research work. No pilot execution SHALL generate media merely to prove inspection parity. Legacy catalog or prior-runtime snapshot compatibility is outside scope because the product has no real users yet.

#### Scenario: Restart while awaiting post-research input

- **WHEN** a current-runtime run is suspended after research and resumes after restart
- **THEN** its answer reaches drafting in the same run and action context
- **AND** completed frame and research calls are not repeated

#### Scenario: Restart while awaiting clarification

- **WHEN** a run suspended by the pilot resumes after restart under the current runtime
- **THEN** its checkpoint and pending action remain readable
- **AND** no already settled tool effect or charge is duplicated

#### Scenario: Approved-plan replacement is rejected

- **WHEN** a user rejects replacement of an approved plan
- **THEN** the approved plan remains unchanged and subsequent planning model calls do not occur

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
