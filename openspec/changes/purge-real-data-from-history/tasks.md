## 1. Pin And Verify Release Snapshot

- [x] 1.1 Pin the exact private source commit to export and require a clean tracked tree. Proof: commit ID and `git status` output.
- [x] 1.2 Scan every tracked text and structured file in that commit for real user data and credentials. Proof: commands, classifications, and clean result or remediation list.
- [x] 1.3 Inspect tracked images, recordings, snapshots, databases, and other rendered or binary artifacts directly. Proof: artifact inventory and review result.
- [x] 1.4 Confirm visual fixtures and baselines come from the authored synthetic fixture. Proof: fixture reproducibility check and inspected representative baselines.
- [x] 1.5 Scan included OpenSpec configuration, main specs, and active changes for personal data, credentials, and maintainer-specific infrastructure. Proof: scoped scan and reviewed findings.

## 2. Define Fresh Repository Publication

- [x] 2.1 Record the `maleo` repository owner, visibility during verification, and intended public URL. Proof: publication record.
- [x] 2.2 Record that old commits, branches, tags, pull requests, releases, Git objects, and private historical record will not migrate. Proof: release guidance diff.
- [x] 2.3 Record the private source commit beside the new root commit without making the private remote or object database part of the public repository. Proof: provenance note.
- [x] 2.4 Record the publication manifest: include OpenSpec configuration, `openspec/specs/`, and active `openspec/changes/`; exclude private historical record. Proof: checked manifest.

## 3. Create And Verify Fresh History

- [x] 3.1 Export the publication manifest from the pinned source commit into a new temporary directory; do not copy `.git`, private historical record, untracked files, ignored runtime data, or local secrets. Proof: export command and manifest.
- [x] 3.2 Initialize `maleo` and create one root commit from the export. Proof: root commit ID, one-commit log, and manifest-aware tree comparison with the pinned source commit.
- [x] 3.3 Run release checks against the fresh repository before any public push. Proof: command output.
- [x] 3.4 Verify the existing private empty Maleo remote and push only the fresh repository. Proof: remote URL and push output.
- [x] 3.5 Clone the new remote into another temporary directory and verify its tree against the export manifest. Confirm known private commit IDs and historical fixture blobs are unreachable. Proof: fresh-clone commands and output.
- [x] 3.6 Verify old GitHub refs stayed unchanged, then adopt verified fresh Git metadata in this local checkout without copying old objects or creating another history backup. Preserve ignored local runtime files and verify their hashes. Proof: before/after comparison.

## 4. Keep Real Data Out

- [x] 4.1 Wire `bun visual/fixtures/build.ts --check` into `bun run ci` so a hand-edited or recorded fixture cannot land quietly. Proof: deliberate fixture edit fails CI and names the file.
- [x] 4.2 Scope the cheapest reliable baseline-provenance check. Build it only if it provides more confidence than authored-fixture verification plus review. Proof: implemented check or recorded rejection with reason.
- [x] 4.3 State the synthetic-data constraint in visual-suite guidance where fixture and baseline authors encounter it. Proof: guidance diff.
- [x] 4.4 Document the fresh-repository release route in `CONTRIBUTING.md`; explicitly forbid publishing or adding the private repository as a public remote. Proof: documentation diff.

## 5. Prove It

- [x] 5.1 Run `bun run check:release-hygiene`. Proof: command output.
- [x] 5.2 Run `bun run ci`. Proof: command output.
- [x] 5.3 Run `bun run visual` against the authored fixture. Proof: command output.
- [x] 5.4 Run `openspec validate "purge-real-data-from-history" --strict`. Proof: command output.
- [x] 5.5 Verify `maleo` from a fresh clone and record its root commit, source commit, manifest-aware tree match, OpenSpec boundary, history count, and unreachable-private-object checks in a small follow-up proof commit. Verify the final two-commit remote again. Proof: release verification record.

## 6. Repository cleanup authorized during implementation

- [x] 6.1 Review obsolete client scaffolding, conversation dumps and completed spike references; remove confirmed obsolete tracked files and historical archives while retaining current contracts and useful domain guidance. Record exact exclusions.
- [x] 6.2 Tighten generated/local-file ignore rules without suppressing required images, fixtures or source. Repair live references into excluded archives and removed files.
- [x] 6.3 Remove private hostnames, local machine paths and deployment identifiers from included operational evidence and examples, preserving current requirements and test intent.

- [x] 6.4 Fix the generated-video fixture race exposed by fresh-tree CI. Stop the prior page before injecting legacy records. Preserve every behavior assertion and record deterministic failure plus concurrent verification.

## Proof records

- [Publication and clone verification](./evidence/publication.md) records the pinned source, manifest, checks, history boundary and local cutover.
- [Cleanup and artifact review](./evidence/review.md) records exclusions, privacy review, fixture provenance and race correction.
