# Contributing to maleo

Thanks for looking. This file covers how to participate, what a good pull
request looks like, and how releases are cut. `README.md` gets the project
running and `docs/development.md` covers day-to-day local work; `AGENTS.md`
covers the rules for coding agents.

## How to help

### Report a bug you reproduced

Use the bug issue template. Search open and closed issues first.

Keep it factual and roughly one screen. Include the current behavior, the
expected behavior, the shortest exact reproduction, the impact on your work,
your environment, and the smallest useful log excerpt. Skip root-cause analysis,
implementation plans, and generated investigation dumps — they cost a maintainer
more to verify than to redo.

If you cannot reproduce it, open a Discussion instead of an issue.

### Propose a change

Feature requests, ideas, questions, and design proposals go to GitHub
Discussions, not issues.

If the change touches product direction, workflow, the HTTP API, the database
schema, persistence, the timeline or editor UI, or architecture, it starts as an
OpenSpec change rather than as code. See `openspec/` and `AGENTS.md`. A proposal
that is agreed before implementation is far cheaper than a pull request that has
to be argued backwards from a diff.

## Pull requests

### Who can open one

Anyone can open a pull request for a bug fix that preserves the existing design.

Features and larger behavioral changes need agreement first, through a
Discussion or an OpenSpec proposal. A working implementation is not enough on
its own when it moves the product somewhere the maintainers did not choose.

### Understand your own change

Using an agent to write code is fine — much of this repository was written that
way. Submitting code you cannot explain is not.

You must be able to say what every change does, how it behaves at the edges,
what the tests prove, and how it fits the existing design. If a reviewer asks
about a line and the answer is "the agent wrote it", the pull request is not
ready.

### Rights and license

By submitting a contribution, you agree that your contribution may be licensed
under the repository's MIT License. Submit only code, text, fixtures, and assets
you created or have the right to contribute under compatible terms.

Name third-party sources and licenses in the pull request and update
`THIRD_PARTY_NOTICES.md` when retained material needs notice. Do not submit live
customer data, captured authenticated traffic, secrets, or media with unknown
provenance. For agent-assisted work, you remain responsible for reviewing output,
confirming provenance, and ensuring it does not reproduce restricted source or
brand identity.

### Keep it focused

One pull request solves one problem. Do not bundle opportunistic cleanup,
unrelated refactors, or speculative fixes. Do not bypass a failing check.

Use a lowercase conventional title: `fix: handle empty storyboard clip list`.
Types are `feat`, `fix`, `refactor`, `chore`, `docs`, `perf`, `test`, `ci`.

For a change that spans several workspaces, prefer one atomic commit. That is
the reason this is a monorepo.

### Verify it

```bash
bun run check  # fast feedback; partial
bun run ci     # complete local CI gate
```

`ci` runs the same gates as the workflow, including the Rust engine and
Playwright visual regression. It installs Chromium if needed; on Linux, install
browser system dependencies first with
`bun run --cwd apps/web playwright install --with-deps chromium`.
Run focused tasks while iterating:

```bash
bun run typecheck
bun run test
bunx vp run --filter @maleo/api typecheck
bun run --cwd apps/api test src/lib/global-secrets.test.ts
bun run --cwd apps/web test src/api/client.test.ts
```

Workspace manifests own actual tasks. Add `build` only for a real emitted
artifact. `vp run` caches nothing (`run.cache: false`); tests, video bundle,
and runtime services always run. Root `.env` remains the only local env file; test scripts
redirect database, worker, cache, and media paths to temporary storage.

For behavior changes, actually exercise the surface — start the API and hit the
route, or start the web client and click the thing. New behavior needs a test;
fix the implementation, not the test.

### When a lint rule fires

`bunx vp check` (and `bun run check`, which runs it) lints the whole repository
with the upstream correctness, TypeScript, promise, React Hooks and
accessibility rules plus the anti-slop rules, which reject TypeScript that
type-checks but carries no evidence — an assertion with no stated invariant, a
dictionary typed `Record<string, unknown>`, a double `as unknown as` cast.

**Every enabled rule is at zero across the repository**, so a finding anywhere
fails the gate, whether or not your branch touched that file.

An **error** fails the build. Change the code, or write the `SAFETY:` comment
that states the invariant making the assertion sound — a real sentence about why
it holds, not a line added to silence the linter. If a rule is genuinely wrong
for this codebase, turn it off in `oxlint.config.ts` with the reason written
there, so the decision is visible rather than scattered across call sites.

Report failures with the actual output. Never claim green without running the
check.

### Runtime data safety

Never commit secrets, local database snapshots, generated media, or anything
else under `data/`. Provider credentials belong in the root `.env`, which is not
tracked. If you think a credential reached the repository, read `SECURITY.md`
before opening a pull request that removes it.

### If you are working from a fork

**Leave the version and the released changelog headings alone.** Do not bump the
root `package.json` version and do not add a `## [x.y.z]` heading to
`CHANGELOG.md`. You may add an entry under `Unreleased`.

