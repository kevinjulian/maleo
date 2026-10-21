# docs/ — agent instructions

Local rules for `docs/`. Repo-wide workflow lives in the root `AGENTS.md`.

## Purpose

`docs/` holds durable reference material: architecture maps, accepted
architecture decisions, and verification records.

It does not own contribution rules or the release process. Those live in the
root `CONTRIBUTING.md`.

## Ownership

- `CODEMAPS/` — high-level architecture maps for backend, frontend, core, and
  services.
- `decisions/` — accepted architecture decision records. Read
  `decisions/README.md` before adding one; the bar is high.
- `verification/` — dated records of manual verification runs.

## Local contracts

- Codemaps describe the current shape, not aspirational architecture.
- When durable package boundaries, workflows, or contracts change, update the
  affected map in the same pass or record why not.
- Remove stale instructions instead of layering caveats on them.
- Prefer stable maps over temporary migration notes. A migration note belongs in
  the OpenSpec change that performs the migration.

## Verification

- Run `bun scripts/check-references.ts` after editing anything here; it fails on
  links and workspace paths that no longer exist.
- When a doc describes runtime behavior, check it against the owning package's
  code in the same session.
