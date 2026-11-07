# Spec Delta

## MODIFIED Requirements

### Requirement: Pending media is not treated as available media

Production export, browser export, server-side source processing, and agent edits SHALL treat a pending asset as unavailable and SHALL name the pending files. Agent output SHALL NOT create, remove, or re-point references to a pending asset. Browser export SHALL NOT render a pending source from the browser's copy.

#### Scenario: Export while uploading

- **WHEN** an editor starts a production export while a placed asset is pending
- **THEN** export is refused before enqueue, naming the pending file, and the document is unchanged

#### Scenario: Browser export while uploading

- **WHEN** an editor starts a browser export while a placed asset is pending
- **THEN** browser export does not start, the message names the pending file, and the document is unchanged

#### Scenario: Agent edits a project with pending media

- **WHEN** an agent result is merged while an asset is pending
- **THEN** clips that reference the pending asset are preserved unchanged

#### Scenario: Source processing on pending media

- **WHEN** an editor opens reverse, rate, or extract-audio controls on a pending clip
- **THEN** the controls are unavailable with the reason that the upload must finish first
