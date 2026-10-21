# open-source-workflow Specification

## Purpose

How this repository is run, contributed to, and released in public: the
onboarding path a new contributor follows, the intake surfaces that make each
documented path real, the OpenSpec-only tracking rule that agents follow, the
bar for an architecture decision record, and the SemVer release workflow.

Written because every rule here was previously prose-only, spread across
overlapping files, and enforced by nothing. The requirements below are paired
with committed checks (`scripts/check-version.ts`, `scripts/check-references.ts`)
that run on every pull request, so a rule cannot silently rot into a claim.

## Requirements

### Requirement: Public Quickstart

The repository SHALL provide a root README that lets a new contributor install,
run, verify, and locate the main workspaces without reading package internals.
The documented setup and development commands SHALL lead to a ready local app or
exit with an actionable error when a required dependency is missing.

#### Scenario: New contributor runs local stack

- **WHEN** a contributor opens the repository README
- **THEN** they see the required install command, setup command, local dev
  command, web URL, and prerequisite requirements

#### Scenario: Contributor locates main packages

- **WHEN** a contributor reads the repository README
- **THEN** they see a current workspace map with `apps/web`, `apps/api`,
  `packages/media`, `apps/media-worker`, `packages/video`, and shared packages

#### Scenario: Required dev service is unavailable

- **WHEN** the contributor runs setup or dev while a service required for the
  documented default app cannot start
- **THEN** the command exits unsuccessfully and names the failed prerequisite
  and supported repair action rather than reporting the app ready

### Requirement: Publishable Repository Baseline

The repository SHALL carry the files required to be published and maintained in
public: an MIT license for Maleo-owned code, third-party notices, a privacy
policy, a security policy, a changelog, and a canonical version. README SHALL
link those files and SHALL NOT claim separately licensed dependencies or assets
are MIT.

#### Scenario: Repository is published

- **WHEN** the repository becomes public
- **THEN** root `LICENSE`, `THIRD_PARTY_NOTICES.md`, `PRIVACY.md`, `SECURITY.md`,
  and `CHANGELOG.md` exist and root `package.json` declares canonical `version`
  and `license`

#### Scenario: Someone finds a vulnerability

- **WHEN** a person discovers a security issue
- **THEN** `SECURITY.md` gives them a private reporting channel instead of a
  public issue

#### Scenario: Reader checks third-party terms

- **WHEN** a reader evaluates runtime dependency or bundled asset
- **THEN** README directs them to notice identifying separate license or terms

### Requirement: Public Contribution Guide

The repository SHALL provide root contribution guidance that explains how humans
report bugs, propose changes, open focused pull requests, and verify work.

#### Scenario: Contributor proposes broad change

- **WHEN** a contributor wants to change product direction, workflow, UI, API,
  schema, persistence, or architecture
- **THEN** the contribution guide directs them to discuss or create an OpenSpec
  proposal before implementation

#### Scenario: Contributor opens pull request

- **WHEN** a contributor opens a pull request
- **THEN** the contribution guide requires one focused problem, explanation of
  why, verification evidence, and docs updates when contracts or user-facing
  behavior change

### Requirement: Contribution Intake Policy

The repository SHALL state who may open implementation pull requests, how
agent-assisted work is treated, how forks interact with versioning, and that
submitted contributions are licensed under project MIT license unless another
file explicitly carries compatible separate terms.

#### Scenario: Agent-assisted pull request arrives

- **WHEN** a contributor opens a pull request written wholly or partly by an
  agent
- **THEN** the contribution guide requires the author to be able to explain what
  every change does, how it behaves at the edges, and what the tests prove

#### Scenario: Fork opens a pull request

- **WHEN** a pull request comes from a fork
- **THEN** the contribution guide requires it to leave the root version and the
  released `CHANGELOG.md` headings untouched, adding at most an `Unreleased`
  entry

#### Scenario: Contribution is submitted

- **WHEN** contributor opens a pull request
- **THEN** contribution guide states contribution is submitted under project MIT
  license and contributor has right to submit included code and assets

### Requirement: Contribution Intake Surfaces

The repository SHALL provide GitHub templates that make each documented
contribution path usable.

#### Scenario: Reporter opens an issue

- **WHEN** a person opens a new issue
- **THEN** a bug form requests current behavior, expected behavior, the shortest
  reproduction, impact, environment, and the smallest useful log excerpt

#### Scenario: Person has a feature idea or question

- **WHEN** a person tries to open an issue for a feature request, idea, or
  question
- **THEN** the issue chooser routes them to Discussions instead

### Requirement: OpenSpec-Only Internal Tracking

The repository SHALL use OpenSpec as the only internal planning, task tracking,
acceptance, and closeout workflow, in documentation and in automation.

#### Scenario: Agent plans implementation work

- **WHEN** an agent receives a broad product, API, schema, workflow, UI, or
  architecture request
