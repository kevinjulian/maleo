## ADDED Requirements

### Requirement: Clip authoring is metered as text generation

Authoring a clip composition SHALL be priced through the text provider's existing token
metering, on the model that actually ran. Clip generation SHALL NOT introduce a second
pricing path for the same model call.

#### Scenario: Authoring spend lands on the text path

- **WHEN** a clip composition is authored
- **THEN** the token usage is priced and recorded through the existing text metering

#### Scenario: Quality scoring is metered too

- **WHEN** a generated composition is scored through the text seam
- **THEN** that call's tokens are priced alongside the authoring call

### Requirement: The revision loop is bounded by one spend ceiling

The spend ceiling for a clip SHALL cover every model call in its generate-gate-revise
loop, not a single attempt. Reaching the ceiling SHALL end the loop.

#### Scenario: Revisions accumulate against one ceiling

- **WHEN** a clip is revised twice before passing
- **THEN** every authoring and scoring call across all three attempts counts against the
  one ceiling for that clip

#### Scenario: Ceiling reached mid-loop

- **WHEN** accumulated spend reaches the ceiling before a passing verdict
- **THEN** the loop ends, the fallback is used, and the spend is recorded

### Requirement: Rendering is priced separately from authoring

A clip render SHALL be priced as a render, distinct from the token cost of authoring.
Re-rendering a stored composition — because its slot duration, aspect or frame rate
changed, or because its cached file was evicted — SHALL incur the render price and no
token cost, because no model is called on that path.

#### Scenario: Duration change spends no tokens

- **WHEN** a generated clip's slot duration changes and the clip is re-baked
- **THEN** the render is priced and no token cost is recorded

#### Scenario: Quota gate applies to clips

- **WHEN** a workspace has exhausted its quota
- **THEN** a clip request is refused by the same gate that refuses other generation
