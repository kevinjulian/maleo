# prompt-templates Specification

## Purpose

Defines application prompts as plain-data templates rendered by one compiler, so the prompt the explorer shows is the text production sends and prompts can later be edited without code changes.

## Requirements

### Requirement: Prompts are data templates rendered by one compiler

Every application prompt reachable from video planning SHALL be a plain serializable template with a stable identifier, built only from fixed text, slots with named filters, conditional parts using the workflow expression language, repeats over a list, includes of other templates, references to code-owned constants, and registered formatters. One compiler SHALL render every template. Production SHALL NOT render a converted prompt any other way. A template SHALL be rejected at load when it references an unknown template, constant, filter or formatter, or includes itself directly or indirectly.

#### Scenario: Template includes an unknown block

- **WHEN** a template includes a template identifier that is not registered
- **THEN** loading fails naming both templates

#### Scenario: Optional guidance is absent

- **WHEN** a planning prompt is rendered without optional language or material guidance
- **THEN** the conditional parts for that guidance are omitted exactly as the template states

### Requirement: Converted prompts render byte-identical requests

For every input the replaced builder supported, a converted template SHALL render exactly the text the builder produced, including whitespace, escapes and the order of parts. Parity SHALL be proven against output captured from the replaced builders before conversion, covering defaults, optional and conditional parts, evidence, escapes and repair or correction prompts.

#### Scenario: Draft prompt with evidence and writer style

- **WHEN** the draft prompt is rendered with research sources, a writer style and locked constraints
- **THEN** the result equals the captured pre-conversion text byte for byte

#### Scenario: Untrusted text contains template syntax

- **WHEN** a brief or source excerpt contains slot-like syntax, quotes or backticks
- **THEN** the text is inserted literally and is not interpreted as template structure

### Requirement: Constants and formatters stay owned by code

A template SHALL reference values that validation also depends on, such as the allowed plan kinds or emotions, through named constants defined in code, and SHALL NOT copy their values. Formatting that the template vocabulary cannot express SHALL be a registered formatter referenced by identifier.

#### Scenario: Allowed values change in code

- **WHEN** the code-owned list of plan kinds changes
- **THEN** every template referencing that constant renders the new list
- **AND** the response validation and the prompt cannot disagree

### Requirement: Model requests reference their response contract

A template that is sent as a model request SHALL reference the registered parser and response schema that production applies to the reply, and the correction or fallback policy its caller applies. A composition fragment SHALL NOT claim a response contract. Response parsing and acceptance SHALL be unchanged by the conversion.

#### Scenario: Frame prompt reply is invalid

- **WHEN** a frame reply fails its schema
- **THEN** the caller applies the same retry and degrade policy as before conversion
- **AND** the frame template names that schema and policy

#### Scenario: Fragment is inspected

- **WHEN** a material-layer fragment is inspected
- **THEN** it lists the requests that include it and no response contract
