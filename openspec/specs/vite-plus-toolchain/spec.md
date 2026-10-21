# vite-plus-toolchain Specification

## Purpose

Provide contributors and coding agents with a maintained, consistent quality toolchain that enforces static checks and executes every required test without repository-owned generic tooling.

## Requirements

### Requirement: Reproducible standard quality commands

The repository SHALL pin a stable Vite+ toolchain and supported tooling runtime. A fresh clone SHALL run documented checks through local dependencies without requiring a global CLI. Bun SHALL remain the application runtime and package manager, with frozen CI installs and the existing dependency-resolution cooldown.

#### Scenario: Contributor installs a fresh clone

- **WHEN** a contributor follows documented prerequisites and installation
- **THEN** the pinned local toolchain runs static checks and workspace tasks without an unpinned global installation

#### Scenario: Static analysis fails

- **WHEN** formatting, linting, type checking, or required configuration loading fails
- **THEN** the command exits unsuccessfully and full CI cannot report success

### Requirement: Configured lint policy

The repository SHALL deliver an explicit lint policy for maintained source, including evaluated correctness, TypeScript, promise-safety, React Hooks, and accessibility rules. Selected rules SHALL have recorded dispositions, supported workspace/test overrides, and generated/vendor exclusions. Unsupported candidates SHALL be documented without adding replacement lint machinery. Contributors SHALL have documented non-mutating lint and opt-in fix commands, and staged checks and CI SHALL share the same policy.

#### Scenario: Lint configuration is delivered

- **WHEN** the migration configures lint
- **THEN** each evaluated rule family has an enabled supported rule or a documented exclusion reason, with evidence for its disposition

#### Scenario: Workspace requires different rules

- **WHEN** frontend, backend, or test code needs a different rule scope
- **THEN** root policy declares the override with its cause and CI uses the same policy as staged checks

### Requirement: Standard hooks and independent enforcement

The repository SHALL provide upstream-managed Git hooks and staged lint/format checks, a tracked executable pre-commit hook, and automatic dispatcher installation through the supported project lifecycle. Setup SHALL be idempotent and expose documented status and repair commands. Hooks SHALL preserve unstaged changes, avoid implicit source fixes, and report failures before a commit succeeds. Full-project typecheck and tests SHALL run in the complete gate. Full CI SHALL enforce complete checks independently of local hook installation or bypass.

#### Scenario: Fresh clone installs dependencies

- **WHEN** a contributor follows supported installation with no existing hook owner or explicit disable preference
- **THEN** the project dispatcher is active and pre-commit invokes staged checks using pinned local tooling

#### Scenario: Setup runs repeatedly

- **WHEN** supported hook installation runs again
- **THEN** hook status remains correct without duplicate dispatchers or overwritten project scripts

#### Scenario: Commit contains a lint or format violation

- **WHEN** a contributor attempts a commit containing a staged lint or formatting error
- **THEN** pre-commit fails without silently fixing source or allowing the commit

#### Scenario: Partially staged file is committed

- **WHEN** a contributor commits part of a file
- **THEN** staged checks run under documented policy and unstaged edits remain intact

#### Scenario: Local hooks are disabled

- **WHEN** a change bypasses local hooks
- **THEN** the complete CI gate still rejects formatting, lint, type, or test failures

#### Scenario: Another hook dispatcher owns the clone

- **WHEN** setup encounters an existing hook owner
- **THEN** it preserves that setup and reports how to activate the documented project hooks

### Requirement: Complete standard task orchestration

The repository SHALL use the standard toolchain task runner for all required workspace tasks, preserve dependency order and focused arguments, and propagate failures. Verification tasks SHALL execute without cached success. Superseded orchestration SHALL be removed after coverage parity is proven.

#### Scenario: Focused test receives arguments

- **WHEN** a contributor selects a workspace and test file through a documented command
- **THEN** the intended runner receives that file and executes it without running unrelated suites

#### Scenario: Required workspace task fails

- **WHEN** any required workspace task exits unsuccessfully
- **THEN** the root aggregate gate fails and identifies the task

### Requirement: Test migration preserves suite accountability

Portable unit and frontend tests SHALL use the bundled standard test runner. A suite retained on Bun SHALL have a recorded runtime-dependency reason. Every pre-migration suite SHALL be accounted for as migrated, retained, or explicitly removed with justification. Runner selections SHALL be disjoint and full CI SHALL execute both required groups without added skips or weakened assertions.

#### Scenario: Portable suite migrates

- **WHEN** a suite only uses portable production APIs and test assertions
- **THEN** it runs under the standard runner with its assertions preserved and no duplicate Bun execution

#### Scenario: Integration suite requires Bun

- **WHEN** exercised production code requires a Bun runtime API
- **THEN** the suite remains in an explicit Bun integration group and full CI executes it

#### Scenario: Test discovery changes

- **WHEN** runner configuration or file placement changes
- **THEN** before/after suite accounting identifies any missing, duplicated, skipped, or intentionally removed tests before completion

### Requirement: Coverage is an enforced measured contract

CI SHALL collect coverage for declared migrated source groups, including source files tests never import, and enforce recorded numeric branch thresholds based on a measured baseline. Reports SHALL name their source scope and SHALL NOT imply coverage of excluded Bun or application-browser suites.

#### Scenario: Untested source file exists in covered group

- **WHEN** coverage runs
- **THEN** that file contributes uncovered code rather than disappearing from the report

#### Scenario: Branch coverage regresses below threshold

- **WHEN** a covered source group falls below its recorded threshold
- **THEN** CI fails without silently lowering the threshold
