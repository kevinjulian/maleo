## Context

The private repository contains useful development history and historical Git
objects that must not become public. Current source has already replaced known
live fixtures and baselines with authored synthetic data, but deleting data from
the current tree did not remove it from old commits.

Rewriting the private repository would invalidate clones and branches while
still requiring careful verification. Instead, publication starts a new Git
history in a repository named `maleo`. One pinned private commit supplies the
publication tree; the old repository supplies provenance only and is never added
as a remote or object source in `maleo`.

OpenSpec needs a deliberate boundary. Current main specs are product authority,
and active changes are ongoing public work. The archive is different: 1,348 files at implementation audit of historical discovery and proof, including maintainer-specific
domains, deployment identifiers, runtime observations, and stale implementation
details. Accepted behavior already lives in `openspec/specs/`.

## Goals / Non-Goals

**Goals:**

- Create `maleo` with one new root commit from a verified publication snapshot, followed by a small publication-verification record commit.
- Preserve file contents and executable modes for every included tracked path.
- Include OpenSpec configuration, current main specs, and active changes.
- Exclude Git history, untracked or ignored data, secrets, and archived OpenSpec
  proof.
- Verify the new repository from a fresh clone before public visibility.
- Preserve the existing GitHub repository as the history backup. Adopt fresh history in this local checkout only after independently verifying the new repository.

**Non-Goals:**

- Rewrite, filter, force-push, or publish the private repository.
- Preserve old commit IDs, branches, tags, pull requests, releases, or archived
  OpenSpec changes in `maleo`.
- Rename the Maleo product, packages, workspace names, or runtime identifiers;
  `maleo` is the repository name.
- Build continuous private-to-public mirroring or history replay.
- Decide long-term repository ownership or the exact moment `maleo` becomes
  public.

## Decisions

### Start one new history instead of cleaning the old one

`maleo` starts with one source root commit. After remote-clone verification, a small proof commit records completed publication tasks without rewriting the published root. No private commit, tag, branch, reflog,
bundle, packfile, alternate object directory, or remote is copied. This removes
the risky operation rather than trying to perform it perfectly.

Alternative: rewrite affected paths with `git filter-repo` and force-push.
Rejected because it mutates every historical reference, disrupts every clone,
and can be undone accidentally when an old clone pushes.

### Export one pinned commit, not the working directory

The export reads tracked entries from one commit. Untracked files, ignored
runtime data, local `.env`, and `.git` are absent by construction. Publication
cannot proceed from a dirty tree; changes must be reviewed and committed before
the source commit is pinned.

Alternative: copy the current directory and delete known-private paths.
Rejected because omission-based cleanup can carry ignored data, sockets, caches,
or secrets nobody remembered to name.

### Use one explicit publication exclusion

The publication snapshot first removes confirmed obsolete files and historical archives. All remaining tracked paths from the pinned commit are included. OpenSpec configuration, `openspec/specs/`, and
non-archived `openspec/changes/` remain. Included active changes receive the same
privacy and credential scan as source and configuration.

Alternative: publish every OpenSpec artifact. Rejected because archive proof is
historical context, not current authority, and carries operational details the
fresh-history route exists to leave private.

Alternative: publish only main specs. Rejected because active changes are the
repository's sole task tracker; omitting them would hide ongoing work and break
the documented contributor workflow.

### Compare a manifest, not root tree IDs

Archive exclusion means private and public root tree IDs cannot match. Generate a
sorted manifest of included path, Git mode, object type, and blob ID from the
pinned source commit. Compare it with `maleo` before push and again from a fresh
clone. Any unlisted addition, missing path, content change, or executable-bit
change fails verification.

The manifest records the private source commit for provenance, but it contains no
private remote URL. Historical contaminated object IDs used for negative checks
stay in the private verification record rather than in the public repository.

### Keep the remote private until verification finishes

Create the `maleo` remote as private, push only the new root, then clone it into
an unrelated temporary directory. The verifier must not use alternates, shared
object storage, or a local clone optimization that could borrow objects from the
private repository.

The fresh clone must match the manifest, contain the intended history count, and
fail reachability checks for known private commits and contaminated fixture
blobs. Public visibility is a later explicit user action after this proof.

Alternative: create the repository publicly and verify after push. Rejected
because a failed check would already be a disclosure event.

### Canonical checkout and existing backup

The operator confirmed GitHub already preserves the old committed history and declined another history backup. Verify that remote main matches the original local HEAD before cleanup. Include all reviewed uncommitted Maleo work in the pinned source checkpoint. After fresh-root and independent-clone verification, replace only the current checkout Git metadata with the fresh repository metadata. Preserve ignored local environment, master key, database, dependencies and runtime media. Do not push the checkpoint or old refs to either remote. No extra history backup is created.

### Avoid a synchronization system

This change creates the initial public repository only. After cutover, new public
work can be committed directly in `maleo`; replaying or mirroring private history
is forbidden. If a future private-to-public release stream is needed, it requires
its own threat model and OpenSpec change.

## Risks / Trade-offs

- Active OpenSpec contains private infrastructure detail -> Scan every included
  active artifact; remove or replace findings before pinning the source commit.
- Active documents link into excluded archives -> Run reference checks against
  the exported tree and repair current guidance rather than copying archives
  back.
- Source moves after verification -> Treat the pinned commit as immutable; any
  source change produces a new pin and reruns every release check.
- Export changes file modes or misses paths -> Compare mode, type, blob ID, and
  path manifests before push and from the fresh clone.
- Local clone borrows private objects -> Clone from the remote without local
  object sharing and inspect its own object database.
- Binary personal data escapes text scans -> Inventory binary/rendered artifacts
  directly and prove visual baselines derive from authored synthetic fixtures.
- Repository becomes public too early -> Keep remote private until all gates pass
  and require explicit confirmation for visibility change.
- Sensitive content is discovered after public visibility -> Stop publication,
  assume cloning occurred, rotate exposed credentials, remove public access, and
  create another fresh repository; deleting one public commit is not proof of
  containment.

## Migration Plan

1. Resolve repository owner and reserve private repository name `maleo`.
2. Finish and commit source-tree cleanup, then pin one clean private commit.
3. Build and review publication manifest, including current OpenSpec and excluding
   private historical record.
4. Export included tracked paths into a new temporary directory.
5. Run release hygiene, OpenSpec, reference, CI, visual, credential, and binary
   review gates against that exported tree.
6. Initialize `maleo`, create one root commit, and compare its manifest with the
   pinned source manifest.
7. Push to the private `maleo` remote, clone it independently, and repeat manifest,
   history, and negative object-reachability checks.
8. Record root/source provenance and proof. Change visibility only after separate
   explicit user confirmation.

Before public visibility, rollback deletes or recreates the unpublished `maleo`
remote while the private source remains untouched. After public visibility,
rollback cannot guarantee recall; use the exposure response described above.

## Open Questions

- Resolved: `kevinjulian/maleo`, already created private and empty.
- Resolved: this local `maleo` directory becomes canonical after verification; the prior GitHub repository remains the history backup.
