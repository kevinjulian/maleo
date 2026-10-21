# Web / API Separation

## Purpose

The backend (`@maleo/api`) runs as a standalone HTTP service exposing a language-agnostic REST/JSON + upload-asset contract, consumed by independent frontends (the `@maleo/web` client now, a future Rust desktop later). The web app reaches the api by reverse-proxying `/api` + `/uploads` to the api origin so the client stays same-origin and relative, with an optional configurable base URL for direct cross-origin deployment.

## Requirements

### Requirement: API runs as a standalone origin

The api (`@maleo/api`) SHALL run as an independent HTTP service that does not bundle, build, or serve the web client. It SHALL NOT own SPA client routes (e.g. `/`, `/content`, `/create`, `/settings`).

#### Scenario: API starts without the client

- **WHEN** the api process starts
- **THEN** it listens on its configured host and port and serves the `/api/*` REST endpoints and `/health` without importing any client HTML bundle

#### Scenario: Client route is not owned by the api

- **WHEN** a browser requests a client SPA path (e.g. `/content`) directly from the api origin
- **THEN** the api does not return the client HTML shell (that responsibility belongs to the web app)

### Requirement: API serves REST and upload assets over a language-agnostic contract

The api SHALL expose its functionality as REST/JSON endpoints under `/api/*` and continue to serve upload/media asset files, so that any client (TypeScript web, future Rust desktop) can consume it over HTTP without a language-specific SDK.

#### Scenario: REST endpoint returns JSON

- **WHEN** a client sends a request to an `/api/*` endpoint
- **THEN** the api responds with JSON using the existing response shapes

#### Scenario: Upload asset is retrievable by URL

- **WHEN** a client requests an upload/media asset path served by the api
- **THEN** the api streams the file if it exists and returns 404 otherwise

### Requirement: Web server bridges the client to the api

The web app SHALL reach the api without the client assuming they share an origin. By default the web server SHALL reverse-proxy `/api/*` and `/uploads/*` to the api origin (`MALEO_API_URL`), so client URLs stay relative and persisted storyboards keep relative asset URLs. The client SHALL additionally support a configurable absolute base URL for a direct cross-origin deployment without the proxy.

The web server SHALL also serve the client's own static assets — the web app manifest, the service worker and the icon set — from the web origin, resolved before the SPA catch-all. These are not api resources and SHALL NOT be proxied; they belong to the client bundle and are versioned with it.

The catch-all is what makes client-side deep links work, and it is also what makes a missing static route fail quietly: an unmatched asset request returns the HTML shell with a success status, so the browser reports a parse error rather than a routing error.

#### Scenario: API request is proxied to the api

- **WHEN** the browser issues an `/api/*` request to the web origin
- **THEN** the web server forwards it (method, headers, body, streamed response) to `MALEO_API_URL` and returns the api's response

#### Scenario: Upload asset is proxied to the api

- **WHEN** the browser requests an `/uploads/*` asset from the web origin
- **THEN** the web server forwards it to the api origin and streams the file back

#### Scenario: A client static asset is requested

- **WHEN** the browser requests a declared client asset such as the manifest, the service worker or an icon
- **THEN** the web server returns that file from the web origin with its own content type, without contacting the api

#### Scenario: SPA routes are served by the web app

- **WHEN** the browser requests a non-`/api`, non-`/uploads` path that is not a declared client asset (e.g. `/content`)
- **THEN** the web server returns the SPA HTML shell

#### Scenario: Direct cross-origin mode

- **WHEN** an absolute api base URL is configured for the client bundle (no proxy)
- **THEN** the client resolves api and asset URLs against that base instead of relative paths

### Requirement: API permits the web origin via CORS

The api SHALL allow cross-origin requests from configured web origins with credentials, and reject unconfigured origins.

#### Scenario: Configured web origin is allowed

- **WHEN** the web app at a configured origin makes a credentialed request to the api
- **THEN** the api returns the appropriate CORS headers and processes the request

#### Scenario: Unconfigured origin is rejected

- **WHEN** a request arrives from an origin not present in the CORS allowlist
- **THEN** the api does not grant cross-origin access to that origin

### Requirement: API configuration uses MALEO_API_* environment variables

The api SHALL read its host, port, public origin, and CORS allowlist from `MALEO_API_*` environment variables. The legacy `MALEO_DASH*` / `MALEO_DASHBOARD_*` names SHALL no longer be required.

#### Scenario: API reads renamed configuration

- **WHEN** `MALEO_API_HOST`, `MALEO_API_PORT`, `MALEO_API_ORIGIN`, and `MALEO_API_CORS_ORIGINS` are set
- **THEN** the api binds and configures CORS from those values without depending on the legacy `MALEO_DASH*` names

### Requirement: Wire types are shared, not client-local

The system SHALL declare the shapes crossing between the API and the web in the
shared package, so both sides compile against one contract. The web's HTTP client
module SHALL contain fetch functions, not a type library, and SHALL NOT re-export
symbols from other modules for import compatibility.

#### Scenario: A component needs a type, not a network call

- **WHEN** a module needs only the shape of a payload
- **THEN** it imports the type from the shared package without pulling in the HTTP client

#### Scenario: The server compiles against the same shape it sends

- **WHEN** a route builds a response the web consumes
- **THEN** both sides reference the same declaration

### Requirement: Row shapes stop at the API

The system SHALL map database rows to domain objects before answering, for every
payload the web consumes. Column names, `_json` blobs and 0/1 integers SHALL NOT
appear in a client-side type.

#### Scenario: Booleans cross as booleans

- **WHEN** the web reads a flag the database stores as an integer
- **THEN** it receives a boolean and performs no conversion

#### Scenario: Structured columns cross as structure

- **WHEN** a payload carries data the database stores as a JSON string
- **THEN** the client receives parsed, typed structure rather than an opaque record it probes field by field

### Requirement: The agent run contract is declared once

The wire format between the agent and the editor SHALL have exactly one declaration, in `@maleo/shared/agent-wire`, imported by both `apps/api` and `apps/web`. Neither side SHALL restate it.

The server's in-flight run state (`AgentJob` — transcript, pending tool, suspension cursor) is NOT part of the contract and stays private to the agent.

#### Scenario: A field is added to what a run sends

- **WHEN** a new field is added to the run contract
- **THEN** both the agent and the editor see it from the same declaration, and a consumer that fails to carry it is a type error rather than a silent drop

#### Scenario: The contract describes what actually crosses

- **WHEN** the editor sends a scene whose `sectionTransition` carries only some of its fields
- **THEN** the contract accepts it, because the server reads those fields defensively and never required them in practice

### Requirement: The client's API surface is split by domain

The web client's calls to the api SHALL be grouped by the resource they address, not gathered in one module. A surface that needs one domain SHALL NOT import the others.

#### Scenario: A screen uses content presets

- **WHEN** a component imports the calls for content presets
- **THEN** it does not thereby depend on the chat agent, the render pipeline or the catalogue

#### Scenario: Document transforms carry no network dependency

- **WHEN** a caller shapes a storyboard, brief, reference list or speaker list for persistence
- **THEN** it imports a pure module with no HTTP client behind it
