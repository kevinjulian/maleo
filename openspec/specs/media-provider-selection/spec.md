# media-provider-selection Specification

## Purpose

How a capability resolves to a concrete provider: what the registry default means,
when selection is allowed to fall through, and when it must fail instead.

Written because the default is positional — `providersFor` returns registration
order and an unconfigured selection takes the first ready candidate — so an
ordering detail is behavior. The failure mode that matters is not an outage but a
silent one: a provider that fabricates output can satisfy a request nobody meant
to send it, and the result is indistinguishable from real media at every layer
that reads it afterwards.

## Requirements

### Requirement: Registry Default Names A Real Provider

For each capability, the first registered provider SHALL be one that can serve
production traffic when configured. A placeholder for an unbuilt provider, or a
provider that exists only to mock output, SHALL NOT hold the default position.

The default is positional — `providersFor` returns registration order and an
unconfigured selection takes the first ready candidate — so registration order is
behavior, not presentation.

#### Scenario: Image capability resolves with no selection persisted

- **WHEN** no project, workspace, or env image provider is selected and
  credentials for the leading provider are present
- **THEN** selection resolves to `cloudflare-ai`

#### Scenario: TTS capability resolves with no selection persisted

- **WHEN** no project, workspace, or env TTS provider is selected and the
  Supertonic service URL is configured
- **THEN** selection resolves to `supertonic`

#### Scenario: A provider is added to the registry

- **WHEN** a new provider is registered
- **THEN** it is appended rather than prepended, so an existing capability's
  default does not change implicitly

### Requirement: No Silent Fallback To Fabricated Output

When every configured provider for a capability is unavailable, selection SHALL
fail rather than resolve to a provider that fabricates output.

A generation that returns mock media through a success response is worse than a
failure: the caller receives a usable-looking artifact, the ledger records a
completed job, and nothing distinguishes it from real output.

#### Scenario: Every real provider for a capability is unconfigured

- **WHEN** an unconfigured default is resolved and no provider that produces real
  output reports `ready`
- **THEN** selection throws rather than returning the mock provider

#### Scenario: TTS service is unreachable

- **WHEN** the Supertonic URL is unset and no other TTS provider is opted in
- **THEN** TTS generation fails with a message naming the missing configuration,
  and no mock audio is produced

### Requirement: Persisted Provider Id That No Longer Exists Is Recovered

When a persisted project, workspace, or env provider id names a provider absent
from the registry, the system SHALL recover to the registry default rather than
failing every generation.

An id persisted before a provider was retired is stale configuration, not an
operator error, and it SHALL NOT leave the capability permanently broken.

#### Scenario: Workspace setting names a retired provider

- **WHEN** `media.provider.image` holds an id with no registered provider
- **THEN** the setting is treated as absent, resolution continues to the registry
  default, and the recovery is surfaced to the operator

#### Scenario: Selected provider exists but is unhealthy

- **WHEN** an explicitly selected provider is registered, implements the
  capability, and reports `unconfigured` or `down`
- **THEN** selection fails loudly naming the provider and its state, because an
  explicit operator choice is never silently substituted

#### Scenario: Selected provider does not implement the capability

- **WHEN** an explicitly selected provider is registered but ships no
  implementation for the requested capability
- **THEN** selection fails loudly rather than falling through to another provider

### Requirement: Sandbox video requires explicit provider selection

Sandbox video SHALL remain selectable in the existing provider settings surface when its local dependencies are available, but SHALL be excluded from automatic resolution. Clearing video selection or recovering a retired selection SHALL NOT activate sandbox implicitly.

#### Scenario: Sandbox is explicitly selected

- **WHEN** a valid explicit video selection names sandbox and sandbox is ready
- **THEN** video generation resolves sandbox without requiring an environment opt-in

#### Scenario: Real video provider is unavailable

- **WHEN** video has no explicit selection and no ready real provider
- **THEN** resolution fails rather than returning sandbox

#### Scenario: Video selection is cleared

- **WHEN** the operator clears the persisted video provider selection
- **THEN** automatic resolution considers real providers only
