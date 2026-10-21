# durable-execution-hosting Specification

## Purpose

Which durable execution backend a deployment uses and the operational duties a
self-hosted server carries: how the backend is selected, how function hosts are
identified, how the server is pinned, checked and fenced, and how its history is
bounded. Written because the failures here are silent — a colliding app id stops
runs with no error in any process, and an unbounded history table degrades the
server with nothing pointing at the cause.

## Requirements

### Requirement: A deployment selects its durable execution backend by configuration

A deployment SHALL reach either a hosted Inngest service or a self-hosted Inngest
server, selected by `INNGEST_BASE_URL` and its keys. Function code, event names,
and function identifiers SHALL be identical for both.

The self-hosted server is licensed under SSPL-1.0. A deployment that offers the
product to third parties as a service SHALL record which backend it uses, so the
licence question is answered by the deployment record rather than by inspection.

#### Scenario: A deployment is recorded

- **WHEN** a deployment is configured
- **THEN** its durable execution backend is named in the deployment record alongside its other settings

#### Scenario: Switching backends

- **WHEN** a deployment changes from a self-hosted server to a hosted service
- **THEN** only the base URL and keys change, and no function code is edited

### Requirement: Each function host registers under a distinct app identifier

Every process serving durable functions SHALL register with an app identifier
unique among the processes sharing one Inngest server, and that identifier SHALL
be supplied as deployment configuration rather than inherited from a package
script.

Two hosts sharing an identifier cause the second sync to replace the first. The
displaced functions then have no handler, their events trigger nothing, and no
error is produced by either process.

#### Scenario: The media worker is deployed

- **WHEN** the media worker is deployed
- **THEN** its app identifier is set in the deployment platform, and is distinct from the API's

#### Scenario: A host starts with a colliding identifier

- **WHEN** two function hosts register with the same app identifier
- **THEN** a check detects the collision rather than leaving it to be discovered by runs that never start

#### Scenario: A process is started by a path other than its package script

- **WHEN** a deployed process is started directly rather than through its package script
- **THEN** its app identifier is still correct, because it comes from the environment

### Requirement: The self-hosted server is pinned, checked, and fenced

A self-hosted Inngest server SHALL be pinned to an explicit image tag, SHALL have
a healthcheck that fails when its durable state backends are unreachable, and
SHALL NOT expose its dashboard port to an unauthenticated public address.

The server ships no authentication of its own. Its dashboard port also serves the
event API, so exposing one exposes both.

#### Scenario: The image is deployed

- **WHEN** the self-hosted server is deployed
- **THEN** its image is pinned to an explicit tag, not a moving one

#### Scenario: The database is unreachable at startup

- **WHEN** the server starts and cannot reach its Postgres or Redis backend
- **THEN** its healthcheck fails, and the deployment is not reported healthy

#### Scenario: The dashboard is reachable

- **WHEN** the server's dashboard port is given a public address
- **THEN** authentication is configured at the proxy in the same operation

### Requirement: Durable state retention is bounded by a scheduled task

A self-hosted deployment SHALL run a scheduled task that removes completed
durable run history beyond a stated retention period.

The Inngest documentation states the server does not delete old rows and that
table growth degrades performance. Runs paused awaiting operator input are held
for up to twenty-four hours, so rows accumulate at the rate operators work.

#### Scenario: A deployment runs for months

- **WHEN** a self-hosted deployment has been running long enough to accumulate completed runs
- **THEN** a scheduled task has removed history beyond the stated retention period

#### Scenario: Retention is undefined

- **WHEN** a self-hosted deployment is configured without a retention period
- **THEN** the deployment record is incomplete and the gap is visible
