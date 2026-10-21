# media-provider-huggingface Specification

## Purpose

TBD - created by archiving change generate-images-through-hosted-providers. Update Purpose after archive.

## Requirements

### Requirement: Hugging Face Inference Providers is a selectable image provider

The system SHALL expose a provider with id `huggingface` and capability `image`
through the existing media provider registry and selection flow.

The provider SHALL be selectable by project, workspace, or environment fallback
wherever image providers are selected. Callers SHALL NOT import Hugging Face
specific implementation code.

The provider SHALL be appended to the registry, so that the unconfigured
first-ready default for `image` does not change.

#### Scenario: Hugging Face appears as an image provider

- **WHEN** callers ask for providers implementing image generation
- **THEN** `huggingface` is included with image capability metadata

#### Scenario: Adding the provider does not move the default

- **WHEN** no image provider is configured by project, workspace, or environment
- **THEN** selection resolves to the same provider it resolved to before
  `huggingface` was registered

### Requirement: Health reflects credentials without throwing

Provider health SHALL be `ready` only when a Hugging Face access token is
configured. When the token is absent, health SHALL be `unconfigured`.

`health()` SHALL return a health value rather than throwing when the token is
absent, and SHALL NOT perform a billed generation request.

Health SHALL be capability-aware: a capability other than `image` SHALL report
`unconfigured`.

#### Scenario: No token configured

- **WHEN** provider health is checked with no access token present
- **THEN** health is `unconfigured` and no error is raised

#### Scenario: Explicit selection cannot silently fall back

- **WHEN** `huggingface` is explicitly selected and its health is not `ready`
- **THEN** generation fails with a provider-selection error and no other provider
  runs

### Requirement: Requests route through Hugging Face rather than a provider directly

The provider SHALL send generation requests through the Hugging Face router using
the account's access token, so that the account's included monthly credits apply.

Where an organization is configured for billing, the provider SHALL attribute the
request to that organization.

#### Scenario: Generation is billed to the account

- **WHEN** an image is generated with only an access token configured
- **THEN** the request is routed through Hugging Face and billed to that account

#### Scenario: Organization billing is configured

- **WHEN** a billing organization is configured
- **THEN** the request is attributed to that organization

### Requirement: The model is operator-selectable with a documented default

The provider SHALL resolve its model from configuration, falling back to a
documented default when none is set.

A model that is not currently served SHALL fail the generation with an error
naming the model, rather than being reported through provider health.

#### Scenario: No model configured

- **WHEN** no model is configured
- **THEN** the provider uses the documented default model

#### Scenario: Configured model is not served

- **WHEN** the configured model is not currently available for inference
- **THEN** generation fails with an error naming that model

### Requirement: The requested aspect is sent, and whatever is returned is kept

The provider SHALL translate the requested aspect into explicit width and height
parameters on the generation request, so that a serving provider implementing
those parameters honours the aspect.

The provider SHALL NOT reject an image whose dimensions differ from the ones
requested. Serving providers behind the router are chosen per request and may
ignore the parameters; the generated image SHALL be returned as it arrived.

The provider SHALL allow an operator to pin which serving provider handles the
request.

#### Scenario: Serving provider honours the request

- **WHEN** an image is requested at `9:16` and the returned image is vertical
- **THEN** the image is written to the cache and returned

#### Scenario: Serving provider ignores the dimension parameters

- **WHEN** an image is requested at `9:16` and the returned image is square
- **THEN** the image is still written to the cache and returned as a successful
  generation

#### Scenario: The aspect is requested regardless

- **WHEN** an image is requested at a non-square aspect
- **THEN** the outgoing request carries width and height for that aspect

#### Scenario: Serving provider is pinned

- **WHEN** an operator pins a serving provider
- **THEN** the request routes to that provider

### Requirement: Reference images are accepted and ignored

The text-to-image task exposes no reference-image input. When a generation
request reaches the Hugging Face provider with reference inputs, the provider
SHALL generate from the prompt and SHALL NOT fail on that basis.

The outgoing Hugging Face router request SHALL carry nothing derived from
reference image bytes or URLs, because the task has no parameter that could
convey them.

The provider metadata SHALL declare text-only reference support so upstream
provider-aware prompt compilation describes references as text and does not
imply native attached-image behavior.

#### Scenario: References supplied

- **WHEN** an image is requested with one or more reference inputs
- **THEN** generation proceeds from the prompt and returns an image

#### Scenario: References make no difference to the router request

- **WHEN** the same compiled prompt is requested with and without reference inputs
- **THEN** the outgoing Hugging Face router request is the same in both cases

#### Scenario: No references supplied

- **WHEN** an image is requested with no reference inputs
- **THEN** generation proceeds normally

#### Scenario: Upstream compiler uses text-only reference brief

- **WHEN** Hugging Face is the selected image provider and image intent includes references
- **THEN** the provider prompt contains a compact textual reference brief and no wording that says images are attached

### Requirement: Generated images land in the media-worker cache

The provider SHALL write the returned image bytes into the media-worker cache
directory and return the worker-managed path. It SHALL NOT return a remote URL as
the media result.

Empty output SHALL fail the generation.

#### Scenario: Model returns image bytes

- **WHEN** the model returns image bytes
- **THEN** the provider writes them into the cache directory and returns the
  worker-managed path

#### Scenario: Empty output

- **WHEN** the response carries no image bytes
- **THEN** generation fails rather than returning a zero-byte file

### Requirement: Rate limits and exhausted credits surface to the caller

The provider SHALL surface rate-limit, exhausted-credit, and upstream-failure
responses as errors that preserve the upstream status, so that the durable
generation runtime applies its retry policy.

The provider SHALL NOT sleep or retry internally in response to rate limiting.

An exhausted-credit failure SHALL be distinguishable from a transient failure in
its message, because retrying it cannot succeed.

#### Scenario: Monthly credits are exhausted

- **WHEN** the account has no remaining credits and generation is attempted
- **THEN** the provider raises an error identifying exhausted credits rather than
  a generic failure

#### Scenario: Rate limited upstream

- **WHEN** the request is rejected for rate limiting
- **THEN** the provider raises an error carrying that status and returns
  promptly, without waiting

### Requirement: Generation attribution is recorded

Each generation SHALL record the provider id and the resolved model id, so that
provider comparison and per-model cost remain queryable.

#### Scenario: Generation completes

- **WHEN** an image is generated through this provider
- **THEN** the recorded job names provider id `huggingface` and the model that
  produced the image
