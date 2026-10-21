# operator-authentication Specification

## Purpose

Who may reach this deployment at all: session-backed operator sign-in, how the
first account is created, how credentials are stored and verified, and the
origins allowed to present a session.

## Requirements

### Requirement: Every browser-reachable path requires an authenticated session

The API SHALL refuse any request that does not carry a valid session, with `401`,
except paths that authenticate by a machine credential as defined in
`service-boundary-authentication`. The refusal SHALL be the default for a new
route: a route added without a decision about its authentication SHALL be
covered, not exposed.

The perimeter SHALL be the request dispatch, not a path prefix. `/uploads/*` and
`/internal/*` are resolved before the `/api/*` application is reached, so a
requirement written against `/api/*` alone would be satisfied while media and
credential endpoints stayed open.

#### Scenario: An anonymous request reaches a data route

- **WHEN** a request with no session cookie is made to any `/api/*` route other than sign-in or a declared machine boundary
- **THEN** the API responds `401` and performs no read, write, or provider call

#### Scenario: An anonymous request reaches a media file

- **WHEN** a request with no session cookie is made to a `/uploads/*` path, including a range request for an existing file
- **THEN** the API responds `401` and no bytes of the file are served

#### Scenario: A new route inherits the default

- **WHEN** a route is added to the API without naming its authentication
- **THEN** it requires a session, because coverage is applied at the dispatch and not per route

#### Scenario: An expired session is refused

- **WHEN** a request carries a session cookie whose session has expired or been revoked
- **THEN** the API responds `401` and the stale cookie is cleared

### Requirement: Sessions are server-side and revocable

The system SHALL store sessions server-side and identify them with an httpOnly,
SameSite=Lax cookie. The cookie SHALL carry `Secure` whenever the request is
served over HTTPS, and a production deployment SHALL be configured such that it
always does. A session SHALL be revocable such that the next request using it is
refused. The system SHALL NOT use a self-contained bearer token that stays valid
until expiry.

A session SHALL have a bounded lifetime, and the system SHALL provide a sign-out
that revokes the current session server-side rather than only clearing the
cookie.

`Secure` is conditional because it is not merely advisory: a browser does not
store a `Secure` cookie delivered over `http://127.0.0.1`, so specifying it
unconditionally would make local sign-in impossible rather than safer.

#### Scenario: A session is revoked

- **WHEN** a session is deleted server-side
- **THEN** the next request presenting that session cookie is refused with `401`

#### Scenario: An operator signs out

- **WHEN** an operator signs out
- **THEN** the session is deleted server-side, and presenting the same cookie afterwards is refused

#### Scenario: The session cookie is not readable by scripts

- **WHEN** the sign-in response sets the session cookie over HTTPS
- **THEN** the cookie carries httpOnly, Secure, and SameSite=Lax

#### Scenario: Sign-in over plain HTTP in development

- **WHEN** the API is reached over `http://127.0.0.1` in development
- **THEN** the cookie is set without `Secure`, and sign-in works, while the production configuration still requires it

### Requirement: The first account becomes the instance owner and closes registration

On a database with no accounts, the system SHALL permit exactly one account to be
created without an invitation, and that account SHALL hold the instance owner
role. Once an account exists, self-registration SHALL be refused unless an
operator has explicitly enabled it.

The instance owner governs registration policy. It is distinct from the
workspace owner role defined in `workspace-membership`, which governs
administration within one workspace.

#### Scenario: First run

- **WHEN** the API starts against a database with no accounts and a sign-up is submitted
- **THEN** the account is created with the instance owner role

#### Scenario: The first account can reach existing workspaces

- **WHEN** the first account is created on a database that already holds workspaces
- **THEN** it is granted workspace owner membership of each of them, so no existing work becomes unreachable

#### Scenario: Second account without invitation

- **WHEN** an account already exists, registration has not been explicitly enabled, and a sign-up is submitted
- **THEN** it is refused, and no account is created

#### Scenario: Registration is deliberately opened

- **WHEN** an operator enables self-registration
- **THEN** sign-up succeeds and the new account holds no role beyond member, and no workspace membership

### Requirement: Credentials are verified against a memory-hard hash

The system SHALL store password verifiers using a memory-hard algorithm
(argon2id) and SHALL NOT store a reversible or fast-hash representation. A failed
sign-in SHALL NOT reveal whether the address is registered.

#### Scenario: A stored credential is inspected

- **WHEN** the account row holding a password verifier is read directly from the database
- **THEN** it contains an argon2id verifier and no recoverable password

#### Scenario: Sign-in fails

