# third-party-release-compliance Specification

## Purpose

Define public-release boundaries for third-party licensing, integration methods,
fixture privacy, asset provenance, outbound data, hosting, and history cleanup.

## Requirements

### Requirement: MIT Scope Is Explicit

Repository SHALL state that MIT covers Maleo-owned code and SHALL NOT imply that
third-party dependencies, models, fonts, media, trademarks, or generated outputs
are relicensed under MIT. Retained third-party material MUST have its applicable
license or terms recorded in `THIRD_PARTY_NOTICES.md`.

#### Scenario: Reader checks project license

- **WHEN** a reader opens root README, `LICENSE`, and third-party notices
- **THEN** reader can distinguish Maleo-owned MIT code from separately licensed
  material
- **AND** Remotion and every shipped model/service image are identified with
  applicable license link and deployment caveat

### Requirement: Supported Integrations Avoid Prohibited Automation

Current source tree SHALL NOT ship an integration whose documented operation
depends on scraping pages, automating hidden browser tabs, intercepting browser
traffic, or bulk-downloading content where provider terms prohibit that method.
Supported third-party retrieval SHALL use documented APIs or explicit written
provider permission with operator-owned credentials.

#### Scenario: Maintainer audits integration methods

- **WHEN** active integrations and their docs are inspected before public release
- **THEN** each retrieval path names documented API used or recorded permission
- **AND** no HTML-page fallback silently substitutes for missing API access

### Requirement: Stock Provenance Reaches User Surface

Stock search result contracts SHALL preserve source page, creator identity and
profile link, asset license and license link when provider supplies them. User
surface SHALL show provider-required links before or alongside asset admission.

#### Scenario: Pexels result is shown

- **WHEN** editor displays Pexels image or video result
- **THEN** result links to Pexels and available creator page instead of showing
  plain unlinked provider text

#### Scenario: Freesound result is shown

- **WHEN** editor displays Freesound sound result
- **THEN** result identifies creator and asset license with available source links

### Requirement: Tracked Fixtures Are Synthetic

Repository SHALL NOT track captured production HAR responses, real customer or
workspace payloads, private issue records, secrets, personal email addresses, or
maintainer-specific deployment identifiers in current fixtures and configuration.
Test fixtures MUST use deterministic synthetic identities and example domains.

#### Scenario: Public-tree hygiene scan runs

- **WHEN** release check scans tracked current tree
- **THEN** it fails on known live-data fixture shapes, personal infrastructure
  patterns, secret patterns, or retired private task-store paths

### Requirement: Retained Assets Have Provenance

Every retained non-code asset distributed by repository MUST have documented
origin and redistribution terms compatible with its use. Asset without provable
origin or permission SHALL be replaced or removed.

#### Scenario: Asset inventory is reviewed

- **WHEN** maintainer reviews fonts, icons, images, audio, and sample media
- **THEN** each retained asset maps to source and license/permission record
- **AND** unknown assets are absent from publishable tree

### Requirement: Outbound Data And Hosting Boundary Are Disclosed

Repository SHALL provide `PRIVACY.md` describing local stored data and data sent
to each supported external provider. Public deployment guidance MUST state that
loopback API has no login and SHALL NOT be directly exposed without application
authentication or authenticating reverse proxy.

#### Scenario: Operator enables external provider

- **WHEN** operator reads provider setup before supplying credentials
- **THEN** operator can identify which prompts, text, reference files, search
  terms, or other content leaves machine

#### Scenario: Operator plans public hosting

- **WHEN** operator follows deployment guidance
- **THEN** guidance requires authentication boundary before accepting other
  users' data

### Requirement: History Cleanup Requires Explicit Confirmation

Current-tree cleanup and full-history inventory SHALL precede publication. Any
destructive rewrite of unpublished Git history MUST require explicit maintainer
confirmation and recoverable mirror backup; implementation SHALL NOT rewrite or
force-push history automatically.

#### Scenario: Sensitive historical object is found

- **WHEN** full-history scan finds removed private or prohibited material
- **THEN** implementation reports exact paths/commits and stops for explicit
  confirmation before rewrite
