# agent-template-catalog Specification

## Purpose

Makes deployed AI workflow, tool, internal-operation, and prompt definitions inspectable through the Maleo backend before execution, without granting access to project content or exposing credentials.

## Requirements

### Requirement: Instance owners can read the deployed template catalog

The Maleo backend SHALL provide a read-only template catalog at `GET /api/admin/agent-templates` to active instance owners. Catalog reads SHALL require no workspace membership, project selection, configured AI provider, or AI-provider API key supplied by the requesting user. Other callers SHALL receive the existing authentication or instance-owner refusal without catalog content.

#### Scenario: Owner reads without a provider or workspace

- **WHEN** an active instance owner with no workspace membership requests the catalog and AI providers are unconfigured
- **THEN** the backend returns the deployed template definitions
- **AND** no AI request or provider readiness probe occurs

#### Scenario: Member requests definitions directly

- **WHEN** a signed-in member requests the catalog endpoint
- **THEN** the backend returns `403` without template definitions

#### Scenario: Caller loses access

- **WHEN** a caller is unauthenticated, suspended, or uses a revoked session
- **THEN** the existing authentication and account-status enforcement denies the catalog request
- **AND** no catalog content is returned

### Requirement: Catalog distinguishes executable workflows and stage profiles

The catalog SHALL expose all deployed built-in agent workflows and stage profiles with stable identities and their runtime associations. A workflow SHALL describe its actual executable entry point and step order. A stage profile SHALL be identified as a profile, not presented as an independently callable workflow when none exists. Runtime-generated framework tool names and internal tool names SHALL be distinguished. Retired carousel and thread workflows, tools, profiles and agent instructions SHALL NOT appear.

#### Scenario: Inspect video planning and generation

- **WHEN** an owner inspects video workflow definitions
- **THEN** planning and asset generation appear as separate executable workflows
- **AND** planning shows its guards, direction routing, clarification, and planning steps
- **AND** the associated plan and generation stage profiles are inspectable without implying planning immediately generates media

#### Scenario: Inspect edit profile

- **WHEN** an owner inspects the edit stage profile
- **THEN** the catalog shows its stage contracts and association with individually gated edit tools
- **AND** it does not invent an agent-callable edit workflow

#### Scenario: Inspect thread entry point

- **WHEN** an owner looks for thread drafting
- **THEN** the catalog lists no thread-build workflow entry or internal text-drafting tool, because thread drafting is retired

#### Scenario: Retired content types are absent

- **WHEN** an owner browses workflows, tools and instructions
- **THEN** no carousel or thread workflow, slide or post tool, carousel or thread profile, or image or text agent instruction is listed

### Requirement: Flow relationships show gates conditions and repeated work

Definitions SHALL distinguish execution order, conditional execution, containment, prompt use, and tool availability. They SHALL explain applicable approval and clarification outcomes, repeated work, reuse, and retry/repair behavior. Runtime-dependent decisions SHALL be labeled as conditional rather than represented as outcomes that always occur. Descriptions SHALL agree with the deployed execution behavior.

#### Scenario: Carousel approval branch

- **WHEN** an owner looks for carousel generation
- **THEN** no carousel workflow, approval branch or per-slide image work is listed, because carousel generation is retired

#### Scenario: Story approval branch

- **WHEN** an owner inspects story asset generation
- **THEN** the definition shows plan approval before any asset work and asset work repeated for each section
- **AND** denial is shown as keeping the plan without generating assets

#### Scenario: Story research and extension branches

- **WHEN** an owner inspects story planning and asset generation
- **THEN** factual research is shown as conditional and post-research clarification as resumable
- **AND** generation explains reuse of compatible assets, retryable failures, and review-versus-auto-approval for duration additions

#### Scenario: Agent can choose a helper

- **WHEN** a tool is available to the agent but is not a required workflow step
- **THEN** its relationship is labeled as availability
- **AND** it is not displayed as mandatory sequential execution

### Requirement: Tool contracts and meaningful internal operations are discoverable

The catalog SHALL include every built-in tool definition, its purpose, effect kind, content-type restrictions, readable validated input contract, applicable output contract, aliases, and runtime exposure. Input descriptions SHALL preserve required fields, defaults, coercion, bounds, and validation conditions. Compatibility-only retired names SHALL be labeled as such. Meaningful internal operations behind workflow and tool calls SHALL be inspectable with their applicable inputs, outputs, conditions, repeats, and prompt relationships; internal operations SHALL NOT be mislabeled as public agent tools.

#### Scenario: Tool validates more than a field type

- **WHEN** an owner inspects a tool with a coerced index or conditional input requirement
- **THEN** the contract describes that coercion, bounds, and requirement rather than showing only a generic number or object

#### Scenario: Inspect story asset internals

