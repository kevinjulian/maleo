## Why

`37a1c75b feat!: prepare MIT open-source release` removed known real user data
from the working tree, and `rebuild-the-visual-fixture` replaced current visual
fixtures and baselines with synthetic data. Older commits still contain real
labels, project details, and photographs.

The repository is private, so this is not a public incident. Publishing its
existing Git history would expose those old objects. The chosen route is
therefore a new public repository named `maleo`, created from one verified clean
publication snapshot. The existing GitHub repository retains the private history. After verification, the current local checkout adopts the fresh Maleo history without another history backup.

## What Changes

- Pin and verify one source commit whose tracked tree is safe to publish,
  including rendered and binary artifacts that text search cannot inspect.
- Export the publishable tracked tree without its `.git` directory or historical
  OpenSpec archive, initialize `maleo`, and create one root commit.
- Publish current contracts from `openspec/specs/` and active work from
  `openspec/changes/`; exclude private historical record, whose historical
  proof files include maintainer-specific operational details and are not current
  product authority.
- Publish only the new repository after a fresh clone proves it contains the
  intended snapshot and none of the private repository's old commits or blobs.
- Leave the existing GitHub repository and its branches and tags unchanged. Replace this local checkout's Git metadata only after the new root and a fresh remote clone verify. No force-push occurs.
- Add release guidance and cheap fixture checks so real data cannot quietly
  enter the public repository later.

- Remove confirmed obsolete agent-client scaffolding, conversation dumps, completed native-binding spike files and historical OpenSpec archives. Preserve current contracts, supported Codex skills, required fixtures and assets. Tighten generated-file exclusions and repair references.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `third-party-release-compliance`: public release comes from a verified clean
  snapshot in a new repository, rather than from sanitized legacy history.

## Impact

- New public Git repository `maleo`, with one initial commit from a pinned clean
  source commit.
- Release verification compares the exported tree with the pinned source tree
  and inspects a fresh clone of the new repository.
- `CONTRIBUTING.md` and visual-suite guidance state the publication and fixture
  provenance constraints.
- Existing GitHub history remains untouched; this local checkout becomes the canonical Maleo clone.
- Public OpenSpec contains current contracts and active work, not archived
  implementation history.

## Out Of Scope

- Rewriting, filtering, force-pushing, or publishing the private repository's
  history.
- Preserving old commit IDs, branches, tags, pull requests, or release objects in
  the new public repository.
- Publishing private historical record; accepted behavior already lives in
  `openspec/specs/`, while archive proof belongs to the private repository.
- Auditing private history that will never be published. Credentials found in
  the release snapshot still block publication and require rotation.
- Deciding whether or when to make the new repository public.
