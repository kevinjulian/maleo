# workspace-package-pruning

## Purpose

Ensure retired workspace packages can be hard-deleted without leaving active scripts, references, package docs, or service docs behind, while preserving unrelated product concepts that share naming.

## Requirements

### Requirement: Removed packages absent from workspace

The workspace SHALL NOT include `packages/news` or `packages/chatterbox` as package directories, workspaces, TypeScript projects, path aliases, package-manager lock entries, or root run scripts after package pruning.

#### Scenario: Workspace references removed

- **WHEN** the repo is searched for active package identifiers `@maleo/news`, `@maleo/chatterbox`, `packages/news`, and `packages/chatterbox`
- **THEN** no references remain outside historical OpenSpec artifacts or git history

#### Scenario: Root commands omit retired services

- **WHEN** root dev and package scripts are inspected
- **THEN** they do not expose or launch `news` or `chatterbox` package commands

### Requirement: Package-local materials hard deleted

The package pruning process SHALL delete all package-local materials under `packages/news` and `packages/chatterbox`, including source files, scripts, Docker files, package-local documentation, package-local AGENTS instructions, package-local lockfiles, env examples, and ignored runtime artifacts.

#### Scenario: Package directories removed

- **WHEN** the change is applied
- **THEN** `packages/news` and `packages/chatterbox` do not exist in the working tree

#### Scenario: News runtime database removed

- **WHEN** the change is applied
- **THEN** ignored files `packages/news/news.sqlite`, `packages/news/news.sqlite-shm`, and `packages/news/news.sqlite-wal` are gone with the package directory

### Requirement: Current docs match workspace topology

Current repo documentation and DOX indexes SHALL NOT describe `@maleo/news` or `@maleo/chatterbox` as active workspace packages, services, commands, environment variables, verification targets, or child DOX entries.

#### Scenario: Documentation indexes cleaned

- **WHEN** root docs, codemaps, and AGENTS indexes are inspected after removal
- **THEN** they list only packages and services that still exist in the workspace

### Requirement: Unrelated news concepts preserved

Package pruning SHALL preserve unrelated uses of `news` that are content concepts, test fixtures, or style identifiers rather than references to `@maleo/news`.

#### Scenario: Product concepts remain

- **WHEN** pruning removes package/service references
- **THEN** unrelated identifiers such as `news-explainer`, `announcement` text mentioning news, and `news.example` test URLs remain unless another change explicitly modifies them

### Requirement: Removing A Feature Removes Its Modules

When a feature's call sites are removed, the modules that served it SHALL be
removed in the same pass, or recorded as deliberately retained with a reason.

#### Scenario: A refactor deletes the callers and leaves the module

- **WHEN** a change removes the code that called a module and the module itself
  compiles on its own
- **THEN** the module is deleted too, because nothing will fail and the next
  reader finds a file that looks like available surface

#### Scenario: A later refactor edits the orphan

- **WHEN** a repository-wide change touches an unreferenced module because it
  matches a pattern
- **THEN** that is not evidence the module is live — sweeping refactors select by
  shape, not by reachability, and an edit date says who ran a codemod

#### Scenario: A module was written but never wired

- **WHEN** a module has never had an importer in its history
- **THEN** it is deleted rather than kept for a plan that has not landed, because
  a file in the tree reads as wired and version control already holds it

### Requirement: Gemini Canvas provider absent from workspace

The workspace SHALL NOT include `packages/media-provider-gemini-canvas` as a
package directory, workspace member, TypeScript project, path alias,
package-manager lock entry, or root run script after pruning, and no provider with
`meta.id` of `gemini-canvas` SHALL remain registered.

#### Scenario: Workspace references removed

- **WHEN** the repo is searched for `@maleo/media-provider-gemini-canvas`,
  `packages/media-provider-gemini-canvas`, and the provider id `gemini-canvas`
- **THEN** no references remain outside historical OpenSpec artifacts, archived
  decisions, and git history

#### Scenario: Root commands omit the retired provider

- **WHEN** root scripts are inspected
- **THEN** `gemini-canvas-chrome` is gone and no command launches a Chrome CDP
  session for media generation

#### Scenario: Provider adapter removed with its package

