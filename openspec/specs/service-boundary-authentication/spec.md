# service-boundary-authentication Specification

## Purpose

The paths that authenticate a machine rather than an operator — the durable
execution sync endpoint and the internal configuration service — and the rule
that every such exemption from session authentication is declared, not inferred
from where it happens to be mounted.

## Requirements

### Requirement: The durable execution sync endpoint authenticates by signing key

The Inngest sync endpoint SHALL authenticate callers by the Inngest signing key
as verified by the SDK's own handler, and SHALL NOT be covered by session
middleware. A session cookie SHALL NOT grant access to it, and its absence SHALL
NOT refuse the Inngest server.

This boundary is named explicitly because its failure is silent: session
middleware over `/api/*` returns `401` to the Inngest server, which then reports
no functions, and every durable run stops without an error appearing in the API
logs.

#### Scenario: The Inngest server syncs

- **WHEN** the Inngest server requests the sync endpoint with a valid signature and no session cookie
- **THEN** the request succeeds and the registered functions are returned

#### Scenario: A browser session reaches the sync endpoint

- **WHEN** a request carrying a valid operator session but no valid signature reaches the sync endpoint
- **THEN** it is refused

#### Scenario: Session middleware is introduced over the API

- **WHEN** session middleware is mounted across `/api/*`
- **THEN** a test asserts the sync endpoint still answers an unauthenticated, correctly signed request

### Requirement: The internal configuration service authenticates by service token

The `/internal/*` paths, which serve decrypted provider credentials to this
system's own worker processes, SHALL authenticate by `MALEO_SERVICE_TOKEN` and
SHALL NOT accept a browser session in its place. The token SHALL be compared in
constant time. A request SHALL be refused when no token is configured, rather
than defaulting open.

These paths are dispatched before the `/api/*` application and are mounted on a
separate application that the cross-origin allowlist does not cover, so a
browser cannot reach them. That structural separation SHALL be preserved: it is
why a permissive origin on a sibling route cannot expose them.

#### Scenario: The worker fetches resolved provider configuration

- **WHEN** the media worker requests configuration with a valid service token and no session
- **THEN** the request succeeds

#### Scenario: A browser session calls a service route

- **WHEN** a request carrying an operator session but no service token reaches `/internal/*`
- **THEN** it is refused

#### Scenario: No service token is configured

- **WHEN** a request reaches `/internal/*` on a server with no service token configured
- **THEN** it is refused, and the refusal names the server's missing configuration without describing the presented token

#### Scenario: The service token is unset in production

- **WHEN** the API starts in production with the internal service mounted and no service token configured
- **THEN** it refuses to start, in addition to refusing each request, so the misconfiguration surfaces at deploy rather than at first use

### Requirement: Machine boundaries are declared, not inferred

The set of paths exempt from session authentication SHALL be declared in one
place and asserted by test. A path SHALL NOT become exempt as a side effect of
where it is mounted or of the order in which the dispatch resolves it.

The declaration SHALL span every application the server dispatches to, not only
the `/api/*` application. `/internal/*` is served by a separate application
reached before it, so a list covering one application would assert nothing about
the highest-value paths in the system.

#### Scenario: The exempt set is enumerated

- **WHEN** the paths exempt from session authentication are listed
- **THEN** the list matches the declared set exactly, and a path added outside it is covered by sessions

#### Scenario: The declaration covers the separate application

- **WHEN** the exempt set is checked
- **THEN** it names the internal service paths explicitly, rather than omitting them because they are not mounted on the `/api/*` application
