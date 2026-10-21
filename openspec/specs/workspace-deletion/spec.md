# workspace-deletion Specification

## Purpose

TBD - created by syncing change add-workspace-management. Update Purpose after archive.

## Requirements

### Requirement: Deleting a workspace removes everything partitioned by it

Deletion SHALL remove every row anywhere in the database that belongs to the
workspace, whether it carries the partition key directly or is reachable only
through something that does. After deletion, no row in any runtime table SHALL
reference the deleted workspace.

The rows reachable only indirectly are the ones this requirement exists for:
storyboards, renders, outputs, events, notes, speakers, citations, style locks
and reference links hang off a project; step, tool and action rows hang off a
durable run; credit transactions, usage records and reservations hang off a
credit account. None of them carries the workspace key, and all of them belong
to the workspace.

The set of tables SHALL be derived from the schema declaration rather than
maintained as a list beside it, so a table added to the schema cannot be missed
here.

#### Scenario: A workspace with work in it is deleted

- **WHEN** a workspace holding projects, storyboards, renders, generation history and a credit account is deleted
- **THEN** no row in any runtime table names that workspace, and no row remains that was reachable only through its projects or runs

#### Scenario: Another workspace is untouched

- **WHEN** one workspace is deleted
- **THEN** every other workspace's rows are unchanged

#### Scenario: A table is added to the schema

- **WHEN** a new workspace-partitioned table is declared in the schema
- **THEN** deletion covers it without a second edit, because the table set is derived

### Requirement: Deletion removes the workspace's files, and only after its rows

Deletion SHALL remove the workspace's directory and the files it uploaded.
Row removal SHALL be committed before any file is deleted.

The order is the requirement. Deleting files first and then failing to commit
leaves rows that point at media which is gone — a workspace that every query
says is healthy and every screen renders broken. Orphaned files after a crash
are the tolerable direction, because the rows that named them are already gone.

#### Scenario: Files follow rows

- **WHEN** a workspace is deleted
- **THEN** its rows are committed first, and its directory and uploaded files are removed after

#### Scenario: The row deletion fails

- **WHEN** the transaction removing a workspace's rows fails
- **THEN** it rolls back and no file has been deleted

### Requirement: Deletion is refused when it would strand the operator or the data

Deletion through the workspace surface SHALL be refused when the workspace is the last one its owner belongs to. The system SHALL permit an instance owner to delete a workspace through a separate God Mode action without belonging to it, but SHALL show which accounts would lose their last membership and SHALL require explicit confirmation of that impact. The system SHALL refuse deletion of the deployment's final workspace. Every deletion SHALL cancel the workspace's in-flight durable runs before removing anything. A workspace member without the owner role and without instance-owner authority SHALL be refused.

The last-workspace rule on the workspace surface is about reachability, not data safety: an account with no memberships signs in to an application scoped to nothing, with an empty switcher and no way to create anything, which presents as a broken deployment rather than as a consequence of what they just did. God Mode makes that impact visible before its instance-wide operation.

#### Scenario: The owner's only workspace

- **WHEN** a workspace owner attempts to delete the only workspace they belong to through the workspace surface
- **THEN** it is refused and explained, and the workspace is unchanged

#### Scenario: A run is in flight

- **WHEN** a workspace with an executing durable run is deleted through either surface
- **THEN** the run is cancelled before deletion, and does not later write rows for a workspace that no longer exists

#### Scenario: A member attempts deletion

- **WHEN** an account without the workspace-owner or instance-owner role attempts deletion
- **THEN** it is refused

#### Scenario: Instance owner deletes a workspace they do not belong to

- **WHEN** an instance owner confirms God Mode deletion after viewing affected accounts and typing the workspace name
- **THEN** the existing row and file cleanup runs, the workspace disappears from every directory, and no other workspace changes

#### Scenario: Final workspace

- **WHEN** an instance owner requests deletion of the only remaining workspace
- **THEN** deletion is refused and the workspace remains usable

### Requirement: Deletion is confirmed by naming what is being destroyed

Deletion SHALL require the operator to type the workspace's name, and SHALL
state what will be destroyed before they do. A confirmation that can be
satisfied by pressing one button SHALL NOT be sufficient.

There is no undo. A dialog dismissed by habit is the failure mode this guards
against.

#### Scenario: Confirming a deletion

- **WHEN** an owner opens the delete control
- **THEN** they are told what will be destroyed and asked to type the workspace name

#### Scenario: The typed name does not match

- **WHEN** the typed name does not match the workspace
- **THEN** deletion cannot be submitted

#### Scenario: After deletion

- **WHEN** a workspace is deleted
- **THEN** it no longer appears in the switcher, and reaching it by address is refused the same way an unknown workspace is
