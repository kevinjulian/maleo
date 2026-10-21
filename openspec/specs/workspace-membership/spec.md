# workspace-membership Specification

## Purpose

Which workspaces an authenticated account may act in. Membership is the tenancy
boundary; `workspace-scoping` decides only what an operator is shown.

## Requirements

### Requirement: An account acts only in workspaces it belongs to

The system SHALL record membership between accounts and workspaces in a table the
schema module owns, keyed by the workspace partition key and the account
identifier. A request SHALL be authorised against the workspace it names, and a
request naming a workspace the account does not belong to SHALL be refused.

`workspace` remains the tenant partition key defined by `workspace-tenancy`.
Membership adds who may act within a partition; it does not introduce a second
identifier for a workspace, and SHALL NOT be modelled by a table that carries its
own workspace identity.

#### Scenario: A member acts in their workspace

- **WHEN** an authenticated account requests a resource in a workspace it belongs to
- **THEN** the request proceeds

#### Scenario: Cross-workspace access

- **WHEN** an authenticated account requests a resource in a workspace it does not belong to
- **THEN** the request is refused, and the response does not reveal whether that workspace exists

#### Scenario: A workspace is listed

- **WHEN** an authenticated account lists workspaces
- **THEN** only workspaces it belongs to are returned

#### Scenario: Membership references the partition key directly

- **WHEN** a membership row is written
- **THEN** it names the workspace by the same key every partitioned table uses, with no separate workspace identifier to keep in step

### Requirement: The workspace a request acts on comes from the request, not the session

The workspace SHALL be named by the request and checked against membership. The
system SHALL NOT infer a workspace from session state alone, so that a stale
session cannot silently act on the wrong tenant.

#### Scenario: A request omits the workspace

- **WHEN** a workspace-scoped route is called without naming a workspace
- **THEN** it is refused rather than defaulting to one

#### Scenario: Membership changes mid-session

- **WHEN** an account is removed from a workspace while holding a live session
- **THEN** its next request naming that workspace is refused without requiring re-authentication

### Requirement: The workspace owner role exists and cannot be emptied

Each workspace SHALL retain at least one member holding the workspace owner
role. An operation that would remove the last owner of a workspace SHALL be
refused.

This is the workspace owner, not the instance owner defined in
`operator-authentication`. The instance owner governs registration policy for the
deployment; a workspace owner governs administration of one tenant, and an
account may be either, both, or neither.

#### Scenario: Removing the last owner of a workspace

- **WHEN** an operation would leave a workspace with zero members holding the owner role
- **THEN** it is refused and the role assignment is unchanged

#### Scenario: The instance owner is not a workspace owner everywhere

- **WHEN** the instance owner is removed from a workspace that has another owner
- **THEN** the removal is permitted, because the instance role and the workspace role are separate

### Requirement: Membership does not outlive its workspace

When a workspace is removed from the registry, its membership rows SHALL be
removed with it.

A membership naming an absent workspace is already unreachable — the registry
check refuses the request before membership is consulted — so this requirement
exists to stop the table accumulating rows nothing can reach, not to close a
hole.

#### Scenario: A workspace leaves the registry

- **WHEN** the workspace registry sync drops a workspace
- **THEN** membership rows naming it are removed

#### Scenario: A request names a workspace that no longer exists

- **WHEN** an authenticated account names a workspace absent from the registry
- **THEN** the request is refused by the registry check, indistinguishably from naming a workspace it does not belong to

### Requirement: Instance administration changes membership explicitly

An instance owner SHALL be able to add an existing account to a workspace, change its member or owner role, and remove it through God Mode without becoming a workspace member. These operations SHALL preserve the workspace last-owner guarantee and SHALL be audited. Ordinary workspace-scoped requests SHALL continue checking the caller's own membership.

#### Scenario: Admin changes another account's role

- **WHEN** an instance owner changes an existing workspace member from member to owner
- **THEN** the new role is effective on that member's next workspace request and the admin's own membership is unchanged

#### Scenario: Admin tries to remove last owner

- **WHEN** an instance owner tries to remove or demote the only workspace owner
- **THEN** the request is refused and the workspace retains its owner

#### Scenario: Admin grants self membership

- **WHEN** an instance owner explicitly adds themself to a workspace
- **THEN** the action is recorded and content access begins only after the membership exists
