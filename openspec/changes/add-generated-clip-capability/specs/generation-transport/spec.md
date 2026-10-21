## ADDED Requirements

### Requirement: Clip work uses the same durable transport

Clip generation SHALL travel the same producer-to-worker path as image and speech
generation: a job record, a generation event, durable execution with idempotency and
retry, and a pollable job status. Clip SHALL NOT acquire a second transport.

`clip` is a job kind, not a provider capability — the work is orchestrated from existing
seams rather than dispatched to a provider chosen for it.

#### Scenario: Clip enqueues like other generation

- **WHEN** a clip is requested
- **THEN** a job row is created, a generation event is emitted carrying the job as its
  idempotency key, and the producer polls the same job endpoint

#### Scenario: Duplicate clip submission dedupes

- **WHEN** the same clip request is submitted twice with the same idempotency key
- **THEN** one generation runs

### Requirement: The job kind is defined once

The set of generation kinds SHALL have a single definition that the job store, the
runtime seam, the producer request shape and the worker's enqueue all derive from. A new
kind SHALL NOT be addable to one of them without the others failing to compile.

#### Scenario: Adding a kind reaches every consumer

- **WHEN** a generation kind is added to the definition
- **THEN** every consumer that does not handle it fails to typecheck

### Requirement: Clip concurrency is capped separately

Clip generation SHALL be limited by its own concurrency setting. A clip render is
substantially more expensive than an image or a speech clip, and SHALL NOT consume the
concurrency budget of the other capabilities.

#### Scenario: Clip concurrency is independent

- **WHEN** clip jobs saturate their concurrency limit
- **THEN** image and speech generation continue to run

### Requirement: The job record carries the generation review

A completed clip job SHALL carry its structured review and quality verdict on the job
record. The review SHALL NOT be written as a media file.

#### Scenario: Review is readable from the job

- **WHEN** a clip job is polled after completion
- **THEN** its review and verdict are returned with the job, and the files directory
  contains only media

#### Scenario: A failed clip records why

- **WHEN** a clip job ends in fallback after exhausting revisions
- **THEN** the job records the final verdict and the failing dimensions
