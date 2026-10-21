# dead-surface-pruning Specification

## Purpose

What makes a module, table, route, config key, or export dead rather than merely
quiet, and what must be true after one is removed so the cut does not grow back
as a broken manifest entry, an orphaned test, or a comment describing a
mechanism that no longer exists.

Written after an audit of `packages/core` and `packages/shared` removed ~2,500
lines that nothing reached: a type barrel with no importer anywhere, 17 tables no
module read, an HTTP route serving a retired generation path, and a one-time
recovery still running on every database open.

## Requirements

### Requirement: A surface is removed at every layer it was declared

When a route, module, table, config key, or dependency is retired, the system
SHALL remove it from every layer that declared it — the implementation, the
package manifest, the config schema, the workspace documentation, and the tests
that covered it. A retired surface SHALL NOT survive as a manifest entry, a
script target, a barrel export, or an orphaned test.

The measure is that nothing names the removed surface outside git history and
archived OpenSpec artifacts.

#### Scenario: A removed route leaves no mount

- **WHEN** an HTTP route is retired
- **THEN** the router, its mount in the API entrypoint, and its tests are gone
  together, and no handler is registered under its path

#### Scenario: A removed module leaves no test behind

- **WHEN** a module whose only importer was its own test is deleted
- **THEN** that test is deleted in the same change, because a test whose subject
  is gone cannot fail and cannot pass for the right reason

#### Scenario: A removed dependency leaves the manifest

- **WHEN** the last import of a package dependency is deleted
- **THEN** the dependency is removed from `package.json` in the same change

### Requirement: A package manifest names only files that exist

A package's `package.json` SHALL NOT declare a `bin`, `exports` entry, or script
target that resolves to a path absent from the repository. A manifest entry
naming a missing file SHALL be removed rather than left to fail at invocation.

A package `description` SHALL describe what the package currently contains.

#### Scenario: A manifest entry names a deleted file

- **WHEN** a package declares a `bin` or `exports` path and no such file exists
- **THEN** the entry is removed, because an entrypoint that cannot resolve
  advertises a capability the package does not have

#### Scenario: A script targets a missing directory

- **WHEN** a `lint` or `format` script names a directory that does not exist
- **THEN** the script's target list is corrected to the directories the package
  actually has

### Requirement: An unreferenced table is undeclared without destroying data

When no module reads or writes a table, the system SHALL remove that table from
the schema declaration so fresh databases stop creating it. The change SHALL NOT
issue `DROP TABLE` against existing databases: an undeclared table left in place
is inert, whereas a drop is irreversible and cannot be reviewed after the fact.

#### Scenario: A fresh database omits the retired table

- **WHEN** a database is created after the declaration is removed
- **THEN** the retired table does not exist in it

#### Scenario: An existing database keeps its rows

- **WHEN** a database created before the change is opened afterwards
- **THEN** the retired table and its rows are still present and untouched, and
  the open succeeds

### Requirement: An abstraction with no second implementation is not kept for one

The system SHALL NOT retain a registry, factory, or callback-injection seam that
has exactly one product and no caller supplying an alternative. Such a seam SHALL
be replaced by the direct call it wraps.

#### Scenario: A registry holds one hardcoded entry

- **WHEN** a registry's only population is a single hardcoded registration and no
  code registers a second
- **THEN** the registry is removed and its one product is referenced directly, or
  both are removed if the product itself is unreached

#### Scenario: An optional accessor is never supplied

- **WHEN** an interface offers optional accessor callbacks and every call site
  omits them, so only the default branch ever runs
- **THEN** the accessors are removed and the defaults become the behaviour

### Requirement: Audited package surfaces are absent

Workspace SHALL remove audited surfaces with no production consumer: `/api/sources`, media `research` capability contracts, Core activity logging, `getStockAudioRateInfo`, legacy direct image transport, and legacy generation transport flags. Removal SHALL include mounts, exports, tests, manifests, configuration allowlists, current documentation, and comments that describe removed behavior.

#### Scenario: Stock discovery is inspected

- **WHEN** API routes and clients are inspected after pruning
- **THEN** `/api/sources` is absent
- **AND** `/api/stock` through `@maleo/stock` remains supported discovery path

#### Scenario: Media provider registry is inspected

- **WHEN** media capabilities and provider contracts are inspected
- **THEN** only implemented generated-media capabilities are declared
- **AND** API-owned research remains independent of media registry

#### Scenario: Compatibility exports are inspected

- **WHEN** package exports and their callers are scanned
- **THEN** `getStockAudioRateInfo` and activity logger are absent
- **AND** active callers use current owned APIs

#### Scenario: Generation configuration is inspected

- **WHEN** environment allowlists, runtime branches, tests, and current docs are scanned
- **THEN** `MALEO_DURABLE_GEN` and API use of `MALEO_IMAGE_URL` are absent
- **AND** media-worker configuration is sole generation transport configuration
