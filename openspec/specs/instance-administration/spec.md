# instance-administration Specification

## Purpose

Defines deployment-wide administration of accounts, workspace metadata, and access while keeping workspace content behind its existing membership boundary.

## Requirements

### Requirement: Instance administration has one server-enforced authority

The system SHALL permit instance administration only to an authenticated active account holding the `instance_owner` role. Every instance-admin read and mutation SHALL enforce that role on the server; a hidden navigation item SHALL NOT serve as authorization. Role loss or suspension SHALL take effect on the next request.

#### Scenario: Ordinary member calls an admin route

- **WHEN** an authenticated account without `instance_owner` calls any instance-admin route
- **THEN** the request is refused with `403` and performs no read or mutation

#### Scenario: Former owner keeps an old session

- **WHEN** an account loses `instance_owner` while its session remains open
- **THEN** its next instance-admin request is refused

### Requirement: Instance directories expose bounded metadata

The instance owner SHALL be able to search and page through accounts, workspaces, and projects across the deployment. User details SHALL show account status and workspace memberships; workspace details SHALL show its owners, members, invitations, project count, and activity summary; project details SHALL show its workspace and administrative metadata only. Directory responses SHALL NOT contain project content, media, secrets, invitation tokens, or private output payloads.

#### Scenario: Owner searches users

- **WHEN** an instance owner searches the user directory
- **THEN** the API returns one bounded page, a total count, and only accounts matching the search

#### Scenario: Owner opens a project detail without membership

- **WHEN** an instance owner who is not a member of the project's workspace opens its God Mode detail
- **THEN** administrative metadata is shown and project content remains unavailable

#### Scenario: Member probes directory

- **WHEN** a non-owner asks for any instance directory
- **THEN** the request is refused without disclosing cross-workspace metadata

### Requirement: Instance owner manages accounts without orphaning ownership

The instance owner SHALL be able to suspend or restore a human account, revoke its sessions, and delete it after explicit confirmation. Suspension SHALL block new sign-in and existing sessions on their next request while retaining memberships for restoration. Deletion SHALL revoke sessions and remove account memberships; it SHALL be refused while the account is the last owner of any workspace or the last active instance owner. The system SHALL explain each refusal and SHALL NOT delete workspace or project content as a side effect of account deletion.

#### Scenario: Suspend an active account

- **WHEN** an instance owner suspends an account
- **THEN** its existing session stops authorizing requests and new sign-in is refused

#### Scenario: Delete a sole workspace owner

- **WHEN** deletion would leave a workspace without an owner
- **THEN** deletion is refused with the affected workspace named and no account or membership is removed

#### Scenario: Delete an eligible account

- **WHEN** an instance owner confirms deletion of an account that is not a last owner
- **THEN** its sessions and memberships are removed and workspace content remains unchanged

### Requirement: Instance owner manages explicit access

The instance owner SHALL be able to grant and revoke workspace membership and change owner/member roles for existing accounts through explicit admin actions. Each action SHALL enforce the workspace last-owner rule. Granting the instance owner membership SHALL use the same visible, audited action as granting anyone else; the role alone SHALL never grant content access.

#### Scenario: Admin grants self access

- **WHEN** an instance owner explicitly grants themself membership in a workspace
- **THEN** content access begins through ordinary membership checks and an audit event records the grant

#### Scenario: Admin creates a workspace

- **WHEN** an instance owner creates a workspace through God Mode
- **THEN** a named existing account becomes its first owner, the request is refused without one, and the admin gains no membership

#### Scenario: Admin opens content without membership

- **WHEN** an instance owner requests workspace or project content without membership
- **THEN** the existing tenant-access refusal is returned

### Requirement: Security-relevant admin mutations are attributable

The system SHALL retain an audit record for account status, role, session, membership, invitation, registration, credential, and workspace lifecycle mutations performed through God Mode. Each record SHALL include actor, action, target, time, and outcome, without storing secrets or raw invitation tokens. An instance owner SHALL be able to view recent records.

#### Scenario: Membership role changes

- **WHEN** an instance owner changes a workspace role
- **THEN** an audit record identifies actor, target account, workspace, outcome, and time

#### Scenario: Credential changes

- **WHEN** an instance owner updates a provider credential
- **THEN** the audit record names the setting and outcome but contains no credential value