- **THEN** the agent uses an OpenSpec change with proposal, specs, design when
  needed, and tasks instead of beads or markdown TODO systems

#### Scenario: Agent records follow-up work

- **WHEN** an implementation discovers follow-up work outside current scope
- **THEN** the agent records it as an OpenSpec task or separate OpenSpec change,
  not a bead issue

#### Scenario: Agent session starts

- **WHEN** an agent session starts in this repository
- **THEN** no hook, skill, or script injects instructions to use beads or to
  maintain a DOX index

### Requirement: Simple Agent Rule Chain

The repository SHALL replace DOX hierarchy maintenance with a simple agent rule
chain, with one owning file per guidance type.

#### Scenario: Agent edits package code

- **WHEN** an agent edits a package or app
- **THEN** the agent reads root `AGENTS.md`, reads the nearest package/app
  `AGENTS.md` when one exists, and follows the closest specific rule where rules
  overlap

#### Scenario: Agent updates guidance docs

- **WHEN** an agent updates guidance docs
- **THEN** the agent keeps root rules in root docs and package-local details in
  package docs without maintaining a child DOX index

#### Scenario: Guidance type has two copies

- **WHEN** a guidance type is documented in more than one file
- **THEN** exactly one file is normative and the other is removed or reduced to a
  pointer

### Requirement: Decision Records

The repository SHALL document accepted architecture decisions in
`docs/decisions/` only when the decision closes off an option contributors or
agents are likely to propose again.

#### Scenario: Durable architecture choice is accepted

- **WHEN** a change accepts a cross-cutting architecture decision
- **THEN** the repository records context, decision, and consequences in
  `docs/decisions/`

#### Scenario: Narrow implementation note exists

- **WHEN** reasoning applies only to a narrow line or module
- **THEN** the repository keeps that note near the code instead of adding an ADR

#### Scenario: Decision is reversed

- **WHEN** a later decision replaces an accepted one
- **THEN** the superseded record is marked `Superseded by NNNN` and is neither
  deleted nor edited into agreement with the present

### Requirement: Enforced Repository Gates

The repository SHALL enforce its version and reference rules with committed,
tested checks that run on every pull request. The reference check SHALL cover
removed product concepts as well as removed paths, because a document can name a
product that no longer exists while every path in it still resolves. Its scope
SHALL include package and app documentation trees, so drift cannot accumulate in
an ungated tree beside a gated one.

#### Scenario: Version values disagree

- **WHEN** root `package.json` version, the newest released `CHANGELOG.md`
  heading, and the release tag do not agree
- **THEN** the version check fails and names the disagreeing values

#### Scenario: Guidance doc references a removed path

- **WHEN** a live guidance doc links to a file or workspace path that does not
  exist
- **THEN** the reference check fails, while archived OpenSpec changes and
  planning history are skipped

#### Scenario: Package doc references a removed path

- **WHEN** a file under `packages/*/docs/` or `apps/*/docs/` names a path or
  package that no longer exists
- **THEN** the reference check fails, the same as for root guidance

#### Scenario: README describes a removed product concept

- **WHEN** a README or `AGENTS.md` presents a concept removed in the
  persona-to-workspace pivot as current
- **THEN** the reference check fails and names the replacement concept

#### Scenario: Codemap or decision record uses a concept word

- **WHEN** a file under `docs/CODEMAPS/` or `docs/decisions/` contains a removed
  concept word
- **THEN** the concept check does not fail it, because those files describe
  mechanism and history where the word is often correct

#### Scenario: Pull request is opened

- **WHEN** a pull request is opened or updated
- **THEN** continuous integration runs the version check and the reference check
  before typecheck and test

### Requirement: Simple Release Workflow

The repository SHALL provide a simple SemVer release workflow based on one root
version, one changelog, one annotated tag, and one GitHub Release.

#### Scenario: User-facing change lands

- **WHEN** a pull request changes user-facing or contributor-facing behavior
- **THEN** it updates `CHANGELOG.md` under `Unreleased` unless it falls in a
  documented release-note-exempt category

#### Scenario: Reviewer judges exemption

- **WHEN** a reviewer decides whether a change needs a changelog entry
- **THEN** the contribution guide lists the exempt categories: docs-only,
  CI-only, test-only, and internal refactors with no user-facing or
  contributor-facing effect

#### Scenario: Maintainer prepares release

- **WHEN** a maintainer prepares version `X.Y.Z`
- **THEN** root `package.json`, the newest released `CHANGELOG.md` section, and
  tag `vX.Y.Z` agree

#### Scenario: Release tag is pushed

- **WHEN** annotated tag `vX.Y.Z` is pushed
- **THEN** GitHub Actions validates version/changelog consistency, runs the
  defined release checks, extracts the matching changelog section, and creates a
  GitHub Release

