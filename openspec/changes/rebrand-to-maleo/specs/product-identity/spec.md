# Product Identity Delta

## Purpose

Define the Maleo identity across the application, contributor interfaces, and deployment configuration while preserving user data during cutover.

## ADDED Requirements

### Requirement: Maleo is the active product identity

The application SHALL identify itself as Maleo. Active UI, accessibility labels, first-party metadata, logs, generated artifacts, and current documentation SHALL contain no former product identity. README SHALL show the supplied Maleo logo through a committed relative asset reference. App navigation and authentication surfaces SHALL display the same logo without changing unrelated editor geometry.

#### Scenario: Operator opens the application

- **WHEN** an operator opens sign-in, navigation, or an editor page
- **THEN** visible product identity and accessible brand labels use Maleo and the supplied logo
- **AND** the former product name does not appear in the browser title or rendered app

#### Scenario: Contributor reads the repository

- **WHEN** a contributor opens README and current operational documentation
- **THEN** the product name, logo, package examples, configuration examples, and release instructions identify Maleo
- **AND** the logo remains available from a clean checkout without the original Downloads file

### Requirement: Technical identity uses only the Maleo namespace

First-party package names SHALL use `@maleo/*`. Branded Rust crates, build outputs, service identities, browser storage keys, and new API keys SHALL use Maleo names. The runtime SHALL read `MALEO_*` variables instead of `AINCER_*`. Old names SHALL NOT be exported, accepted as aliases, or read as fallbacks. Unbranded third-party configuration names SHALL remain unchanged.

#### Scenario: Fresh checkout is installed and built

- **WHEN** a contributor installs locked dependencies and builds the project
- **THEN** workspace resolution, Rust compilation, and browser engine loading succeed using Maleo identifiers only
- **AND** no old namespace compatibility exports are required

#### Scenario: Operator configures a process

- **WHEN** configuration is supplied under `MALEO_*` names
- **THEN** each service uses those values through documented configuration paths
- **AND** values supplied only under `AINCER_*` names are not used as configuration

#### Scenario: Third-party configuration is retained

- **WHEN** a service uses configuration owned by a third-party dependency
- **THEN** names such as `INNGEST_APP_ID` retain their third-party spelling
- **AND** first-party branded values use Maleo identities

### Requirement: Cutover preserves owned data without runtime aliases

The release SHALL provide an explicit cutover procedure for existing environments. It SHALL preserve accounts, memberships, projects, media references, stored provider credentials, and required secret values. Resource renaming SHALL NOT silently initialize an empty replacement database or discard a persistent volume. Browser preferences SHALL either be converted before deployment or have their reset documented. Credentials that cannot be safely converted SHALL have a documented replacement and invalidation procedure.

Persisted branded setting keys and secret-envelope fingerprint metadata SHALL be converted by an explicit offline operation before the new runtime reads them. Conversion SHALL preserve master-key value, encrypted payloads, and all existing SQL migration checksums. Normal startup SHALL NOT perform former-name fallback reads or automatically convert an installation.

#### Scenario: Existing installation changes names

- **WHEN** an operator follows cutover instructions on an isolated copy of existing state
- **THEN** the Maleo runtime can access the same owned records, referenced media, and encrypted provider credentials
- **AND** database, role, volume, and durable service identity changes are explicit
- **AND** runtime operation requires no former-name aliases

#### Scenario: Stored configuration and credentials survive conversion

- **WHEN** stopped pre-cutover state contains branded setting keys and an envelope with one wrapping and no pending rotation
- **THEN** explicit conversion changes setting keys and fingerprint metadata to Maleo identities
- **AND** the same master key reads the same provider credentials and sealed workspace values through the new runtime
- **AND** encrypted payloads and existing SQL migration checksums remain unchanged

#### Scenario: Conversion preconditions fail

- **WHEN** a destination setting key already exists, the master key is missing or wrong, an envelope is malformed, or rotation is pending
- **THEN** conversion fails with an actionable error and commits no changes
- **AND** the error contains no key material, secret values, or connection credentials

#### Scenario: Operator repeats completed conversion

- **WHEN** explicit conversion runs against fully converted state
- **THEN** it verifies the state and makes no changes
- **AND** ambiguous mixed state is refused without deleting either setting version

#### Scenario: Existing API keys require replacement

- **WHEN** a key contains the former product prefix and its secret cannot be reconstructed from stored hashes
- **THEN** the procedure requires a new Maleo key and client configuration update
- **AND** old keys are invalidated before cutover is declared complete
- **AND** migration does not fabricate a replacement secret or print credentials

### Requirement: Active identity is checked separately from historical records

Repository checks SHALL detect the former product identity in active first-party source, configuration, documentation, and produced first-party artifacts. Historical Git records, released changelog sections, and archived OpenSpec records SHALL remain historical evidence. User-authored content and upstream license notices SHALL NOT be rewritten as product branding. Explicitly identified cutover instructions, offline conversion input definitions, and negative test fixtures SHALL be narrowly scoped exceptions. These exceptions SHALL NOT permit former identity or compatibility readers in normal runtime code or bundles.

#### Scenario: Old identity returns to active code

- **WHEN** a first-party active surface contains a former product identifier
- **THEN** the identity check fails with the offending file and location

#### Scenario: Historical evidence contains the old name

- **WHEN** an archived proposal, released changelog entry, user-authored content, or upstream attribution contains the old name
- **THEN** it is preserved without being shipped as active first-party branding

#### Scenario: Conversion exception does not exempt runtime code

- **WHEN** a former identifier appears in normal runtime code beside an allowed offline conversion definition
- **THEN** the identity check still reports the runtime identifier as a failure
