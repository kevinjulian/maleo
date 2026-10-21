# app-shell Specification

## Purpose

Defines the web app's standard frame: which of three layouts a route renders
in, the shared top bar, and the fixed structure of the workspace sidebar, so
every non-editor surface is navigated the same way.

## Requirements

### Requirement: Each route renders in exactly one of three shells

The web app SHALL render every signed-in route in exactly one layout:

- the **app shell** — workspace sidebar plus top bar — for workspace routes
  (content list, library, images, speech, video, workspace settings);
- the **God shell** — God Mode sidebar plus top bar — for God Mode routes;
- the **bare shell** — a header with a back control and the name of the area
  ("Account"), no sidebar, content in a centered reading measure under the
  page's own heading — for account routes. The header does not repeat the page
  heading.

The fullscreen routes (create, content editor, script, storyboard) SHALL keep
their own editor chrome and SHALL NOT render the app shell's sidebar or top bar.

#### Scenario: Workspace route

- **WHEN** a signed-in operator opens the Images page
- **THEN** it renders with the workspace sidebar and the top bar

#### Scenario: Account route

- **WHEN** a signed-in operator opens their Security page
- **THEN** no sidebar is rendered, the header shows a back control and "Account", and the page heading "Security" and its form sit in a centered column

#### Scenario: Back from an account page

- **WHEN** an operator who opened an account page from a workspace route activates its back control
- **THEN** they return to the route they came from; when there is none, they land on the content list

#### Scenario: Editor keeps its chrome

- **WHEN** an operator opens a project in the content editor
- **THEN** neither the app sidebar nor the top bar is rendered

### Requirement: The top bar carries the global controls

The app shell and the God shell SHALL show a top bar at desktop width containing,
in order: a sidebar toggle, the current page title or breadcrumb, a search control
that opens the command palette and shows its keyboard shortcut, the workspace
credit balance (app shell only), a theme toggle, and the user menu trigger.

Cmd+K (Ctrl+K off macOS) SHALL open the command palette from any shell route.
The sidebar toggle SHALL collapse the sidebar to an icon rail and expand it
again, and the choice SHALL persist across reloads in the same browser.

#### Scenario: Search from the top bar

- **WHEN** an operator activates the search control in the top bar
- **THEN** the command palette opens

#### Scenario: Collapsed sidebar survives a reload

- **WHEN** an operator collapses the sidebar and reloads the page
- **THEN** the sidebar is still collapsed

#### Scenario: Credits are workspace-scoped

- **WHEN** an operator is in God Mode
- **THEN** the top bar does not show a workspace credit balance

### Requirement: The workspace sidebar has a fixed structure

The app shell sidebar SHALL consist of:

- a header holding the workspace switcher, showing the active workspace's
  identity; its menu SHALL list the operator's workspaces and SHALL include
  entries leading to the workspace's settings and members panels;
- a body holding the work navigation groups;
- a footer holding a God Mode entry, shown only to an active instance owner,
  and the product mark with the running version.

Search, theme and credit controls SHALL NOT be duplicated in the sidebar.

#### Scenario: Reaching workspace members

- **WHEN** an operator opens the workspace switcher menu and selects Members
- **THEN** the workspace surface opens on its members panel

#### Scenario: Non-owner footer

- **WHEN** a signed-in operator who is not the instance owner views the sidebar
- **THEN** the footer shows the product mark and version and no God Mode entry

#### Scenario: Collapsed rail

- **WHEN** the sidebar is collapsed
- **THEN** every navigation entry remains reachable as an icon with an accessible name

### Requirement: Phone layout keeps the drawer and bottom navigation

At phone width the app shell SHALL hide the desktop sidebar, keep the bottom
navigation and the slide-in drawer, and condense the top bar to the drawer
toggle, the page title, a search control, the workspace chip and the user menu
trigger. The drawer SHALL present the same sidebar structure as desktop. Every
control of the desktop top bar SHALL remain reachable at phone width; the theme
toggle is reached through Preferences. The credit balance is information rather
than a control and SHALL be shown at desktop width only, so the page title keeps
its room on a 320px screen.

#### Scenario: Sign out on a phone

- **WHEN** an operator on a phone wants to sign out
- **THEN** the user menu is reachable from the condensed top bar without opening the drawer

#### Scenario: Search on a phone

- **WHEN** an operator on a phone wants the command palette
- **THEN** it is reachable from the drawer or the condensed top bar

### Requirement: Sidebar navigation shares visual and interaction contracts

Workspace and God Mode navigation SHALL share consistent grouped navigation chrome, header/footer slots, current-page states, focus indication and supported expanded/collapsed presentation. Domain destinations, workspace identity, instance-owner access and existing collapse persistence SHALL remain under their existing shells. Phone drawer navigation SHALL expose the same eligible destinations and recover focus after dismissal.

#### Scenario: Workspace and administration navigation

- **WHEN** an eligible operator visits workspace navigation and God Mode navigation
- **THEN** both use consistent navigation row, group and focus treatments while exposing their respective destinations
- **AND** God Mode eligibility and workspace boundaries remain enforced

#### Scenario: Phone drawer dismissal

- **WHEN** an operator opens and dismisses phone navigation
- **THEN** destinations remain reachable and focus returns to the opener

### Requirement: App and editor topbars share owned chrome

App, God Mode and editor topbars SHALL share standard token-driven height, border, spacing, surface and focus treatments through explicit presentation variants. Their title/navigation, status and action regions SHALL retain each surface's controls and state ownership. Long titles SHALL truncate without obscuring essential actions; phone presentation SHALL retain reachable navigation, save feedback and applicable project actions without horizontal viewport overflow. Fullscreen editors SHALL keep their dedicated chrome and SHALL NOT gain the app sidebar.

#### Scenario: Long editor title on a phone

- **WHEN** a project with a long title is opened at 320px width
- **THEN** title truncates, essential actions remain reachable and the viewport does not scroll horizontally

#### Scenario: Workspace and God controls

- **WHEN** workspace and God Mode headers render
- **THEN** search, theme and account actions follow consistent chrome and credits remain workspace-scoped

#### Scenario: Editor save and export

- **WHEN** editor save status or export availability changes
- **THEN** existing feedback and preflight behavior remain correct within standard topbar presentation
