# workspace-invitations Specification

## Purpose

TBD - created by syncing change add-workspace-management. Update Purpose after archive.

## Requirements

### Requirement: An owner invites by minting a link

A workspace owner SHALL be able to create an invitation to their workspace and
receive a link for it. The system SHALL NOT require a mail transport to deliver
it — the link is handed to the operator, who delivers it however they choose.

An invitation SHALL name the workspace it grants and the role it grants.

#### Scenario: Creating an invitation

- **WHEN** an owner creates an invitation
- **THEN** a link is returned that can be copied, and the invitation appears in the workspace's pending list

#### Scenario: No mail is sent

- **WHEN** an invitation is created on a deployment with no mail configuration
- **THEN** it succeeds, because delivery is not the system's responsibility

### Requirement: An invitation is a revocable, single-use credential

An invitation token SHALL be unguessable, SHALL be stored hashed rather than in
plaintext, SHALL expire after a bounded lifetime, and SHALL be redeemable at
most once. An owner SHALL be able to revoke a pending invitation, after which
the link no longer works.

Stored hashed because the token grants membership: a database read must not
yield a working invitation to every workspace on the deployment.

#### Scenario: The stored invitation is inspected

- **WHEN** the invitation row is read directly from the database
- **THEN** it contains a hash, and the value from the link cannot be recovered from it

#### Scenario: A link is used twice

- **WHEN** an invitation that has already been redeemed is presented again
- **THEN** it is refused, and no second membership or account is created

#### Scenario: A link is presented after it expires

- **WHEN** an invitation is presented after its lifetime has elapsed
- **THEN** it is refused

#### Scenario: An invitation is revoked

- **WHEN** an owner revokes a pending invitation and the link is then presented
- **THEN** it is refused

#### Scenario: A forged token is presented

- **WHEN** a token that was never issued is presented
- **THEN** it is refused, in the same way and with the same answer as an expired one

### Requirement: Redeeming an invitation is the second way past closed registration

Redemption SHALL create an account and its workspace membership together, on a
deployment where self-registration is closed. This is permitted because the
token proves a workspace owner asked for this account to exist.

Redemption SHALL be subject to the same credential rules as sign-up: the same
password requirements, the same rate limiting, and the same argon2id storage. A
caller who is already signed in SHALL have the membership added to their
existing account rather than being given a second one.

#### Scenario: A new person redeems an invitation

- **WHEN** an anonymous caller presents a valid invitation and chooses a password
- **THEN** an account is created, its membership in the named workspace is created, and they are signed in

#### Scenario: Registration is closed

- **WHEN** a valid invitation is redeemed on a deployment where self-registration is disabled
- **THEN** it succeeds, because the invitation is the authorisation

#### Scenario: An existing account redeems an invitation

- **WHEN** a signed-in account presents a valid invitation
- **THEN** the membership is added to that account, and no second account is created

#### Scenario: Redemption does not grant the deployment

- **WHEN** an account is created by redeeming an invitation
- **THEN** it holds no instance-wide role, and no membership beyond the workspace the invitation named

### Requirement: The members list shows who may act, and lets an owner remove them

The workspace surface SHALL list the accounts holding membership of the
workspace and the role each holds, alongside pending invitations. An owner SHALL
be able to remove a member.

A refusal to remove the last owner SHALL be presented as an explained refusal,
not as an error. That rule already exists; this requirement is that an operator
meets it as a sentence rather than as a failure.

#### Scenario: Listing members

- **WHEN** an owner opens the members panel
- **THEN** each member is listed with their role, and pending invitations are shown separately

#### Scenario: Removing a member

- **WHEN** an owner removes a member
- **THEN** that account loses access on its next request, without needing to sign out

#### Scenario: Removing the last owner

- **WHEN** an owner attempts to remove the only remaining owner
- **THEN** the refusal is shown as an explanation of why, and the membership is unchanged

#### Scenario: A member sees the list without the controls

- **WHEN** an account with the member role opens the members panel
- **THEN** it can see who is in the workspace, and is not offered invite or remove

### Requirement: Instance owner can administer invitations across workspaces

An instance owner SHALL be able to mint and revoke workspace invitations through God Mode without holding membership in the target workspace. The invitation SHALL follow the same hashed-token, expiry, single-use, and redemption rules as a workspace-owner invitation. Minting and revocation SHALL be audited; the raw token SHALL appear only in its one-time creation response.

#### Scenario: Admin invites to another workspace

- **WHEN** an instance owner mints an invitation for a workspace they do not belong to
- **THEN** a single-use link is returned once, and redeeming it grants only the named workspace and role

#### Scenario: Admin revokes an invitation

- **WHEN** an instance owner revokes a pending invitation through God Mode
- **THEN** redemption is refused and the audit record contains no raw token