- **WHEN** an owner selects story asset generation
- **THEN** voice generation, visual authoring/compilation, timing measurement, and timeline assembly are inspectable internal operations
- **AND** the definition explains which work repeats by section or beat and which work reuses prior output

#### Scenario: Inspect completion and aliases

- **WHEN** an owner browses the tool catalog
- **THEN** canonical aliases resolve to their existing tool definition
- **AND** retired aliases and runtime-owned completion controls are distinguished from directly available domain tools

#### Scenario: External tools depend on workspace

- **WHEN** an owner inspects external-tool availability
- **THEN** the catalog describes the workspace-allowlisted extension point
- **AND** returns no workspace server configuration, credential, or private external-tool definition

### Requirement: Prompt inspection shows production instructions and composition

Every application-authored prompt reachable from deployed built-in agent workflows, directly exposed built-in tools, their clarification/revision/retry/repair branches, and agent instructions SHALL have an inspectable definition consumed by production prompt construction. Definitions SHALL expose fixed instruction text and conditional fragments, variables and their types, required status, defaults/transforms, ordered composition, output constraints, ownership, and content revision. The catalog SHALL NOT replace actual instructions with a summary or a separately maintained UI copy.

#### Scenario: Inspect embedded story planning instructions

- **WHEN** an owner opens a story planning prompt definition
- **THEN** the complete fixed instructions and relevant conditional fragments are readable
- **AND** brief, duration, language, evidence, references, and constraints are identified as applicable inputs with defaults or omission behavior

#### Scenario: Inspect agent instructions

- **WHEN** an owner selects agent instructions for a content type
- **THEN** the definition contains the instructions the deployed agent consumes for that content type
- **AND** shows the workflow/tool references they use

#### Scenario: Inspect material routing

- **WHEN** an owner inspects composed planning, narration, or visual prompts
- **THEN** each definition shows its actual ordered material/context layers and applicable conditional fragments
- **AND** identifies project-specific values as input slots without reading a project

#### Scenario: Tool has no instruction prompt

- **WHEN** an owner inspects a deterministic edit or an operation that forwards supplied text without adding model instructions
- **THEN** the definition explicitly identifies no instruction prompt or input passthrough
- **AND** does not invent a template

### Requirement: Provider-dependent image compilation remains transparent

The catalog SHALL describe the actual fixed blocks, defaults, constraints, reference wording, and ordering used for provider-aware image prompt compilation, including any additional application-authored provider-wrapper instructions. Native-reference, text-only-reference, and no-reference variants SHALL be inspectable. Templates SHALL identify that final provider selection and compilation occur during execution, and SHALL NOT claim a future provider request has already been rendered. Instructions internal to third-party services SHALL be identified as outside Maleo's inspection boundary.

#### Scenario: Compare reference modes

- **WHEN** an owner inspects image prompt compiler variants
- **THEN** native mode shows image-binding instructions, text-only mode shows truthful descriptive fallback, and no-reference mode shows its omission behavior
- **AND** fixed negative guidance and block order are visible

#### Scenario: View a future request

- **WHEN** no provider and runtime image inputs have been selected
- **THEN** inspection shows the compiler definition and its variants
- **AND** does not label any example or template as an actual submitted provider request

#### Scenario: Adapter adds instructions

- **WHEN** an image provider adapter adds application-authored instructions after common image compilation
- **THEN** those instructions and their conditional inputs are inspectable as another composition layer
- **AND** third-party instructions unavailable to Maleo are not presented as known

### Requirement: Definition identities revisions and coverage are trustworthy

The catalog SHALL expose a schema version, catalog revision, and stable definition IDs with content revisions. Unchanged public definitions SHALL yield unchanged revisions. Changes to exposed prompt text, defaults, composition, relationships, or contracts SHALL change the affected revision and catalog revision. Every published reference SHALL resolve, and deployed workflow, tool, and in-scope prompt coverage SHALL be checked. Invalid or incomplete required coverage SHALL return an explicit catalog error rather than a misleading successful partial catalog. A revision SHALL identify the installed definition without implying historical storage.

#### Scenario: Prompt text changes

- **WHEN** a deployed prompt's fixed text or composition changes
- **THEN** its content revision and the catalog revision change
- **AND** its stable identity remains available for navigation

#### Scenario: Definition is missing

- **WHEN** a deployed built-in tool or required prompt has no catalog coverage, or a catalog relationship targets an unknown definition
- **THEN** catalog validation reports the missing coverage or reference
- **AND** the backend does not publish it as a complete successful catalog

#### Scenario: Inspect current version

- **WHEN** an owner reads a definition revision
- **THEN** it is labeled as belonging to the current deployed catalog
- **AND** no claim is made that older run versions can be retrieved

### Requirement: Inspection is private side-effect free and behavior preserving

