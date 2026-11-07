# Spec Delta

## MODIFIED Requirements

### Requirement: Export preflight reads the manifest

Export preflight and the pending-media blocker SHALL decide availability from
the manifest. This rule SHALL apply to browser export and to server export. An
export SHALL be blocked while any entry it uses is `pending` or `failed`, and
the blocker message SHALL name the file by its label or original filename.

Before browser export encodes a frame, the browser SHALL fetch every used
`ready` and `external` entry. The browser SHALL check each fetched `ready` entry
against its manifest size and SHA-256. When a fetch fails or a check fails, the
browser export SHALL NOT start. The editor SHALL name the file and SHALL offer
server export. An `external` entry has no hash, so the browser SHALL check only
that its fetch succeeds.

#### Scenario: Export while a file uploads

- **WHEN** an export is requested and a used entry is `pending`
- **THEN** the export is refused and the message names the uploading file

#### Scenario: Export after every import finished

- **WHEN** every used entry is `ready` or `external`
- **THEN** the manifest adds no export blocker

#### Scenario: A managed file cannot be downloaded in the browser

- **WHEN** a browser export is requested and the fetch of a used `ready` entry fails
- **THEN** browser export does not start and the message names the file
- **AND** the editor offers server export

#### Scenario: Downloaded bytes do not match the manifest

- **WHEN** the SHA-256 of a fetched `ready` entry differs from its manifest hash
- **THEN** browser export does not start, the message names the file, and the editor offers server export

#### Scenario: A managed source is gone

- **WHEN** a used entry is `failed`
- **THEN** both browser export and server export are refused with a message that names the file
- **AND** the editor does not offer server export as a recovery
