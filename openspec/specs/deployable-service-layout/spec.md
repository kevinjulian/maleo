# deployable-service-layout Specification

## Purpose

Where a directory that builds a deployed artifact lives, what moving one obliges
a change to do, and which of its settings must be committed rather than left in
the deploy platform. Written because a deploy path can live entirely outside this
repository: no gate here can see it, so a move that breaks it passes every check
and fails in production. The same blindness applies to the runtime options,
resource limits and access controls a service depends on, which is why those are
covered here too.

## Requirements

### Requirement: Moving A Deployable Updates Its Deploy Configuration

When a deployable directory moves or is renamed, every external deploy setting
that names its path SHALL be updated as part of the same change, and the change
SHALL record which settings were updated and where they live.

The build path lives in the deploy platform's own configuration, not in this
repository, so no repository gate can catch a move that breaks it. With
auto-deploy enabled, the failure surfaces as a broken production build on the
next push to the default branch — after the change has already merged.

#### Scenario: A deployable directory is relocated

- **WHEN** a directory that a deploy target builds from is moved
- **THEN** the deploy target's base directory and any path-watch triggers are
  updated in the same operation, before or with the push that moves the files

#### Scenario: The change is reviewed

- **WHEN** a change moves a deployable directory
- **THEN** it names the deploy target and the specific settings that had to
  change, because a reviewer cannot see them in the diff

#### Scenario: The move is verified

- **WHEN** the move is complete
- **THEN** the service is confirmed rebuilt and healthy from its new path, rather
  than assumed from a green repository build — the repository gates cannot
  observe the deploy at all

### Requirement: A Service Move Does Not Change What Is Served

Relocating a deployable directory SHALL NOT alter the artifact it produces or
the interface it exposes.

#### Scenario: The service is rebuilt from the new path

- **WHEN** the deploy target builds from the relocated directory
- **THEN** the resulting image, its exposed port, its healthcheck, and its public
  address are unchanged, so the move is invisible to every caller

#### Scenario: A move is combined with a behavior change

- **WHEN** someone wants to change what the service does as well as where it
  lives
- **THEN** those are separate changes, because a failed deploy after a combined
  change cannot be attributed to the move or the behavior without unpicking both

### Requirement: Configuration A Service Needs In Order To Run Lives In The Image

Configuration without which a deployed service does not work — a required setting, a format that is
disabled by default, an engine or feature list that is a deliberate choice — SHALL be part of the
build context and baked into the image, not held only in the deploy platform's configuration.

Secrets SHALL NOT be baked. A credential, token, or signing key SHALL be supplied as an environment
variable at deploy time.

The reason is the reason this capability already exists: the deploy platform's configuration is
invisible to every gate in this repository. Configuration that decides whether the service answers
requests at all belongs where it can be reviewed in a diff and where a change to it is a deploy.

#### Scenario: A required setting is disabled by default upstream

- **WHEN** a service needs a non-default setting in order to serve its API
- **THEN** that setting is in a config file in the directory's build context
- **AND** changing it rebuilds and redeploys the image

#### Scenario: A deliberate choice narrows upstream behavior

- **WHEN** a service's upstream default includes behavior that is deliberately not wanted
- **THEN** the narrowed configuration is committed, with the reason recorded beside it

#### Scenario: A secret is required at runtime

- **WHEN** a service requires a credential or signing key
- **THEN** it is read from the environment at deploy time and is absent from the image and from the
  repository

### Requirement: A Service Without Its Own Authentication Is Fenced Before It Is Exposed

A deployed service that has no authentication of its own SHALL NOT be reachable anonymously once it
has a public address. Access SHALL be restricted at the proxy, and the restriction SHALL be in place
in the same operation that gives the service its public address.

A service that authenticates its own callers SHALL NOT depend on a proxy fence for that purpose, and
SHALL be recorded as self-authenticating so the fence is not mistaken for its only protection. The
API is self-authenticating once `operator-authentication` is in place. Every other deployed service
in this repository — the Inngest server, the TTS services, SearXNG, Crawl4AI — is not, and remains
fenced.

Transport SHALL be HTTPS-only, because a proxy credential sent over plain HTTP is a credential in
the clear.

A service that accepts a caller-supplied URL and fetches it SHALL additionally require its own
credential, independent of the proxy's. Such a service is a fetch proxy into the network it runs in,
so a single leaked credential must not be sufficient to use it.

#### Scenario: A service with no built-in auth gets a public address

- **WHEN** a service that cannot authenticate its own callers is given an FQDN
- **THEN** proxy-level authentication is configured as part of the same operation
- **AND** the service is confirmed to reject an unauthenticated request

#### Scenario: A request arrives over plain HTTP

- **WHEN** a caller reaches the service over HTTP rather than HTTPS
- **THEN** it is redirected or refused, so no credential is transmitted unencrypted

