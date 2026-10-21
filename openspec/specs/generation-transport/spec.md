# generation-transport Specification

## Purpose

How generated image and speech work reaches the service that performs it, and what
that path must preserve on the way. Created by archiving change
simplify-package-ownership, which reduced two transports to one.

## Requirements

### Requirement: Generated media uses one worker transport

The API SHALL submit and poll image, TTS, and video generation through the existing media client and configured media worker. It SHALL NOT retain a direct legacy image-service request path, direct video vendor request path in an API route or agent helper, or a flag that selects between durable and legacy transports.

#### Scenario: Media worker is configured

- **WHEN** a media worker is configured
- **THEN** image, TTS, and video jobs are submitted and polled through that worker
- **AND** provider selection is carried into the durable request

#### Scenario: Media worker is absent

- **WHEN** no media worker is configured
- **THEN** generation reports its service as unconfigured
- **AND** it does not fall back to a direct legacy or vendor transport

### Requirement: Durable transport preserves generation behavior

Worker-only transport SHALL preserve generation ledger attribution, job completion/failure transitions, idempotency, retries, per-kind concurrency, public file URLs, and API proxy URLs.

#### Scenario: Image generation completes

- **WHEN** a durable image job completes through media worker
- **THEN** its ledger attempt becomes completed with caller attribution
- **AND** API consumers receive the same `/api/image-gen/files/*` proxy form expected by web and persisted documents

#### Scenario: Generation fails

- **WHEN** submission or durable execution fails
- **THEN** its ledger attempt becomes failed
- **AND** caller receives a failure rather than a successful empty artifact

### Requirement: Development discovers every durable function host

Root development SHALL start local Inngest and point it at API's agent function endpoint and media worker's generation function endpoint whenever media worker is enabled.

#### Scenario: Full durable development stack starts

- **WHEN** operator runs `bun run dev` with media worker configured
- **THEN** local Inngest discovers both `/api/inngest` endpoints
- **AND** agent and generated-media events each have one registered handler

### Requirement: Video transport preserves source metadata and publication

Video jobs SHALL preserve provider selection, caller scope, idempotency, retries, bounded requests, per-kind concurrency, actual source duration, and job completion/failure transitions. Completed video SHALL be stored and delivered as video with its correct content type. Publication SHALL NOT treat MP4 video as image or audio.

#### Scenario: Video completes

- **WHEN** a durable video job completes
- **THEN** its stored artifact is video/mp4 with actual duration and provider metadata available to API callers

#### Scenario: Job is retried

- **WHEN** the same video request is retried with its idempotency key
- **THEN** transport reuses the existing job or result rather than duplicating generation

#### Scenario: Generation fails

- **WHEN** video generation or publication fails
- **THEN** its job is failed and callers receive failure rather than an empty successful URL
