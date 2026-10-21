## ADDED Requirements

### Requirement: Clip authoring is a consumer of the text seam

Authoring a clip composition SHALL go through the text provider seam like every other
text generation, using the provider already selected for the workspace. Clip authoring
SHALL NOT introduce its own runner, agent protocol, session, or provider selection.

#### Scenario: Clip authoring uses the selected provider

- **WHEN** a clip is generated
- **THEN** the composition is authored by the workspace's selected text provider

#### Scenario: Changing the text provider changes clip authoring

- **WHEN** a workspace switches text providers
- **THEN** subsequent clip generations are authored by the new provider, with no
  clip-specific setting to change

### Requirement: The text seam is not asked to inspect images

The text seam's contract is text-in and text-out. Clip generation SHALL NOT extend it
with image input, and SHALL NOT route frame inspection through it. Measurements of a
rendered file are computed deterministically; judgements about a composition are made by
reading its source.

#### Scenario: Frame inspection does not reach the text seam

- **WHEN** a rendered clip's frames are checked for black frames or safe-area violations
- **THEN** the check is computed from pixels and no text-seam call is made

#### Scenario: Quality scoring sends source, not images

- **WHEN** a generated clip is scored for quality
- **THEN** the text seam receives the composition source and the brief as text

### Requirement: Clip authoring respects the seam's concurrency bound

Clip authoring SHALL be subject to the provider's declared concurrency bound, like every
other consumer of the seam. A clip revise loop SHALL NOT bypass it by holding a provider
slot across attempts.

#### Scenario: Clip authoring queues behind the provider bound

- **WHEN** clip authoring is requested while a provider is at its concurrency limit
- **THEN** the call waits like any other text generation rather than exceeding the bound
