# project-command-log Specification

## Purpose

Record the editor commands that change a project's storyboard in one server-sequenced log, so every client applies the same edits in the same order and can catch up from any retained point.

## Requirements

### Requirement: Each storyboard version has one log position

The system SHALL keep a command log per project, ordered by a per-project
sequence the server issues under the same lock as storyboard versions. Every
new storyboard version SHALL have exactly one log entry, at a new sequence,
and the entry SHALL name its version. An entry
SHALL hold either the editor commands that produced the version, in the order
applied, or one `scope.replace` command holding the full editable scope when
the version came from a writer that does not submit commands.

#### Scenario: The editor submits commands

- **WHEN** the server accepts two commands in one submission
- **THEN** one new version is written, and its log entry holds the two commands in order

#### Scenario: The agent saves a whole document

- **WHEN** an agent run writes a new storyboard version
- **THEN** its log entry holds one `scope.replace` command with the new scope

### Requirement: The server applies submitted commands to the current head

`POST /projects/:id/commands` SHALL accept a base sequence and a list of
commands, each with a client command identity. The server SHALL execute each
command in order against the current head, not against the base sequence,
through the shared editor engine. It SHALL validate the resulting document
with the same rules the storyboard save route applies. A command that fails
execution or validation SHALL be rejected with its engine or validation
reason, and the server SHALL continue with the next command. When at least
one command is accepted, the server SHALL write one new version in the same
transaction as its log entry.

The response SHALL list accepted and rejected client command identities, the
new head sequence and version, and every log entry after the base sequence
that this submission did not create.

#### Scenario: The base sequence is behind the head

- **WHEN** a client submits a command with a base sequence older than the head, and the command still applies
- **THEN** the command is accepted against the head, and the response includes the entries the client missed

#### Scenario: One command fails

- **WHEN** a submission holds three commands and the second targets a clip that no longer exists
- **THEN** the first and third are accepted, the second is rejected with the engine's reason, and one version holds the two accepted commands

#### Scenario: A command produces an invalid document

- **WHEN** an accepted execution yields a document with a `blob:` media URL
- **THEN** that command is rejected with the save route's reason and no version holds it

### Requirement: A retried submission does not repeat its effect

A client command identity SHALL be unique per project. When a submission
repeats an identity the server already processed, the server SHALL return the
first outcome for that identity and SHALL NOT execute it again.

#### Scenario: A network failure hides the response

- **WHEN** a client resends a submission whose first attempt was accepted
- **THEN** the response reports the same accepted identities and version, and no new version is written

### Requirement: Clients read the log after a version

`GET /projects/:id/commands?after=<sequence>` SHALL return every log entry
after that sequence, in order, with the head sequence and version. When the
log no longer holds every entry after the requested sequence, the response
SHALL instead be one `scope.replace` entry holding the head scope, marked as a
snapshot.

#### Scenario: A client catches up

- **WHEN** a client at sequence 10 reads after 10 and the head is 13
- **THEN** it receives entries 11, 12 and 13 in order

#### Scenario: The client is too far behind

- **WHEN** a client reads after a sequence whose following entries retention already pruned
- **THEN** it receives one snapshot `scope.replace` entry at the head version

### Requirement: Log entries follow version retention

A log entry SHALL be pruned in the same transaction that prunes its version,
and SHALL be retained while its version is retained. Log sequences SHALL NOT
be reused.

#### Scenario: Retention prunes a version

- **WHEN** a write prunes an old unreferenced version
- **THEN** that version's log entry is removed in the same transaction

### Requirement: Only project editors use the log

The submit route SHALL require the caller to be allowed to edit the project.
The read route SHALL require membership of the project's workspace. Any other
caller SHALL receive the refusal the project routes give.

#### Scenario: A non-member submits commands

- **WHEN** an account outside the workspace posts commands
- **THEN** the request is refused and no command executes

### Requirement: The web editor saves through the log

The web editor SHALL persist edits by submitting its pending commands, and
SHALL NOT post whole storyboard documents for edits it can express as
commands. It SHALL apply delivered entries through the shared core's rebase,
SHALL apply the media library a delivered `scope.replace` carries, keeping only
its own assets whose upload has not finished,
and SHALL tell the user when a pending edit was rejected or dropped. The editor
SHALL NOT submit its local merge or preview of an agent run; when the run ends,
the run's version from the log SHALL replace the local merge. Fields outside
the editable scope SHALL be saved through a route that writes only those
fields onto the head.

#### Scenario: An agent edit lands while the user edits

- **WHEN** the user has unsent edits and an agent run writes a new version
- **THEN** the next submission returns the agent's `scope.replace`, the editor rebases the user's edits on it, and both changes are visible

#### Scenario: A presentation setting changes while edits are pending

- **WHEN** the user changes the presentation while commands are pending
- **THEN** only the presentation fields are written onto the head, and each pending command is applied once

#### Scenario: An edit is rejected

- **WHEN** the server rejects one of the user's commands
- **THEN** the editor removes it from the document and shows the reason
