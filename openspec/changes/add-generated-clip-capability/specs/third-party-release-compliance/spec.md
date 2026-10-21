## ADDED Requirements

### Requirement: A Vendored Craft Ruleset Records Its Provenance

Third-party guidance vendored into this repository to steer generation SHALL be stored with
its upstream source, the exact commit it was taken from, and its licence text. It SHALL be
vendored rather than fetched at generation time, so a generation is reproducible and does not
depend on a third-party host being reachable.

#### Scenario: Vendored ruleset carries licence and commit

- **WHEN** the vendored ruleset directory is inspected
- **THEN** it contains the upstream licence text, the source repository, and the pinned commit

#### Scenario: Generation does not fetch the ruleset

- **WHEN** a clip is generated with no network access to the upstream host
- **THEN** generation proceeds using the vendored copy

### Requirement: Copyleft-Licensed Sources Are Read, Not Vendored

Material under a copyleft licence incompatible with this project's release boundary SHALL
NOT be copied into the repository, in source or in prose. Ideas may inform the design;
schemas, prompts and code SHALL be written independently.

#### Scenario: Copyleft material is excluded

- **WHEN** the repository is audited for third-party material
- **THEN** no file originates from a copyleft-licensed project outside the declared boundary
