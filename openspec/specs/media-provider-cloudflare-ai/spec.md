# media-provider-cloudflare-ai Specification

## Purpose

TBD - created by archiving change generate-images-through-hosted-providers. Update Purpose after archive.

## Requirements

### Requirement: Cloudflare Workers AI is a selectable image provider

The system SHALL expose a provider with id `cloudflare-ai` and capability `image`
through the existing media provider registry and selection flow.

The provider SHALL be selectable by project, workspace, or environment fallback
wherever image providers are selected. Callers SHALL NOT import Cloudflare
specific implementation code.

The provider SHALL be appended to the registry, so that the unconfigured
first-ready default for `image` does not change.

#### Scenario: Cloudflare appears as an image provider

- **WHEN** callers ask for providers implementing image generation
- **THEN** `cloudflare-ai` is included with image capability metadata

#### Scenario: Adding the provider does not move the default

- **WHEN** no image provider is configured by project, workspace, or environment
- **THEN** selection resolves to the same provider it resolved to before
  `cloudflare-ai` was registered

### Requirement: Health reflects credentials without throwing

Provider health SHALL be `ready` only when both a Cloudflare account id and an
API token are configured. When either is absent, health SHALL be `unconfigured`.

`health()` SHALL return a health value rather than throwing when credentials are
absent, and SHALL NOT perform a billed generation request.

Health SHALL be capability-aware: a capability other than `image` SHALL report
`unconfigured`.

#### Scenario: No credentials configured

- **WHEN** provider health is checked with no account id or API token present
- **THEN** health is `unconfigured` and no error is raised

#### Scenario: Explicit selection cannot silently fall back

- **WHEN** `cloudflare-ai` is explicitly selected and its health is not `ready`
- **THEN** generation fails with a provider-selection error and no other provider
  runs

### Requirement: The image model is chosen from a declared capability table

The provider SHALL resolve its model from a known table of Cloudflare image
models. Each entry SHALL declare whether the model accepts output dimensions and
whether it accepts reference images. Provider metadata SHALL expose the effective
image reference support mode for the configured model.

An operator-configured model id absent from the table SHALL be a configuration
error. The provider SHALL NOT pass an unvalidated model id through to Cloudflare.

The default model SHALL be one that accepts both output dimensions and reference
images.

#### Scenario: Unknown model id is configured

- **WHEN** the configured Cloudflare image model is not present in the table
- **THEN** generation fails naming the unknown model, and no request is sent

#### Scenario: No model is configured

- **WHEN** no Cloudflare image model is configured
- **THEN** the provider uses a default model that accepts dimensions and
  reference images

#### Scenario: Metadata reports configured model reference support

- **WHEN** provider metadata is read for Cloudflare image generation
- **THEN** it reports native reference support only when the configured model accepts reference images

### Requirement: Requested aspect is honoured or refused, never silently changed

For a model that accepts output dimensions, the provider SHALL translate the
requested aspect into width and height within the model's documented range, and
SHALL request those dimensions.

The requested width and height SHALL both sit on the model's dimension grid, and
their ratio SHALL equal the requested aspect exactly. A model that floors
off-grid dimensions would otherwise return a different aspect than was asked
for, reporting success.

For a model that does not accept output dimensions, a request for a non-square
aspect SHALL fail, naming the model and the requested aspect. The provider SHALL
NOT return an image whose dimensions do not match the requested aspect.

#### Scenario: Vertical aspect on a model that accepts dimensions

- **WHEN** an image is requested at `9:16` from a model that accepts dimensions
- **THEN** the provider requests a vertical size within the model's supported
  range and returns an image at that aspect

#### Scenario: Non-square aspect on a square-only model

- **WHEN** an image is requested at `9:16` from a model that accepts no
  dimensions
- **THEN** generation fails naming the model and the requested aspect

#### Scenario: Aspect near the model's dimension ceiling

- **WHEN** a requested aspect maps to a dimension near the model's documented
  maximum
- **THEN** the requested size sits on the model's grid, within the range, and the
  returned image has exactly those dimensions

#### Scenario: Requested dimensions are off the model's grid

- **WHEN** an aspect's natural size does not sit on the model's dimension grid
- **THEN** the provider requests the nearest size that does and preserves the
  exact ratio, rather than letting the model floor one side

### Requirement: Reference images are downscaled to the model's input limit

For a model that accepts reference images, the provider SHALL resolve each
requested reference to local bytes, downscale it to fit within the model's
documented maximum input dimensions while preserving its aspect, and attach it as
a reference input.

When more reference inputs are supplied than the model accepts, generation SHALL
fail naming the accepted count and the count supplied. The provider SHALL NOT
drop the remainder silently.

For a model that accepts no reference images, a request carrying reference inputs
SHALL fail, naming providers that do accept them.

A reference that cannot be resolved or read SHALL fail the generation naming that
reference, rather than being skipped silently.

#### Scenario: Oversized reference image

- **WHEN** a reference image larger than the model's input limit is supplied
- **THEN** the provider downscales it below that limit and attaches it

#### Scenario: More references than the model accepts

- **WHEN** more reference images are supplied than the model accepts
- **THEN** generation fails naming the accepted count and the count supplied

#### Scenario: Reference cannot be read

- **WHEN** a supplied reference cannot be resolved to readable bytes
- **THEN** generation fails naming that reference

### Requirement: Generated images land in the media-worker cache

The provider SHALL decode the returned image and write it into the media-worker
cache directory, returning the worker-managed path. It SHALL NOT return a remote
URL or an undecoded payload as the media result.

Empty or undecodable output SHALL fail the generation.

#### Scenario: Cloudflare returns an encoded image

- **WHEN** the model returns an encoded image payload
- **THEN** the provider decodes it, writes it into the cache directory, and
  returns the worker-managed path

#### Scenario: Empty output

- **WHEN** the response carries no image payload
- **THEN** generation fails rather than returning a zero-byte file

### Requirement: Rate limits and upstream failures surface to the caller

The provider SHALL surface rate-limit and upstream-failure responses as errors
that preserve the upstream status, so that the durable generation runtime applies
its retry policy.

The provider SHALL NOT sleep or retry internally in response to rate limiting.

#### Scenario: Rate limited by Cloudflare

- **WHEN** Cloudflare rejects a generation request for rate limiting
- **THEN** the provider raises an error carrying that status and returns
  promptly, without waiting

### Requirement: Generation attribution is recorded

Each generation SHALL record the provider id and the resolved model id, so that
provider comparison and per-model cost remain queryable.

#### Scenario: Generation completes

- **WHEN** an image is generated through this provider
- **THEN** the recorded job names provider id `cloudflare-ai` and the model that
  produced the image
