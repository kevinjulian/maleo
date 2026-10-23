## Purpose

Keep a project's media library as server-owned records that change through the project command log, so every client of the project sees the same library, including uploads not yet placed on the timeline.

## ADDED Requirements

### Requirement: The server owns the project's media library

The system SHALL store a project's media library as one record per asset, held by the server. A client SHALL NOT replace the stored library by writing a whole list. The project read SHALL return the library from these records.

#### Scenario: Two devices are open

- **WHEN** a client admits an asset while a second client of the same project is open
- **THEN** the second client shows the asset after its next read of the command log, without a reload, and neither client's assets are removed

#### Scenario: The editor state is saved

- **WHEN** a client saves its editor state with a media list in it
- **THEN** the stored library does not change

### Requirement: Library changes travel in the command log

A change to the media library SHALL be a command in the project command log, executed by the server against the current library and recorded in the same transaction as the record change. An entry that changes only the library SHALL NOT write a storyboard version. A delivered `scope.replace`, including a snapshot, SHALL carry the server's library, and clients SHALL apply it.

#### Scenario: An asset is admitted without being placed

- **WHEN** a client submits a `media.admit` command and nothing else
- **THEN** the server stores the asset, records one log entry that names no storyboard version, and the storyboard version does not change

#### Scenario: An asset is admitted and placed in one submission

- **WHEN** a client submits a `media.admit` command and a `clip.insert` that references the asset
- **THEN** the server stores the asset and writes one new storyboard version whose log entry holds both commands

#### Scenario: A client catches up from a snapshot

- **WHEN** a client reads after a sequence the log no longer holds
- **THEN** the snapshot entry holds the head scope with the server's library, and the client's library matches it after applying the entry

### Requirement: A finished upload enters the library on the server

When a media import finishes, the server SHALL store the asset under the identity the client minted and SHALL record a `media.admit` entry in the project command log, before any client places it.

#### Scenario: An upload finishes on one device

- **WHEN** a file uploaded from one device finishes importing
- **THEN** a second device of the same project shows the asset in the library after its next read, before anyone places it on the timeline

#### Scenario: The uploading device already shows the asset

- **WHEN** the uploading client already shows the pending asset under its minted identity
- **THEN** applying the server's `media.admit` entry leaves one asset under that identity

### Requirement: Versionless entries follow retention

A log entry without a storyboard version SHALL be retained while any versioned entry with a lower sequence is retained, and SHALL be pruned in the transaction that prunes the last such versioned entry. Log sequences SHALL NOT be reused.

#### Scenario: Retention prunes old versions

- **WHEN** a write prunes the oldest retained versions
- **THEN** library-only entries older than the oldest remaining versioned entry are removed in the same transaction, and a client behind them receives a snapshot

### Requirement: A stored media list is imported once

The first time the server reads a project's scope after this change, it SHALL import the media list the project stored before (in its editor state, or in an older storyboard document), deduplicated by URL, and SHALL NOT import it again. A project with no stored list SHALL start with an empty library.

#### Scenario: An existing project is opened

- **WHEN** a project saved before this change is opened
- **THEN** its library shows every asset its stored list held, each once, and the editor's next save does not change it

#### Scenario: Two first reads race

- **WHEN** two requests read the same unimported project at the same time
- **THEN** the list is imported once
