# asset-manifest Specification

## Purpose

List every media item a project references, with a stable identity, origin, kind, size, content hash and availability state, so export preflight and later sync read one answer instead of scanning documents separately.

## Requirements

### Requirement: A project has one asset manifest

The system SHALL derive an asset manifest for a project from its current
storyboard document and its project media library. The manifest SHALL list
each referenced media item once, keyed by its media identity, with its origin,
kind, content type, size, SHA-256 and state. The manifest SHALL be derived on
request and SHALL NOT be stored as a second copy of the document.

#### Scenario: A clip and the media library name the same file

- **WHEN** a clip and a project media library entry both reference `/api/media/<id>`
- **THEN** the manifest lists that identity once

#### Scenario: The document changes

- **WHEN** a clip referencing a new media identity is saved
- **THEN** the next manifest request lists that identity without any separate write

### Requirement: Each manifest entry reports one state

Each entry SHALL carry exactly one state:

- `ready`: the registry holds the bytes and the caller can read them.
- `pending`: an import with this identity has not finished.
- `failed`: the import with this identity failed or was cancelled, or no
  registry record exists for a managed identity.
- `external`: the reference is a URL outside managed media. Size and hash
  SHALL be absent.

#### Scenario: An import is still processing

- **WHEN** a clip references a minted identity whose import is processing
- **THEN** its entry has state `pending` and no size or hash

#### Scenario: A stock clip uses a provider URL

- **WHEN** a clip references a URL that is not a managed media URL
- **THEN** its entry has state `external`

### Requirement: The manifest is served only to project members

`GET /projects/:id/asset-manifest` SHALL return the manifest to an
authenticated member of the project's workspace. Any other caller SHALL
receive the same refusal the project routes give, and SHALL learn nothing
about the project's media.

#### Scenario: A member requests the manifest

- **WHEN** a workspace member requests the manifest of a project in that workspace
- **THEN** the response lists the project's entries

#### Scenario: A non-member requests the manifest

- **WHEN** an account outside the workspace requests the manifest
- **THEN** the request is refused exactly as other project routes refuse it

### Requirement: Export preflight reads the manifest

Export preflight and the pending-media blocker SHALL decide availability from
the manifest. An export SHALL be blocked while any entry it uses is `pending`
or `failed`, and the blocker message SHALL name the file by its label or
original filename.

#### Scenario: Export while a file uploads

- **WHEN** an export is requested and a used entry is `pending`
- **THEN** the export is refused and the message names the uploading file

#### Scenario: Export after every import finished

- **WHEN** every used entry is `ready` or `external`
- **THEN** the manifest adds no export blocker