The version is the maintainer's to pick at release time, because it depends on
what else lands in the same release and on which axis the sum of those changes
sits. Two pull requests both guessing `0.2.1` conflict with each other and with
the release commit. `scripts/check-version.ts` stays green either way — it
asserts that the existing values agree, not that a bump happened.

If you want a changelog line in your own words, put it in the pull request
description and it will be used.

## Working in the repository

### Adding a package

1. Create `packages/<name>/src` and a `package.json`:

```json
{
	"name": "@maleo/<name>",
	"version": "0.1.0",
	"private": true,
	"license": "MIT",
	"type": "module",
	"scripts": {
		"typecheck": "tsc --noEmit",
		"dev": "bun run src/index.ts"
	}
}
```

2. If the package starts a contributor-facing service, add a root convenience
   script that enters the workspace and forwards arguments. Do not add a build
   placeholder or root alias for a library without that task.
3. Run `bun install` from the root. The workspace symlink is wired
   automatically, so `import ... from "@maleo/<name>"` resolves with no path
   alias.
4. Add `packages/<name>/tsconfig.json`, copied from a similar package.
5. Add the row to the `README.md` workspace table and the `AGENTS.md` workspace
   map.

Every package stays `private` and carries the same version as the root. Nothing
is published independently.

### What belongs in `@maleo/shared`

Pure types and logic that more than one package needs: schemas, parse and merge
helpers, decision functions, type definitions. No IO.

Keep file reads, database writes, fetch calls, HTTP routes, UI components, and
CLI wiring in the consuming package. The pattern is that `shared` exposes
`parseFoo(raw: unknown)` and each consumer wraps it with the loader that knows
where the data lives.

### Gotchas

- `bun run --filter <pkg> <script> <args>` drops positional arguments after the
  script name. Use `bun run --cwd <workspace> <script> <args>` for focused tests,
  or the root service shortcuts for runtime commands.
- Each package has its own `tsconfig.json` with its own opinions
  (`verbatimModuleSyntax`, `jsx`). Keep each side consistent with itself.

## Fresh repository publication

Maleo starts from a reviewed source snapshot with fresh Git history. The prior
private GitHub repository retains historical commits. Never mirror it, push its
branches or tags here, or add its object database as an alternate.

Before publishing a new snapshot:

1. Review every included source, document, fixture and binary asset. Remove
   credentials, user content, machine paths and private deployment identifiers.
2. Commit the reviewed tree and pin its source commit. Export its tracked files
   into an empty directory without Git metadata or ignored runtime files.
3. Initialize fresh history. Compare the exported paths, contents and executable
   modes with the pinned snapshot. Keep current OpenSpec contracts and active
   changes; historical archives and retired scaffolding stay excluded.
4. Run `bun run ci`, including `bun run check:fixtures`. Inspect authored fixture
   images and visual baselines. Never record live accounts or workspace data.
5. Push only fresh history to the private Maleo repository. Verify an independent
   clone has the intended tree and no excluded historical commits or blobs.
6. Record publication verification in a small follow-up commit. Change repository
   visibility only after separate explicit maintainer approval.

The initial source commit and its verification record are new Maleo history.
Neither carries the prior repository's commits, tags or Git object store.

## Releases

One canonical version lives in the root `package.json`. One `CHANGELOG.md`. One
annotated `vX.Y.Z` tag per release.

### Changelog entries

A pull request that changes user-facing or contributor-facing behavior adds an
entry under `## [Unreleased]` in `CHANGELOG.md`.

These categories are release-note-exempt and need no entry:

- documentation-only changes
- CI-only and build-pipeline changes
- test-only changes
- internal refactors with no user-facing or contributor-facing effect

When in doubt, add the entry. A line that turns out to be unnecessary is deleted
during release review; a missing line is discovered by a user.

### Cutting a release

1. Decide `X.Y.Z` by SemVer. The axis is what the operator has to do: a **patch**
   makes the code do what it was always meant to, a **minor** adds something that
   was not there, and a **major** requires the operator to change something.
2. Set the root `package.json` version and rename `## [Unreleased]` to
   `## [X.Y.Z] - YYYY-MM-DD` with the real date, leaving a fresh `Unreleased`
   above it.
3. Run `bun scripts/check-version.ts`. It must pass.
4. Commit as `chore(release): vX.Y.Z`, then tag and push:

   ```bash
   git tag -a vX.Y.Z -m "maleo X.Y.Z"
   git push --follow-tags
   ```

The pushed tag triggers `.github/workflows/release.yml`, which re-validates
consistency, runs the release checks, extracts the matching changelog section,
and creates the GitHub Release.

### Release checks

The release workflow runs `bun run ci` — the same script you run locally, so a
release cannot pass checks a pull request would have failed. On a tag run the
version check additionally proves the tag matches the canonical version.

It does not run the Playwright visual-regression job. That stays a pull-request
gate because it is slow and environment-sensitive, and a release should not be
blocked by a rendering difference on a runner.

## Questions

Open a GitHub Discussion.
