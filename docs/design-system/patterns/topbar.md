# Topbar

Status: Approved. Owner: design-system patterns.

## Purpose

Standardize top-level app and editor header chrome.

## Use when

Use for page/editor header with title, status and actions. PanelHeader remains owner of panel headers.

## Structure

Topbar holds TopbarLeading, optional TopbarStatus and TopbarActions. Native header semantics remain intact.

## Allowed controls and composition

Compose canonical buttons, icons, breadcrumbs, workspace identity, search and account actions. Adapters own save/export, credits and routing. Pattern owns layout and appearance.

## Variants, density and responsive behavior

App uses `--topbar-h` (48px); editor uses `--cv-top` (53px), matching existing workspace and Sheet geometry. Both share borders and surface vocabulary. Leading content shrinks before essential actions; long titles truncate. Narrow status is visually hidden while live-region announcements remain available. Topbar owns sticky chrome; editor/VUI owns workspace geometry.

## Accessibility and states

Keep accessible action names, focus indication, live save/error status, disabled/busy export state and reachable phone controls. No feature state or IO in pattern.

## Current usages and ownership

TopBar supplies workspace/God chrome. EditorTopbar supplies mode tabs, save badge and export. BareShell and CreateForm use same header pattern.

## Acceptance evidence

See accepted tasks and proof (private historical record). Acceptance requires desktop/320px themes, long titles, status and export/search/account controls without viewport overflow.

## Implementation

Import Topbar, TopbarLeading, TopbarStatus and TopbarActions from `@design-system/patterns/topbar.tsx`. Styles live beside component. Stories: `stories/patterns/shell/shell.stories.tsx`. Component tests: `src/design-system/patterns/shell.test.tsx`. Leading/status/actions are documented slots, not separate patterns.