- **WHEN** sign-in is attempted with an unknown address, and separately with a known address and a wrong password
- **THEN** both responses are indistinguishable in body and status

### Requirement: Sign-in attempts are rate limited

The system SHALL limit repeated failed sign-in attempts against the same account
and from the same origin, and SHALL refuse further attempts once the limit is
reached.

#### Scenario: Repeated failures

- **WHEN** sign-in fails repeatedly for one account beyond the configured limit
- **THEN** further attempts are refused for a cooling period, independently of whether the password is correct

### Requirement: The cross-origin allowlist is a credential boundary

The API SHALL answer cross-origin requests with credentials only for origins on
a configured allowlist, and an unconfigured allowlist SHALL allow nothing rather
than everything.

This is recorded as a requirement because its consequence changes here. The
allowlist already runs with credentials enabled; once that credential is a
session cookie, a permissive entry is a session-theft path rather than a
convenience.

#### Scenario: An unlisted origin presents a session

- **WHEN** a cross-origin request from an origin absent from the allowlist carries a session cookie
- **THEN** the response does not grant that origin access to it

#### Scenario: The allowlist is unset

- **WHEN** no allowlist is configured
- **THEN** no cross-origin credentialed request is permitted

### Requirement: An operator can reset a forgotten password without email

The system SHALL provide a command, run from a shell that reaches the runtime
database, that replaces the password of an existing email-and-password account.
The command SHALL read the new password from standard input rather than its
arguments, SHALL enforce the same minimum length as sign-up, SHALL store a
memory-hard verifier, and SHALL clear the sign-in rate-limit counts so the
operator can sign in at once. The operator guide SHALL document it.

#### Scenario: Known account is reset

- **WHEN** the command is run with the address of an existing account and a new
  password that meets the minimum length
- **THEN** the account's stored verifier is replaced by an argon2id verifier of
  the new password, the sign-in rate-limit counts are cleared, and the command
  exits zero

#### Scenario: Address matching is case-insensitive

- **WHEN** the address is given in a different letter case from the one stored
- **THEN** the same account is reset

#### Scenario: Unknown address

- **WHEN** no email-and-password account exists for the address
- **THEN** nothing is changed and the command exits non-zero naming the address

#### Scenario: Password below the minimum

- **WHEN** the new password is shorter than the sign-up minimum
- **THEN** nothing is changed and the command exits non-zero stating the minimum

#### Scenario: Password stays out of shell history

- **WHEN** an operator runs the command
- **THEN** the password is not part of the command line, so it is absent from
  shell history and the process list

### Requirement: Instance owner controls registration policy

The instance owner SHALL be able to set self-registration to open or invitation-only from God Mode. The default SHALL remain invitation-only after the first account is created, and a valid workspace invitation SHALL still permit account creation. An explicitly configured deployment environment override SHALL take precedence and be shown as read-only in the UI rather than appearing to save an ineffective setting.

#### Scenario: Registration is opened

- **WHEN** an instance owner opens self-registration with no environment override
- **THEN** a new account can sign up with the member role and no workspace membership

#### Scenario: Registration is invitation-only

- **WHEN** an instance owner closes self-registration
- **THEN** an uninvited sign-up is refused while valid invitation redemption still works

#### Scenario: Environment overrides stored policy

- **WHEN** deployment configuration fixes registration policy
- **THEN** God Mode displays the effective policy and its source and does not present a save action that cannot take effect

### Requirement: Account suspension and session revocation take effect promptly

A suspended account SHALL be refused by sign-in and by the next request using any existing session. Revoking an account's sessions SHALL end those sessions without changing its credentials, memberships, or status. Restoring a suspended account SHALL permit sign-in again without recreating memberships.

#### Scenario: Existing session after suspension

- **WHEN** an account is suspended while signed in
- **THEN** its next request is refused and its session cannot continue acting

#### Scenario: Admin revokes sessions

- **WHEN** an instance owner revokes another account's sessions
- **THEN** those sessions are refused on their next request while the account may sign in again

### Requirement: Instance ownership can be transferred without losing recovery

An active instance owner SHALL be able to grant `instance_owner` to an active human account and relinquish that role only while another active instance owner remains. Suspended accounts SHALL NOT hold the only active instance-owner role. Role changes SHALL take effect for existing sessions on the next request.

#### Scenario: Last active owner tries to demote themself

- **WHEN** the only active instance owner requests demotion
- **THEN** the request is refused and the role is unchanged

#### Scenario: Owner promotes a successor

- **WHEN** an active owner promotes another active human account
- **THEN** that account can enter God Mode on its next request
