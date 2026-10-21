# media-provider-packaging Specification

## Purpose

Where a provider's code lives, and what earns it a workspace package of its own.
Providers are `fetch` or `spawn` behind one seam and are imported only by the
registry, so a package per provider buys nothing and costs a `package.json`, a
`tsconfig.json`, and a wrapper for every one of them.

Written because the split had a second cost that was not administrative: the
same reference-path guard existed in more than one provider, one forgotten edit
away from two providers disagreeing about which local files a caller can reach.
A separate package still earns its place when the directory holds something the
media package cannot — a different runtime, a consumer that must not depend on
the media domain, or a deployable artifact — and that reason is checked against
the whole directory, not its TypeScript alone.

## Requirements

### Requirement: Provider Implementations Live In The Media Package

Every content provider implementation SHALL live in its own directory under
`packages/media/src/providers/`, together with the metadata and adapter that
register it. A provider SHALL NOT be split across a workspace package and a
wrapper directory.

A separate workspace package is justified only when the directory holds something
the media package cannot: a runtime the media package cannot host, or a consumer
that must not depend on the media domain. A deployable artifact is no longer such
a case — it belongs under `apps/`, per `deployable-service-layout`, with its
client folded in like any other provider. None of these applies to a provider
that is `fetch` or `spawn` and is imported only by the registry, and as of this
change none applies to any registered provider.

#### Scenario: A provider is added

- **WHEN** a new provider is introduced
- **THEN** it is one directory under `packages/media/src/providers/`, added to
  the registry, and covered by the shared conformance suite — with no new
  workspace package, `package.json`, or `tsconfig.json`

#### Scenario: A provider's dependency is declared

- **WHEN** a provider requires a third-party package
- **THEN** that dependency is declared in `packages/media/package.json`

#### Scenario: A provider needs a different runtime

- **WHEN** a provider cannot run under the media package's runtime
- **THEN** a separate package is warranted, and the reason is recorded with it,
  because that is the condition this rule exists to allow rather than forbid

#### Scenario: A provider talks to a service this repository deploys

- **WHEN** a provider is the client for a service whose build lives in this
  repository
- **THEN** the service's build goes under `apps/` and the client goes into the
  media package — the two halves are separated rather than kept together in a
  provider package

#### Scenario: The reason for a separate package is checked, not assumed

- **WHEN** deciding whether a provider may keep its package
- **THEN** the whole directory is examined rather than its TypeScript alone, since
  the justification can be a file the source tree never imports

#### Scenario: Every registered provider is checked

- **WHEN** the registry is enumerated
- **THEN** every provider resolves to a directory under
  `packages/media/src/providers/`, and no `@maleo/media-provider-*` package
  remains in the workspace

### Requirement: One Implementation Of Reference Path Resolution

Resolution of a caller-supplied reference to a local file — including the
managed-surface allowlist and the `/uploads/` traversal guards — SHALL have
exactly one implementation, and every provider that resolves references SHALL
use it.

This is input validation at a trust boundary. Duplicating it puts the repository
one forgotten edit away from two providers disagreeing about which paths are
reachable, and a comment instructing a human to update the other copies is not a
mechanism.

#### Scenario: Two providers resolve references

- **WHEN** more than one provider accepts reference inputs
- **THEN** both call the same resolution function, and neither ships its own copy

#### Scenario: A traversal attempt is made through any provider

- **WHEN** a reference path attempts directory traversal, names an unmanaged
  surface, or targets a file outside the allowed roots
- **THEN** resolution refuses it, identically for every provider, because there
  is one code path to refuse it in

#### Scenario: The guard is changed

- **WHEN** the resolution rules are amended
- **THEN** one edit changes the behavior everywhere, and its tests cover the
  behavior once rather than per provider

### Requirement: Provider Guidance Survives Consolidation

The local contracts each provider package documented — model capability
handling, refusal behavior, health reporting absence rather than throwing, and
leaving retry to the durable orchestration — SHALL remain documented after the
packages are removed.

#### Scenario: A provider package's AGENTS.md is deleted

- **WHEN** a provider's package-local guidance file is removed
- **THEN** its contracts are carried into the media package's guidance in the
  same change, rather than being lost with the file

#### Scenario: An agent looks for a provider's rules

- **WHEN** someone needs to know what a provider is required to do
- **THEN** one guidance file answers it for every provider
