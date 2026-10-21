# generation-metering Specification

## Purpose

How a generation is priced, gated and billed, and which paths must go through it.
Written after spend was found to be governed by two systems that could not see
each other, with prices inlined at their call sites.

## Requirements

### Requirement: One metered path for generation spend

The system SHALL route every billable generation through one metering entry that
quotes the operation, applies the workspace quota gate when a workspace is known,
runs the operation inside the ledger's reserve/capture bracket, and records usage.
A generation path SHALL NOT bill the ledger directly or price an operation at its
call site.

The generation context that metering needs — the workspace a generation is billed
to — SHALL be the same context that attributes the resulting artifact. A path that
knows its workspace well enough to be billed SHALL therefore also record what it
produced, and a path that supplies neither SHALL be treated as a defect rather than
as an unattributed generation that silently succeeds.

This coupling is stated because the two drifted: three of the four image producers
reached the provider without a workspace, so they were simultaneously unmetered and
unrecorded, and neither omission was visible from the other's surface.

#### Scenario: A route generation is billed like an agent generation

- **WHEN** an image is generated through the HTTP route rather than the chat agent
- **THEN** it lands a usage record on the same ledger, with the same pricing

#### Scenario: A failed generation is not billed

- **WHEN** the provider call throws
- **THEN** no usage is recorded and any reservation is released

#### Scenario: A metered generation is an attributed one

- **WHEN** a generation is metered against a workspace
- **THEN** the artifact it produced is recorded against that same workspace

#### Scenario: A generation without context does not pass silently

- **WHEN** a generation path reaches the provider supplying no workspace
- **THEN** this surfaces as a defect rather than completing as unmetered and unrecorded

### Requirement: Prices live in one table

The system SHALL define provider cost, infrastructure cost, markup, risk buffer
and reserve headroom per operation in one place, and SHALL derive every quote from
it. A price SHALL NOT appear as a literal at a call site.

LLM text generation SHALL be priced from that same table, keyed by the provider and
model that actually ran, and SHALL be billed per token. It SHALL NOT be priced by a
formula inlined in the runner, and its provider cost SHALL NOT be reported as zero
on the assumption that the runner is flat-rate.

This is stated because the LLM path was the one exception: its credit formula lived
in the runner and its provider cost was hardcoded to zero. That was accurate while
the only runner was a flat-rate subscription CLI, where the marginal cost of a call
genuinely was zero. Once a provider can be an API key, cost is real, per-token, and
differs by model — so the exception would understate spend rather than round it.

#### Scenario: Changing a price is a one-place edit

- **WHEN** the per-image provider cost changes
- **THEN** every path that generates an image quotes the new price without further edits

#### Scenario: An operation is billed in its own unit

- **WHEN** speech is synthesised
- **THEN** it is billed per character, while an image is billed per image, each recorded with its unit

#### Scenario: Text generation is priced by what actually ran

- **WHEN** a text generation completes
- **THEN** it is priced from the table for the provider and model that ran it, and recorded per token

#### Scenario: Switching to a metered provider shows real cost

- **WHEN** the configured text provider changes from a flat-rate runner to a per-token API provider
- **THEN** the recorded provider cost reflects the API price rather than remaining zero

### Requirement: One quota gate

The system SHALL evaluate the workspace generation quota in one place, before the
operation runs. A refusal SHALL prevent the operation entirely and SHALL be
distinguishable by callers so an HTTP surface can answer 429.

#### Scenario: A refused generation does not run and is not billed

- **WHEN** the workspace's policy refuses another generation
- **THEN** the provider is never called and no usage is recorded

#### Scenario: The refusal reaches the client unchanged

- **WHEN** a route generation is refused by the quota
- **THEN** the route answers 429 with the gate's reason
