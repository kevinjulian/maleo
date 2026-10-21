# Fresh repository verification

Verified on 2026-10-21. Repository: `kevinjulian/maleo`. Visibility remains private. The existing GitHub history backup remains unchanged.

## Source and manifest

- Pinned source commit: `0c7f96cbd20a23bdd0b597ad101a9a3ec033ee3d`. Tracked working tree was clean before export.
- Fresh source root: `574da58b430dbe0c1559115afe01fc097f8092bb`. It has no parent.
- Root tree: `7ca605e8c29f143d1596209b16897c2e6a3fbd49`.
- Manifest: 3,354 paths, with Git mode, type, blob ID and path preserved exactly.
- Manifest SHA-256: `6d4d7e6534dadcfc9e37431381a4c00310b7c753af73cfdaeab7263ebde3fedf`.
- Manifest encoding: exact bytes from `git ls-tree -rz <source-commit>`. The same command against the fresh root and independent remote clone matched byte for byte.
- OpenSpec boundary: configuration included, 138 main-spec files and 80 active-change files included, zero historical archive files.

The export used `git archive <source-commit>` into an empty temporary directory. No old `.git`, refs, tags, object directories, alternates, ignored runtime files, environment files or credentials were copied. A new `main` root was created with the source commit in its provenance message. The private source object itself is absent.

## Release checks

`bun install --frozen-lockfile` passed without changing the lockfile. `bun run ci` completed from the fresh source root:

- Version and live-reference checks passed.
- Formatting, lint, type-aware checks and all workspace TypeScript checks passed.
- Rust format, Clippy, tests and WASM build passed.
- Deployment and release-hygiene checks passed.
- Authored HAR fixture reproducibility passed.
- Portable tests: 4,396 passed, one existing skip.
- Bun runtime tests: 2,279 passed, zero failures.
- Layer and component-census checks passed.
- Full visual/mobile suite: 805 passed, zero failures, in 12.5 minutes.

`openspec validate purge-real-data-from-history --strict` passed. The earlier fixture race, deterministic reproduction and concurrent correction proof are recorded in [review.md](./review.md). No diagnostic delay or logging remains in the test.

## Independent GitHub clone

The root was pushed with a normal `git push -u origin main`. A separate `git clone` downloaded the repository from GitHub, without local object sharing.

- Root HEAD matched the published source root.
- All 3,354 manifest entries matched, including executable bits.
- Initial reachable history contained exactly one commit.
- Five negative `git cat-file -e` checks failed as required: original private HEAD, both private cleanup checkpoints, and two excluded historical blobs were absent.
- Object alternates were absent. `git fsck --full --no-reflogs` passed without unreachable-object output.
- The only remote was the Maleo repository.

The existing GitHub backup's 13 refs matched the before-publication snapshot exactly. All 42 old local branch tips were already reachable from that backup's main. One uncommitted old migration diff was retained only as an ignored local patch at `data/recovery/pre-maleo-stashed-migration.patch`.

## Local checkout cutover

After clone verification, only the local Git metadata was replaced with independently verified fresh metadata. No extra Git history backup was created. Existing ignored dependencies, environment, master key, database and media remained in place.

Before and after hashes matched for `.env`, `data/master.key`, `data/postgres/PG_VERSION` and the recovery patch. Their hash values and all historical negative-check object IDs remain outside the repository. Local branch `main` tracks `origin/main`. Hooks use relative `.vite-hooks`, removing the stale pre-rename absolute path. The tracked tree was clean after cutover.

## Verification record commit

This document and the completed task log form the small second commit. They do not change the verified source root. Final verification fetches this record into the independent GitHub clone, confirms exactly two reachable commits, compares its final tree to the local tree, and repeats private-object and old-remote checks. No amend or force-push is used.

Repository visibility remains private. Core Coolify auto-deploy was confirmed paused immediately before publication. No core production cutover or OpenSpec archive is part of this operation.
