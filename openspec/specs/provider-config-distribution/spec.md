# provider-config-distribution Specification

## Purpose

How a provider obtains its configuration at all, and how a process that does
not hold the database resolves the same stored values as the one that does.

Written because providers read `process.env` directly, so a credential entered
in settings was invisible to the media worker — the process that actually runs
durable generation — and the surface reported a provider ready that could not
run.

## Requirements

### Requirement: A Provider Obtains Configuration Only Through An Injected Resolver

A provider SHALL NOT read `process.env` directly. It SHALL obtain every
configuration value through a resolver supplied by its host.

Reading the environment directly is what makes stored configuration impossible to
honour anywhere except a process that happens to hold the database. A resolver is
the seam that lets the same provider code serve a host with a database and a host
without one.

The default resolver SHALL read the environment, so a host that supplies nothing
behaves exactly as before this change.

#### Scenario: A host supplies no resolver

- **WHEN** a provider resolves configuration in a host that supplied no resolver
- **THEN** values come from the environment, unchanged from before this change

#### Scenario: A host supplies a resolver

- **WHEN** a host supplies a resolver
- **THEN** every provider in that host resolves through it, and no provider
  consults the environment on its own

#### Scenario: No provider reads the environment directly

- **WHEN** the provider packages are inspected
- **THEN** no provider implementation reads an environment variable for its own
  configuration, because one that did would be correct in one process and wrong in
  the other

### Requirement: Every Process Resolves The Same Stored Configuration

A process that does not hold the configuration database SHALL resolve
configuration from the process that does, rather than from its own environment
alone.

The media worker is a separate deployment with its own storage, and it is the
process that resolves and runs providers for durable generation. Without this, a
credential entered in settings is invisible to the process that generates, and the
surface reports a provider ready that cannot run — the exact failure the provider
specs exist to prevent.

#### Scenario: A credential set in settings reaches the worker

- **WHEN** an operator stores a provider credential through settings and durable
  generation runs that provider in the worker
- **THEN** the worker resolves that credential and the generation succeeds

#### Scenario: A worker with no configuration source

- **WHEN** a worker is deployed with no configuration service address
- **THEN** it resolves from its own environment as it did before this change, so
  an existing deployment is unaffected until it opts in

### Requirement: The Configuration Endpoint Is Authenticated And Not Public

The endpoint serving resolved configuration to other processes SHALL require a
service credential, SHALL compare that credential in constant time, and SHALL NOT
be reachable as part of the public API surface.

This endpoint returns decrypted credentials over HTTP. It is the highest-value
target the application has, and every other protection in this change is worth
nothing if it can be called anonymously.

#### Scenario: An unauthenticated request

- **WHEN** the configuration endpoint is called without a valid service credential
- **THEN** it refuses, and the response does not reveal whether the named provider
  exists

#### Scenario: An authenticated request

- **WHEN** the endpoint is called with a valid service credential for a registered
  provider
- **THEN** it returns that provider's resolved configuration

#### Scenario: No service credential is configured

- **WHEN** the application runs with no service credential configured
- **THEN** the endpoint refuses every request, rather than accepting all of them
  because there is nothing to compare against

### Requirement: Resolved Configuration Is Cached For A Bounded Time

A process fetching configuration SHALL cache it for a bounded lifetime, and SHALL
re-fetch after that lifetime without being restarted.

Fetching per job makes generation depend on a network round trip it does not need.
Caching forever makes a rotated credential require a redeploy, which is the
property this change exists to remove.

#### Scenario: Repeated resolution inside the cache lifetime

- **WHEN** a provider resolves the same value repeatedly within the cache lifetime
- **THEN** one fetch serves them all

#### Scenario: A value changes after the cache expires

- **WHEN** configuration changes and the cache lifetime passes
- **THEN** the next resolution observes the new value with no restart

### Requirement: An Unreachable Configuration Source Fails Closed

A process that cannot resolve configuration SHALL report the affected provider as
unconfigured. It SHALL NOT fall through to another provider, and specifically SHALL
NOT fall through to one that fabricates output.

A registry orders its providers, and the fabricating provider is registered last —
which means it wins precisely when everything above it looks unconfigured, which is
exactly the state an unreachable configuration service creates. Failing open here
turns an outage into output that is indistinguishable from real media at every
layer that reads it afterwards.

#### Scenario: The configuration service is unreachable

- **WHEN** a worker cannot reach the configuration service
- **THEN** the provider reports unconfigured and the generation fails, naming the
  configuration source as the cause

#### Scenario: No fallback to a fabricating provider

- **WHEN** a capability's providers are all unconfigured because configuration
  could not be resolved
- **THEN** no fabricated output is produced, and the failure is reported

#### Scenario: The environment remains a break-glass override

- **WHEN** the configuration service is unreachable and the value is present in
  the process environment
- **THEN** the environment value is used, so a deployment can be recovered from
  outside the failing service

### Requirement: Credentials Never Travel In A Job Payload

A job SHALL name the provider it is for. It SHALL NOT carry that provider's
credentials.

Job payloads are logged, retried, and persisted by the queue. A credential placed
in one is a credential in the event stream, in retry state, and in every log line
that echoes the job — none of which a secret can be withdrawn from afterwards.

#### Scenario: A job names its provider

- **WHEN** a generation job is enqueued for a provider
- **THEN** the payload carries the provider id and no credential

#### Scenario: The worker resolves for itself

- **WHEN** the worker runs that job
- **THEN** it resolves the provider's configuration through its own resolver
  rather than reading it from the payload