- **WHEN** the implementation package is deleted
- **THEN** `packages/media/src/providers/gemini-canvas/` is deleted in the same
  pass, and `@maleo/media` no longer depends on the package

### Requirement: Retired provider dependencies leave the workspace

Dependencies that existed only to serve a retired provider SHALL be removed from
the workspace in the same pass as the package.

#### Scenario: Browser automation dependencies dropped

- **WHEN** the Chrome CDP provider is removed
- **THEN** `playwright` and `tsx` are absent from workspace manifests, because no
  remaining package requires a browser runtime

### Requirement: Retired provider configuration keys removed

Environment keys and dashboard configuration that addressed only a retired
provider SHALL be removed, so no surface offers configuration that nothing reads.

#### Scenario: Dashboard env allowlist cleaned

- **WHEN** the dashboard environment allowlist is inspected
- **THEN** `GEMINI_CANVAS_URL` and `GEMINI_CANVAS_URLS` are absent

#### Scenario: Ignored runtime artifacts removed

- **WHEN** the package directory is deleted
- **THEN** its ignored Chrome profile under `data/chrome-profile` is removed with
  it, and the removal is called out because that profile holds a signed-in
  browser session that cannot be recovered

### Requirement: Superseded decisions are corrected, not left standing

When a change retires a component an accepted decision record describes as
current, that record SHALL be updated in the same pass, including any open work
item the change makes moot.

#### Scenario: Decision names a default that no longer exists

- **WHEN** ADR 0002 names a default provider the change removes or replaces
- **THEN** its default-provider section is superseded with the provider that
  actually leads the registry

#### Scenario: Open work item is made moot

- **WHEN** an accepted decision lists open work the change decides not to do
- **THEN** that item is closed with its reason recorded, rather than left as
  pending work nobody will pick up

### Requirement: Private Automation Backup Is Verified Before Removal

Package pruning SHALL verify source parity from `apps/chrome-ext` and
`apps/chrome-ext-pixabay-music-download` to same relative paths under
`~/Documents/projects/maleo-black` immediately before deletion. Dependency
symlinks and generated install artifacts SHALL NOT be required for parity.

#### Scenario: Backup matches source

- **WHEN** removal task compares both source trees with private mirror
- **THEN** source, manifests, documentation, configuration, and assets match
- **AND** proof records successful comparison before either app is deleted

#### Scenario: Backup differs

- **WHEN** any required file is absent or differs
- **THEN** removal stops without deleting either Maleo app

### Requirement: Prohibited Browser Automation Is Absent

Workspace SHALL NOT include Shopee affiliate browser capture or Pixabay music
download browser automation as app directories, workspace members, scripts,
extension manifests, active docs, package-manager entries, or runtime paths.

#### Scenario: Workspace references are scanned

- **WHEN** current tree is searched for retired app paths, package ids, capture
  commands, or extension entrypoints
- **THEN** no active references remain outside historical OpenSpec and changelog
  history

### Requirement: Restricted Supertonic Packaging Is Absent

Workspace SHALL NOT include `apps/supertonic-tts`, Supertonic model download or
image build logic, registered Supertonic provider code, configuration keys, voice
catalogue entries, deployment docs, or default selections.

#### Scenario: TTS workspace is inspected

- **WHEN** current app, provider registry, settings, environment, docs, and
  lockfile are inspected
- **THEN** no active Supertonic service/provider path remains
- **AND** Kokoro is available as supported self-hosted TTS path

### Requirement: Affiliate Catalog Is Private

Workspace SHALL NOT include affiliate catalog service code, API/UI integration,
configuration, ingest tooling, or current documentation after matching source
has been copied to same relative paths under `~/Documents/projects/maleo-black`
and byte parity has passed. Generic product document/types and render support MAY
remain for operator-authored project data, but SHALL NOT fetch affiliate data.

#### Scenario: Affiliate backup matches source

- **WHEN** removal compares each affiliate-related file selected for deletion or
  editing with its same relative path in private mirror
- **THEN** every copied file matches before Maleo source changes

#### Scenario: Publishable workspace is scanned

- **WHEN** current package, API, web, scripts, environment, docs, and lockfile are
  inspected
- **THEN** affiliate service and retrieval integration are absent
- **AND** generic product rendering has no affiliate service dependency
