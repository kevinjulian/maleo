# Spec Delta

## MODIFIED Requirements

### Requirement: Catalog distinguishes executable workflows and stage profiles

The catalog SHALL expose all deployed built-in agent workflows and stage profiles with stable identities and their runtime associations. A workflow SHALL describe its actual executable entry point and step order. A workflow that runs as a definition SHALL be projected from that definition — its nodes, conditions, operation, prompt and tool references, suspensions and calls — and its prompts from their templates, with no separately maintained metadata or source-derived structure. A stage profile SHALL be identified as a profile, not presented as an independently callable workflow when none exists. Runtime-generated framework tool names and internal tool names SHALL be distinguished. Retired carousel and thread workflows, tools, profiles and agent instructions SHALL NOT appear.

#### Scenario: Inspect video planning and generation

- **WHEN** an owner inspects video workflow definitions
- **THEN** planning and asset generation appear as separate executable workflows
- **AND** planning shows its guards, direction routing, clarification, and planning steps
- **AND** the associated plan and generation stage profiles are inspectable without implying planning immediately generates media

#### Scenario: Planning definition changes

- **WHEN** a developer changes a node, condition or prompt reference in the planning definition
- **THEN** the catalog's planning structure and its revision change on the next read
- **AND** no catalog-only file is edited

#### Scenario: Shared planning core

- **WHEN** an owner inspects the planning tool and the one-shot build tool
- **THEN** both reference the same planning core definition

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
