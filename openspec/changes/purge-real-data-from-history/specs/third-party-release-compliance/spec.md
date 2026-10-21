## ADDED Requirements

### Requirement: Publication starts from a fresh repository

The public release SHALL be created in a new Git repository named `maleo` from
one pinned, verified clean publication snapshot. The private repository's
existing commits, branches, tags, and object database SHALL NOT be copied,
rewritten, or pushed to the public repository.

#### Scenario: Public repository is created

- **WHEN** the project is prepared for public release
- **THEN** the publishable tracked tree from the pinned source commit is exported without Git history and committed as `maleo`'s root commit

#### Scenario: Private repository remains in use

- **WHEN** the public repository is created
- **THEN** the existing GitHub repository and its historical refs remain unchanged
- **AND** the current local checkout adopts fresh Maleo history only after independent verification, preserving ignored local runtime data

#### Scenario: Legacy history contains real data

- **WHEN** old private commits contain real user data
- **THEN** those commits and blobs remain private and unreachable from the public repository

### Requirement: Public OpenSpec contains current authority, not private history

The public repository SHALL include OpenSpec configuration, current main specs,
and active changes. It SHALL exclude private historical record. Included
OpenSpec artifacts SHALL pass the same public-tree privacy and credential checks
as source and configuration.

#### Scenario: Current product contract is published

- **WHEN** the publication snapshot is exported
- **THEN** `openspec/specs/` and OpenSpec configuration are included

#### Scenario: Active work continues publicly

- **WHEN** an OpenSpec change remains active at the pinned source commit
- **THEN** its current artifacts under `openspec/changes/` are included and scanned

#### Scenario: Archived proof remains private

- **WHEN** the publication snapshot is exported
- **THEN** private historical record is excluded and its historical operational proof is not copied to `maleo`

### Requirement: The exported snapshot covers every representation of data

Before publication, the pinned publication snapshot SHALL be checked for real user
data and credentials in text, structured fixtures, images, recordings,
snapshots, databases, and other rendered or binary forms. A clean text search
alone SHALL NOT qualify the snapshot for publication.

#### Scenario: Structured fixture is synthetic

- **WHEN** a fixture is included in the exported snapshot
- **THEN** its derived screenshots and other rendered artifacts are inspected or reproducibly generated from the same authored synthetic source

#### Scenario: Credential is found

- **WHEN** the snapshot check finds a credential
- **THEN** publication stops and the credential is removed and rotated before a new source commit is pinned

#### Scenario: Binary artifact cannot be searched as text

- **WHEN** the exported snapshot includes a binary or rendered artifact
- **THEN** that artifact is checked directly rather than treated as clean because text search found nothing

### Requirement: The published repository is verified independently

The new repository SHALL be verified from a fresh clone before it is declared
safe. Verification SHALL prove that the clone contains the intended tracked
snapshot, starts from the new root commit, and cannot reach objects from the
private repository's legacy history.

#### Scenario: Fresh clone is verified

- **WHEN** the new repository has been pushed
- **THEN** a fresh clone matches the publication manifest, including declared exclusions, and contains only the new repository's intended history

#### Scenario: Private commit is tested for reachability

- **WHEN** known private commit IDs and historical fixture blobs are checked from the fresh clone
- **THEN** they are unreachable

### Requirement: The visual suite cannot reacquire real data

The repository SHALL keep a cheap check that fails when committed visual
fixtures do not match their authored synthetic source. Guidance for refreshing
fixtures or baselines SHALL state that real workspace data must never be used.

#### Scenario: Recorded fixture is committed

- **WHEN** a fixture is added or replaced with content that did not come from the authored source
- **THEN** the check fails and names the file

#### Scenario: Baseline is refreshed

- **WHEN** a baseline image is added or updated
- **THEN** its review confirms that it was produced from authored synthetic fixture data

#### Scenario: Ordinary change runs CI

- **WHEN** a change touches neither fixture source nor generated fixture output
- **THEN** the provenance check remains cheap enough to run in normal CI
