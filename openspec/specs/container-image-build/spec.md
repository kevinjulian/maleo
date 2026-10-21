# container-image-build Specification

## Purpose

What an image contains and what it is built from: which processes an image
serves and how each is named, what the build context excludes, which system
binaries the runtime shells and must therefore be installed, and how
configuration reaches a containerised process. Written because every one of
these fails far from its cause — a missing binary surfaces as a failed caption
request, a grown context as a hung build, an unbuilt library as a blank page
answering 200.

## Requirements

### Requirement: Every deployed process has an image and a command that name it

Each separately deployed process SHALL be described by an image and a command
that name it. Processes sharing one dependency tree MAY share one image,
provided each service's command names the process it runs. An image's stated
purpose SHALL match what it runs, and SHALL name no component that was removed
from the product.

Three images over one workspace meant three installs of the same lockfile, run
in parallel by the platform, which exhausted a shared build host twice — failing
with a bare `exit code: 1` that no log retained. These processes differ by a
command, not by a dependency tree.

#### Scenario: An image is read to learn what it runs

- **WHEN** a reader opens the image a deployed process runs
- **THEN** it states which processes it serves, and names no component that was removed from the product

#### Scenario: A process shares an image with others

- **WHEN** a service runs a shared image
- **THEN** its command names the process it runs, and the image defines no default that would start a different one

#### Scenario: A process needs a dependency tree the others do not

- **WHEN** a process requires dependencies the others do not share
- **THEN** it gets its own image, because the reason to share one has gone

### Requirement: The build context excludes runtime data and generated artifacts

A root ignore file SHALL exclude the runtime data directory, generated media,
screenshots, test output, and vendored example dependency trees from every build
context.

The repository contains a self-referential symlink chain under
`packages/vui/examples/generic/node_modules` deep enough that directory traversal
fails with "File name too long", and a runtime database measured in gigabytes.
Either is sufficient to hang or exhaust a build.

#### Scenario: An image is built

- **WHEN** an image is built from the repository root
- **THEN** the context excludes the runtime data directory, and the build does not traverse the vendored example dependency tree

#### Scenario: The context size is checked

- **WHEN** the build context is measured
- **THEN** it does not include the runtime database, generated media, or repository-root screenshots

### Requirement: System binaries the runtime shells are present in the image

An image SHALL contain every external binary the process invokes at runtime. A
binary SHALL NOT be assumed present because it exists on a developer machine.

`lib/local-whisper.ts` and `lib/audio-duration.ts` shell `ffmpeg`, which the base
Bun image does not provide. The absence surfaces as a runtime failure on the
first caption or duration request, not as a build error.

#### Scenario: A caption alignment runs in a container

- **WHEN** a request that shells `ffmpeg` is served from the built image
- **THEN** it succeeds, because the binary is installed in the image

#### Scenario: A new external binary is introduced

- **WHEN** code is added that shells an external binary
- **THEN** the image installs it, and a check confirms its presence at build time

### Requirement: Configuration reaches a containerised process from the environment

A containerised process SHALL read configuration from environment variables. A
start path SHALL NOT depend on a repository file that exists only in a
development checkout.

`apps/web`'s start script loads `--env-file ../../.env`, which is absent in a
container.

#### Scenario: A process starts in a container

- **WHEN** a deployed process starts with configuration supplied as environment variables
- **THEN** it starts successfully without reading a repository environment file

#### Scenario: A required variable is missing

- **WHEN** a process starts without a variable it requires
- **THEN** it fails at startup naming the variable, rather than starting degraded

### Requirement: Browser-session media providers are not available in a container

Providers that drive a browser session SHALL be documented as unavailable in a
containerised deployment, and a deployment SHALL select a provider that runs
without one.

#### Scenario: A deployment configures image generation

- **WHEN** a containerised deployment selects an image provider
- **THEN** it selects one that requires no browser session, and the browser-session providers are recorded as development-only