#### Scenario: A service fetches URLs on request

- **WHEN** a deployed service retrieves a URL supplied by its caller
- **THEN** it requires its own credential in addition to the proxy's
- **AND** neither credential alone grants use of it

#### Scenario: Client-side URL validation is not treated as the control

- **WHEN** a caller of a fetching service validates URLs before sending them
- **THEN** that validation is understood to protect only that caller's own requests, and is not
  counted as protection of the service

#### Scenario: The API is exposed

- **WHEN** the API is given a public address
- **THEN** it is exposed without a proxy fence, because it refuses unauthenticated requests itself
- **AND** that self-authenticating status is recorded with the deployment

#### Scenario: The durable execution server is exposed

- **WHEN** the Inngest server's dashboard port is given a public address
- **THEN** proxy authentication is configured in the same operation, because the server ships none

### Requirement: Runtime And Security Settings That Live Only In The Platform Are Recorded

A deployable directory's guidance SHALL record every deploy-platform setting the service depends on,
not only the build path. This includes the exposed port, the healthcheck, container runtime options,
resource limits, proxy middleware, and the names of the secrets it requires.

Recording the names of secrets is required; recording their values is forbidden.

The build path is already covered because a move breaks it silently. A runtime option, a memory
limit, or an auth middleware fails the same way: it exists in one database, no gate here can observe
it, and its absence is discovered in production.

#### Scenario: A service needs a container runtime option

- **WHEN** a service only functions with a non-default container option, such as a larger shared
  memory size
- **THEN** that option is recorded in the directory's guidance alongside the build settings

#### Scenario: A service is given a resource limit

- **WHEN** a limit is set so the service cannot exhaust the host and take unrelated services with it
- **THEN** the limit and its reason are recorded

#### Scenario: A reviewer reads the directory's guidance

- **WHEN** someone needs to know what makes this service work in production
- **THEN** the guidance names every platform-side setting, so nothing load-bearing is discoverable
  only by opening the deploy platform

#### Scenario: A secret is recorded

- **WHEN** a service requires a credential
- **THEN** its environment variable name appears in the guidance and its value does not

### Requirement: Durable function bodies live with their domain hosts

Agent-run function code SHALL live in API, and generated-media function code SHALL live in media. `@maleo/inngest` SHALL contain shared client and event contracts only and SHALL NOT require a callback-registration seam for one domain implementation.

#### Scenario: Inngest invokes agent work

- **WHEN** Inngest invokes API sync endpoint for an agent event
- **THEN** API-owned function calls API-owned granular runtime directly
- **AND** function id, event name, step ids, retries, cancellation, concurrency, and idempotency behavior remain unchanged

#### Scenario: Inngest invokes generation work

- **WHEN** Inngest invokes media-worker sync endpoint for a generation event
- **THEN** media-owned function performs provider selection, generation, and persistence

### Requirement: A Live Deployment Target Is Recorded In The Repository

A deployed service SHALL have its target recorded in the repository: the platform
resource, the build path, the watch paths, the exposed port, its healthcheck, and
whether it authenticates its own callers. The record SHALL be updated in the same
change that alters any of them.

A deploy path can live entirely outside this repository, so nothing here can
detect that it has drifted. The record is the only thing that makes a broken
deploy visible to a reader.

#### Scenario: A reader looks for where a service is deployed

- **WHEN** a reader opens the guidance for a deployed service
- **THEN** it names the platform resource, build path, watch paths, port, and healthcheck

#### Scenario: A service's port or build path changes

- **WHEN** a change alters a deployed service's port, build path, or healthcheck
- **THEN** the deployment record is updated in the same change

#### Scenario: A service is deployed for the first time

- **WHEN** a service that previously had no recorded target is deployed
- **THEN** its record is filled in rather than left stating that no target exists

### Requirement: Services That Must Resolve Each Other By Name Are Deployed Together

Services that address each other by internal name SHALL be deployed as one unit
that shares a network. A deployment SHALL NOT rely on cross-resource name
resolution that the platform does not guarantee.

Inngest invokes functions over HTTP, so the server must reach the API and the
media worker by name, and they must reach the server. Separate platform
resources are not guaranteed to share a network.

#### Scenario: The core services are deployed

- **WHEN** the API, web, media worker, and durable execution server are deployed
- **THEN** they share one network and resolve each other by service name

#### Scenario: A service is extracted to its own resource

- **WHEN** a service that others address by internal name is moved to a separate platform resource
- **THEN** the addresses its callers use are updated in the same change, and the move is verified by a call between them

#### Scenario: A service is reached only by URL

- **WHEN** a service is addressed only by a configured URL
- **THEN** it may be deployed as its own resource, because no name resolution is assumed

### Requirement: Configuration A Process Needs Is Set At The Platform, Not Inherited From A Script

