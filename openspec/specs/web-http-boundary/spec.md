# web-http-boundary Specification

## Purpose

TBD - created by archiving change split-web-api-client. Update Purpose after archive.

## Requirements

### Requirement: Every browser request resolves its origin through one layer

All HTTP requests made by the web client SHALL resolve their path through `apiUrl()`, which lives in `apps/web/src/models/core/asset-url.ts` and is re-exported by the fetch client at `apps/web/src/api/client.ts`. No module outside that client SHALL pass an unresolved `/api` path to `fetch()`.

This exists because `apiUrl()` is what applies `API_BASE` (from `MALEO_API_URL`). A call that skips it resolves against the web origin, which is correct only in the default reverse-proxy deployment and wrong in the documented cross-origin one.

`apiUrl()` sits outside the fetch client because resolving a path against an origin is string work, not a request: pure modules need it, and the layering check forbids a `models` module importing `api`.

The boundary is defined by the module, not by its path. It has now moved twice — from `shared/` to `services/api/client.ts`, and from there to `api/client.ts` — and the guard SHALL be written so a third move fails loudly rather than silently scanning a directory that no longer exists.

#### Scenario: A cross-origin deployment reaches the api

- **WHEN** `MALEO_API_URL` is set so `API_BASE` is non-empty
- **THEN** every client request — including chat-agent, run history, TTS, upload, animate, credits and render download — targets the api origin, not the web origin

#### Scenario: A new bypass cannot be introduced silently

- **WHEN** a source file under `apps/web/src` other than `api/client.ts` calls `fetch()` with a path beginning `/` or with the api base
- **THEN** the boundary guard test fails, naming the file and the path

#### Scenario: The guard survives the module move

- **WHEN** the boundary guard test runs after modules relocate from `services/api/` to `api/`
- **THEN** it resolves the new path and still fails on a planted bypass, rather than passing because it scanned a directory that no longer exists

#### Scenario: The guard's own target disappears

- **WHEN** the path the guard scans does not resolve to a file
- **THEN** the guard fails rather than reporting no violations, because a scan of nothing and a scan finding nothing are indistinguishable in a passing result

### Requirement: An expired session behaves the same everywhere

Every helper in the HTTP boundary SHALL redirect to `/login` on a 401 response,
and `/login` SHALL be a surface that exists and can complete a sign-in.

Until this change the redirect target was a route with nothing behind it, which
was harmless only because nothing returned 401. Once the API refuses anonymous
requests, every unauthenticated load reaches it, so a redirect to a missing
surface is an infinite loop rather than a dead end.

#### Scenario: A session expires mid-generation

- **WHEN** any client request returns 401
- **THEN** the browser navigates to `/login` rather than surfacing a raw error to the caller

#### Scenario: An unauthenticated operator opens the application

- **WHEN** the application is loaded with no valid session
- **THEN** `/login` renders a sign-in surface, and completing it returns the operator to the path they requested

#### Scenario: The first run has no accounts

- **WHEN** the application is loaded against a deployment with no accounts
- **THEN** it presents owner creation rather than sign-in, so the first operator is not asked for a credential that cannot exist

### Requirement: The web proxy forwards session credentials unchanged

The web server's proxy for `/api/*` and `/uploads/*` SHALL forward the request's
session cookie to the API and SHALL return the API's `Set-Cookie` headers to the
browser unmodified.

The proxy is what makes the API same-origin from the browser's point of view. If
it dropped or rewrote cookies, sign-in would appear to succeed and every
subsequent request would be anonymous — the session would exist server-side with
nothing able to present it.

#### Scenario: A signed-in request is proxied

- **WHEN** a browser request carrying a session cookie is proxied to the API
- **THEN** the API receives that cookie unchanged

#### Scenario: Sign-in is proxied

- **WHEN** the API answers a sign-in with a `Set-Cookie` header
- **THEN** the browser receives it unmodified, and the following request is authenticated

#### Scenario: A media file is proxied

- **WHEN** a `/uploads/*` request is proxied, including a range request
- **THEN** the session cookie is forwarded, so the API can authorise it rather than refusing every media load

### Requirement: Absence and failure are different answers

A helper that tolerates a missing resource SHALL treat only 404 as absence. Any other unsuccessful status SHALL raise.

This distinction is load-bearing for "is a run already in flight?": reporting absence on a server error invites the caller to start a second run.

#### Scenario: The server errors while reporting the current job

- **WHEN** `GET /projects/{id}/chat` returns 500
- **THEN** the caller receives an `ApiError` carrying the status, and does NOT receive null

#### Scenario: No run is in flight

- **WHEN** the same request returns 404
- **THEN** the caller receives null and may start a run
