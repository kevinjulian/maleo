## MODIFIED Requirements

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