Configuration a deployed process requires SHALL be set in the deployment
platform. A process SHALL NOT depend for correctness on a variable that only its
development package script sets.

The media worker's app identifier is set by its `dev` and `start` scripts. A
platform that runs the entrypoint directly produces a silently wrong identifier.

#### Scenario: A process is started directly

- **WHEN** a deployed process is started by its entrypoint rather than its package script
- **THEN** it has every variable it needs, because they are set at the platform

#### Scenario: A package script sets a variable a process requires

- **WHEN** a package script sets a variable the process depends on for correctness
- **THEN** that variable is also recorded as required deployment configuration

### Requirement: A Deployable Artifact Lives Under `apps/` Or `infra/`

A directory whose purpose is to build a deployed artifact — a Dockerfile, an
image, a service — SHALL live under `apps/`, `infra/`, or `deploy/`, never under
`packages/`.

`packages/` holds code other code imports. A directory that a deploy target
builds is a different kind of thing, and putting it beside libraries makes its
nature discoverable only by reading a `.dockerignore`.

Which home applies is decided by what the directory contains. A directory
holding maleo source — a workspace with a `package.json`, code that imports
`packages/*` — SHALL live under `apps/`. A directory holding only the
configuration that deploys third-party software — a Dockerfile over an upstream
image, a committed settings file, an upstream image pin — SHALL live under
`infra/`. A compose stack that assembles the deployed product — building maleo
images from this repository and wiring them to the services they need — SHALL
live under `deploy/`.

`infra/` sits at the repository root rather than inside `apps/` so that a moved
directory keeps its depth, and therefore keeps every relative build context
inside it unchanged.

None of the three homes other than `apps/` is a workspace root: a directory
under `infra/` or `deploy/` SHALL NOT carry a `package.json`, because code that
other code imports belongs in `packages/`.

#### Scenario: A service and its client share a directory

- **WHEN** a directory holds both the build for a service and the client code
  that calls it
- **THEN** they are separated: the build moves under `apps/` or `infra/` by the
  test above, and the client moves to whichever package owns that domain

#### Scenario: A reader looks for what gets deployed

- **WHEN** someone asks which directories produce deployed artifacts
- **THEN** the answer is the contents of `apps/`, `infra/`, and `deploy/`,
  without inspecting build ignore files to find one hiding under `packages/`

#### Scenario: A reader looks for what this repository builds from its own source

- **WHEN** someone asks which deployables are built from maleo source
- **THEN** the answer is the contents of `apps/`, with no third-party service
  configuration mixed into the listing

#### Scenario: A deployable directory is added

- **WHEN** a new deployable artifact is introduced
- **THEN** it lands under `apps/` if it holds maleo source, under `infra/` if
  it only configures third-party software, and under `deploy/` if it is a stack
  assembling maleo images, with guidance stating that it builds a deployed
  image and what that constrains

#### Scenario: A deployment description references source that lives elsewhere

- **WHEN** a compose file's build contexts reach Dockerfiles owned by `apps/`,
  `packages/`, or the repository root
- **THEN** it lives under `deploy/`, not `infra/`, and the referenced
  Dockerfiles stay with their owners

### Requirement: The core deployment stack lives under deploy

The compose stack that deploys the core — web, API, media worker, the runtime
database, the media store, and the self-hosted Inngest server with its Postgres
and Redis — together with its local override, its environment example, and its
deployment record SHALL live under `deploy/`. Shared TypeScript client and event
contracts SHALL remain under `packages/inngest` and SHALL NOT import deployment
material.

#### Scenario: Reader looks for the production stack

- **WHEN** a reader lists the repository root
- **THEN** `deploy/` identifies the stack that deploys the product
- **AND** no deployment directory remains inside `packages/inngest`, `apps/`,
  or `infra/inngest`

#### Scenario: Development starts local Inngest

- **WHEN** operator runs root development command
- **THEN** gitignored standalone dev binary still starts on port 8288
- **AND** production compose stack is not required for local development

### Requirement: Self-host and Coolify compose files stay in step

The core stack SHALL ship as two complete compose files under `deploy/`:
`docker-compose.yml` for plain `docker compose` and `docker-compose.coolify.yml`
for Coolify. They SHALL differ only by comments, Coolify's `SERVICE_FQDN_*`
routing declarations, and the `ports:` the self-host file publishes. A
repository gate SHALL fail on any other difference.

#### Scenario: A service changes in one file only

- **WHEN** a change edits a service in one compose file and not the other
- **THEN** `bun run check:deploy` fails, naming the service and the line

#### Scenario: A self-hoster runs the stack

- **WHEN** an operator runs `docker compose -f deploy/docker-compose.yml up -d`
- **THEN** `web`, `api` and `rustfs` are reachable on `MALEO_BIND_ADDRESS` for
  a reverse proxy, and `inngest` is not published
