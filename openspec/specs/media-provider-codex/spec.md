# media-provider-codex Specification

## Purpose

Codex image generation as a selectable image provider: how the provider reaches
Codex's `imagegen` skill, where its output must land before it counts as a media
result, what its health states mean, and which reference inputs it will accept.

Written because `imagegen` is an agent tool/skill boundary rather than a library.
Treating it as an importable API would make the media worker depend on ambient
agent state, so the boundary — and the failure modes it introduces — has to be
stated rather than assumed.

## Requirements

### Requirement: Codex image generation is a selectable image provider

The system SHALL expose a provider with id `codex` and capability `image` through
the existing media provider registry and selection flow.

The provider SHALL be selectable wherever image providers are selected by project,
workspace, or environment fallback. The provider SHALL NOT require dashboard or
producer call sites to import Codex-specific implementation code.

#### Scenario: Codex appears as an image provider

- **WHEN** callers ask for providers implementing image generation
- **THEN** `codex` is included with image capability metadata

#### Scenario: Codex is selected explicitly

- **WHEN** image generation is configured with provider id `codex`
- **THEN** the media generation runtime resolves the Codex provider through the
  same provider-selection path as other image providers

### Requirement: The provider uses an explicit Codex runner boundary

The provider SHALL invoke image generation through a supported Codex-controlled
runner boundary rather than importing a built-in agent tool directly into Bun
application code.

Provider health SHALL be `ready` only when that runner can execute image
generation. If the runner is absent, health SHALL be `unconfigured`. If the
runner is configured but fails a self-check, health SHALL be `down`.

#### Scenario: No Codex runner is configured

- **WHEN** the provider health is checked and no supported runner is available
- **THEN** health is `unconfigured`

#### Scenario: Explicit selection cannot silently fall back

- **WHEN** `codex` is explicitly selected and its health is not `ready`
- **THEN** generation fails with a provider-selection error and does not run
  another provider

### Requirement: Generated files are stored in the media-worker cache

The provider SHALL return only files copied into the media-worker cache contract.
It SHALL NOT return a `$CODEX_HOME/generated_images` path as the final media
result.

The provider SHALL preserve the selected image bytes and extension when copying
the output into the cache. Empty or unreadable output SHALL fail the generation.

#### Scenario: Codex returns an image under Codex storage

- **WHEN** the Codex runner reports a generated image file
- **THEN** the provider copies it into `CACHE_DIR` and returns the worker-managed
  file path or URL

#### Scenario: Codex output is empty

- **WHEN** the reported output file has no readable image bytes
- **THEN** the provider fails the generation and no completed image result is
  returned

### Requirement: Codex image jobs preserve existing attribution and metering

Codex image generation SHALL pass through the same metered generation entry and
image ledger behavior as other providers.

Completed Codex images SHALL carry provider attribution identifying `codex`.
Failed or unconfigured Codex attempts SHALL NOT create completed image rows or
captured usage records.

#### Scenario: Codex image succeeds

- **WHEN** a Codex image job completes
- **THEN** the image ledger records the generated image with workspace, optional
  project, source, prompt, and provider attribution

#### Scenario: Codex image fails

- **WHEN** a Codex image job fails before producing a managed output file
- **THEN** no completed image row appears and no usage is captured for the
  failed attempt

### Requirement: Reference inputs are constrained to managed files

The provider SHALL accept reference inputs only when they resolve to worker-
reachable managed files. It SHALL NOT fetch arbitrary remote URLs on behalf of a
caller.

If the Codex runner cannot accept staged references, the provider SHALL reject
reference generation with a clear unsupported-reference error instead of dropping
the references silently.

#### Scenario: A managed reference is supplied

- **WHEN** a reference input resolves to a managed worker file and the runner
  supports references
- **THEN** the provider passes that reference to the Codex runner

#### Scenario: An unsupported reference is supplied

- **WHEN** a reference input cannot be staged safely for the Codex runner
- **THEN** the provider rejects the request and does not generate an image without
  the reference