Catalog reads SHALL contain application definitions only, with no credentials, environment values, workspace/project content, private reference URLs, or run records. Reads SHALL NOT start runs, perform research, generate media, alter configuration, mutate projects, or incur AI charges. Exposing definitions SHALL preserve existing prompt results, material routing, provider selection and worker compilation, validation, approvals, revision fencing, durability, and metering.

#### Scenario: Private data exists in deployment

- **WHEN** the deployment contains credentials, private briefs, materials, references, and run history
- **THEN** none of those values appear in a catalog response
- **AND** application-authored defaults remain inspectable

#### Scenario: Inspect repeatedly

- **WHEN** an owner reloads the catalog and opens several tool and prompt definitions
- **THEN** no generation, research, configuration write, project write, or billed request occurs

#### Scenario: Extracted prompt preserves production behavior

- **WHEN** production renders a prompt from the inspectable definition with inputs previously supported
- **THEN** rendered request and existing validation/gating behavior match the pre-extraction behavior
- **AND** image compilation still follows the selected provider's reference support

### Requirement: Workflow discovery projects one production-owned catalog

Workflow overview, inline stage relationships, consumer paths and inventory SHALL project the same production-owned catalog definitions, schemas, identifiers and prompt text. Display labels SHALL originate from those existing owners without a frontend workflow or label map. Shared definitions SHALL remain one canonical entity with multiple navigable references. Missing trigger, authority or topology facts SHALL remain unexposed rather than being fabricated. Existing catalog validation, source freshness and prompt/runtime parity checks SHALL remain mandatory.

#### Scenario: Production changes stage membership

- **WHEN** a production-owned definition changes stage membership and current catalog generation succeeds
- **THEN** explorer membership reflects that catalog without editing a frontend workflow map
- **AND** stage identifiers and published order remain identical to production projection

#### Scenario: Shared prompt changes

- **WHEN** a production prompt used by multiple stages changes fixed instructions
- **THEN** all inspector links resolve the same updated canonical definition and content revision
- **AND** no independent prompt storage or copied tree definition exists

#### Scenario: Required reference is invalid

- **WHEN** catalog coverage or reference validation fails
- **THEN** no misleading successful partial explorer topology is published

### Requirement: Verification claims require current relationship evidence

A Verified relationship claim SHALL require passed test evidence identifying the specific relationship and assertion, the current relevant definition revision, and an inspectable evidence reference. Derived provenance, a source link, a test file name or general CI success SHALL NOT substitute for such evidence. Missing or mismatched evidence SHALL remain explicitly unavailable for verification while preserving derived/declared/opaque provenance. Coverage summaries SHALL identify their bounded scope without percentages or global runtime completeness claims.

#### Scenario: Catalog has no published verification evidence

- **WHEN** current definitions expose provenance without revision-bound test attestations
- **THEN** the explorer shows that verification evidence is not published
- **AND** does not promote derived relationships to Verified

#### Scenario: Test evidence targets another revision

- **WHEN** an evidence reference applies to an earlier definition revision or another relationship
- **THEN** it does not establish verification for the current relationship

#### Scenario: Inspecting definitions has no effects

- **WHEN** an owner browses workflow coverage and named consumer paths
- **THEN** only public definition facts are inspected
- **AND** no runtime, provider, project read/write or billed request is executed

### Requirement: Catalog provides human browsing metadata without changing execution

Catalog definitions SHALL support production-owned human-readable titles, short purpose summaries, tool capability classifications and instruction purposes where published. Consumers SHALL derive named direct and transitive contexts from actual catalog relationships. Presentation facts SHALL preserve canonical IDs, backend kinds, aliases, full original descriptions, contracts and raw source details. They SHALL contribute to definition/catalog revision and retain declared provenance without implying executable derivation or verification. Missing metadata SHALL permit truthful fallback without a frontend ID-to-workflow, purpose or capability map. Catalog reads SHALL remain owner-only, private, side-effect free and behavior preserving. Presentation metadata SHALL NOT affect execution, prompt results, ordering, validation, approvals, provider choice, durability or metering.

#### Scenario: Browse production-owned capability

- **WHEN** a tool owner publishes a capability and short purpose
- **THEN** catalog returns them with same canonical tool and execution contracts
- **AND** browsing uses these facts without a separate frontend classification map

#### Scenario: Instruction has several consumers

- **WHEN** several operations or tools use one instruction
- **THEN** consumer browsing identifies actual direct and transitive paths to same canonical instruction
- **AND** availability alone does not imply use or ownership

#### Scenario: Presentation metadata is absent

- **WHEN** a supported catalog definition has no purpose or capability metadata
- **THEN** it remains inspectable under a truthful unclassified fallback
- **AND** no execution, relationship or purpose is fabricated from its identifier

#### Scenario: Presentation copy changes

- **WHEN** published purpose summary changes
- **THEN** affected definition and catalog revisions change while stable identity remains
- **AND** runtime behavior and rendered prompts remain unchanged
