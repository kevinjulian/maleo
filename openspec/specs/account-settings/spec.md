# account-settings Specification

## Purpose

Gives each signed-in operator a place to see who they are signed in as, sign
out, and manage their own profile, password, sessions and display preferences,
independent of any workspace.

## Requirements

### Requirement: The user menu identifies the account and leads to its pages

Every shell's top bar SHALL show a user menu trigger displaying the signed-in
operator's initials. Opening it SHALL show the account email and global role,
entries for Profile, Security and Preferences, and a Sign out entry. The menu
SHALL be operable by keyboard and close on Escape with focus returned to the
trigger.

#### Scenario: Owner opens the menu

- **WHEN** the instance owner opens the user menu
- **THEN** it shows their email, an instance-owner role label, the three account entries, and Sign out

#### Scenario: Keyboard close

- **WHEN** the menu is open and the operator presses Escape
- **THEN** the menu closes and focus returns to the trigger

### Requirement: Sign out revokes the session and leaves the app

Selecting Sign out SHALL revoke the current session server-side and then show
the sign-in screen. No workspace data SHALL remain rendered after sign-out, and
the stored active-workspace choice SHALL NOT leak into a different account's
next session.

#### Scenario: Signing out

- **WHEN** an operator selects Sign out
- **THEN** the sign-in screen is shown, and a subsequent request with the old cookie is refused with `401`

#### Scenario: Sign-out fails

- **WHEN** the sign-out request fails for a network reason
- **THEN** the operator is told it failed and remains signed in, rather than being shown the sign-in screen with a live session

### Requirement: Profile shows identity and edits the display name

The Profile page SHALL show the account email read-only and SHALL let the
operator change their display name. An empty or whitespace-only name SHALL be
refused before submission. A saved name SHALL appear in the user menu and
wherever the operator is listed without a reload.

#### Scenario: Rename

- **WHEN** an operator saves a new display name
- **THEN** the page confirms the save and the new name is shown on the next open of the user menu

#### Scenario: Blank name

- **WHEN** an operator clears the name field
- **THEN** the save control is unavailable and the field explains why

### Requirement: Security changes the password and manages sessions

The Security page SHALL let the operator change their password by entering the
current password, a new password, and a confirmation. The new password SHALL
meet the deployment's minimum length, and the form SHALL state that minimum.
A mismatched confirmation SHALL be refused before submission. A wrong current
password SHALL be reported without clearing the new-password fields. A
successful change SHALL revoke every other session of that account and keep the
current one.

The Security page SHALL list the account's active sessions with their browser
or device description and last activity, mark the current one, and offer a
single action that signs out every other session.

#### Scenario: Password changed

- **WHEN** an operator submits a correct current password and a valid matching new password
- **THEN** the page confirms the change, the operator stays signed in, and their sessions in other browsers are refused on their next request

#### Scenario: Wrong current password

- **WHEN** the current password is wrong
- **THEN** the page says so and does not change the password

#### Scenario: Too short

- **WHEN** the new password is shorter than the deployment minimum
- **THEN** the change control is unavailable and the field states the minimum

#### Scenario: Sign out elsewhere

- **WHEN** an operator with sessions in two other browsers selects "Sign out other sessions"
- **THEN** only the current session remains listed and the other two are refused on their next request

### Requirement: Preferences holds per-operator display settings

The Preferences page SHALL let the operator choose the theme — light, dark, or
follow the system — and the choice SHALL apply immediately and agree with the
top bar's theme toggle.

#### Scenario: Theme choice

- **WHEN** an operator selects Dark on the Preferences page
- **THEN** the app switches to dark at once and the top bar toggle reflects dark