### Requirement: Single Root Env Template

The repository SHALL provide exactly one environment template, at the root, and
SHALL NOT carry package-local env templates that contradict the single-root-`.env`
rule.

#### Scenario: Contributor looks for the variables to set

- **WHEN** a contributor wants to know which environment variables the
  repository reads
- **THEN** a root `.env.example` documents them, grouped by the service that
  reads each one

#### Scenario: Package carries its own env template

- **WHEN** a package or app under `packages/*` or `apps/*` contains a
  `.env.example`
- **THEN** that file is removed and its variables are folded into the root
  template, because its presence instructs a contributor to create the
  package-local `.env` that `AGENTS.md` forbids

#### Scenario: Template is copied wholesale

- **WHEN** a contributor copies the root template to `.env`
- **THEN** every line is commented out, so copying it cannot override the
  defaults `bun run setup` relies on

### Requirement: Full Local CI Command

The repository SHALL provide one root `ci` command that runs the same required
checks continuous integration runs, including lint and browser visual
regression. CI SHALL invoke that command instead of restating checks. A separate
faster local `check` command MAY omit expensive checks but SHALL identify itself
as partial verification.

#### Scenario: Contributor wants to know if CI will pass

- **WHEN** a contributor runs the root `ci` command before opening a pull request
- **THEN** it runs the same required checks as CI, including lint and visual
  regression, with a documented browser prerequisite or automatic preflight

#### Scenario: A check is added to CI

- **WHEN** a new required check is added
- **THEN** it is added to the root `ci` command, and the workflow picks it up by
  invoking that command, so local and CI gates cannot drift

#### Scenario: Contributor runs the fast check

- **WHEN** a contributor runs the root `check` command while iterating
- **THEN** it runs the documented fast gates and does not claim to reproduce full CI

### Requirement: Idempotent and complete local setup

Root setup SHALL prepare or verify required local prerequisites, preserve
existing credentials and data on repeat runs, and declare success only after
required migrations and readiness checks pass. Optional provider credentials
SHALL be reported separately from required local services.

#### Scenario: Setup runs again over existing data

- **WHEN** a contributor reruns setup in an initialized workspace
- **THEN** stored secrets and project data are preserved, required services are
  checked, and pending safe migrations are applied or an actionable error is shown

#### Scenario: Optional provider credential is absent

- **WHEN** setup finds no credential for an optional generation provider
- **THEN** setup identifies that feature as unavailable without treating the
  default local app as unready

### Requirement: Workspace task manifests have clear ownership

Root `package.json` SHALL expose stable contributor commands; each app/package
`package.json` SHALL define only executable tasks it owns and declare real
workspace dependencies. Build tasks SHALL name real artifacts and their outputs
before being cached. A focused command SHALL remain available for each package
with a task, including tests with positional arguments.

#### Scenario: Contributor checks one package

- **WHEN** a contributor runs a package's typecheck or focused test from root
- **THEN** only the selected package task and required task dependencies run,
  and positional test arguments reach that package's test runner

#### Scenario: Package has no build artifact

- **WHEN** an app or package has no production artifact to emit
- **THEN** its manifest does not add a placeholder `build` script for the task runner

### Requirement: Safe workspace task acceleration

The monorepo SHALL use a declared task graph for repeatable workspace checks
and builds. A task MAY use local or remote cache only when its outputs and all
behavior-affecting file and environment inputs are known; stateful tests,
migrations, dev services, and visual checks SHALL execute without cached results.
Full CI SHALL continue to cover all required workspaces and repository gates.

#### Scenario: Unchanged deterministic build runs again

- **WHEN** a declared artifact build runs with the same complete inputs
- **THEN** its cached artifact and result may be reused and match a clean build

#### Scenario: Input changes or task depends on runtime state

- **WHEN** an input changes or a task reads live database, network, browser,
  secret, or runtime state not represented in its cache key
- **THEN** stale cached success is not accepted as verification

#### Scenario: Affected-only check is requested

- **WHEN** a contributor runs an affected-package check for fast feedback
- **THEN** it is presented as partial feedback and the required full CI gate
  still runs before merge

### Requirement: Package tests cannot read durable local runtime data

Root and package-focused test commands SHALL use temporary databases and media state. They SHALL NOT inherit a contributor's root `.env` values that point at durable local data or change test assertions. A test needing a specific path SHALL use an explicitly created temporary path. These guarantees SHALL apply to both standard portable tests and retained Bun integration tests before runtime modules initialize, including parallel test workers. Editor tests SHALL use the real shared WASM engine where their existing behavior requires it.

#### Scenario: Contributor runs tests with a configured local instance

- **WHEN** root `.env` names the developer's API and worker database
- **THEN** package tests run against isolated test configuration and cannot read or mutate those durable resources

#### Scenario: Contributor runs one package test

- **WHEN** a focused test is launched through its package script
- **THEN** the same database and media isolation applies as in the root suite

#### Scenario: Test runners execute in parallel

- **WHEN** standard or Bun integration test workers initialize
- **THEN** temporary resources are isolated, provider credentials and live endpoints are unavailable, and owned resources are cleaned up after execution

#### Scenario: Editor unit suite initializes

- **WHEN** a migrated suite exercises shared editor commands
- **THEN** the real WASM engine is registered before those commands execute

### Requirement: Dependency Resolution Cooldown

Fresh dependency resolution SHALL require that a version has been published for
a minimum period, so a compromised release is not installed inside the window in
which it is typically caught and unpublished.

#### Scenario: A brand-new version is requested

- **WHEN** a fresh resolution would pick a version published within the cooldown
- **THEN** it resolves to an older version instead, which is the rule working
  rather than a failure

#### Scenario: Locked install runs in CI

- **WHEN** an install runs with `--frozen-lockfile`
- **THEN** the cooldown does not apply, because the lockfile already pins exactly
  what is installed

### Requirement: Package Docs Hold Operational Reference Only

A package or app documentation tree SHALL hold operational reference for that
package, and SHALL NOT hold a second copy of a guidance type the repository root
owns.

#### Scenario: Package documents its own environment or endpoints

- **WHEN** a package needs to document the variables it reads, its endpoints,
  its runbook, or its architecture
- **THEN** that reference belongs in the package's own `docs/`

#### Scenario: Package repeats a root-owned guidance type

- **WHEN** a package doc tree contains contribution rules, release process, or
  agent workflow
- **THEN** it is removed or reduced to a pointer, because the root
  `CONTRIBUTING.md` and `AGENTS.md` own those

#### Scenario: Documented subject no longer exists

- **WHEN** a package doc describes a surface removed from the codebase
- **THEN** the file is deleted rather than rewritten, because a document whose
  subject is gone cannot be repaired into a true one, and git history preserves
  it

### Requirement: Open-Source Release Gate

Repository SHALL run deterministic public-release hygiene checks in CI and
release verification. Checks MUST cover required policy files, workspace license
metadata, banned active paths/identifiers, known private-data patterns, and
third-party notice coverage without scanning historical OpenSpec as current
product behavior.

#### Scenario: Pull request reintroduces banned surface

- **WHEN** active source or config reintroduces removed automation path, branded
  product identity, private fixture, or undisclosed exceptional dependency
- **THEN** CI fails and names offending file and rule

#### Scenario: Release candidate passes

- **WHEN** maintainer runs documented release verification
- **THEN** open-source hygiene gate runs with version, reference, typecheck, test,
  and lint gates

### Requirement: Task-Oriented Guides Under Root Docs

The repository SHALL keep operator and contributor guides as task-oriented
documents under root `docs/`, one document per reader task, each listed in the
`AGENTS.md` authority chain as the owner of that task. A deployment guide for
the whole stack SHALL be repository-level guidance, not the operational
reference of the infra directory that holds the compose file.

#### Scenario: Operator deploys or maintains the stack

- **WHEN** an operator needs to deploy, configure, back up, restore or recover
  access to a deployment
- **THEN** they find it in `docs/self-hosting.md`, and platform-specific steps
  in a guide named for the platform, such as `docs/coolify.md`

#### Scenario: Infra directory documents its compose files

- **WHEN** an infra directory needs to document something that is true only of
  its own files, such as a local override or an opt-in test suite
- **THEN** that stays in the directory's README, which links to the operator
  guide for everything else rather than repeating it

#### Scenario: Contributor runs and verifies the project

- **WHEN** a contributor needs more than the quickstart to run individual
  services, restart the stack or verify a change
- **THEN** they find it in `docs/development.md`, and the root README keeps the
  quickstart and links there

#### Scenario: A moved guide leaves a stale path behind

- **WHEN** live guidance, `.env.example` or a compose comment names a document
  path whose content has moved
- **THEN** it is repointed to the owning guide in the same change, and
  `bun run check:references` passes

### Requirement: Standard quality workflow ownership

Contributor and agent guidance SHALL distinguish static checks, portable tests, Bun runtime integration tests, and the complete repository gate. The complete gate SHALL use standard tooling for generic quality orchestration and retain required domain checks. Superseded generic tooling SHALL be removed once replacement proof passes.

#### Scenario: Contributor chooses a command

- **WHEN** a contributor reads the verification guide
- **THEN** it identifies `vp check` as static checks, `vp test` as portable tests, and `vp run ci` or its root alias as the complete gate

#### Scenario: Full gate executes

- **WHEN** the complete repository gate runs locally or in CI
- **THEN** it includes all required workspace checks, portable and Bun integration tests, Rust/WASM, Playwright, and repository architecture/release/deployment checks
