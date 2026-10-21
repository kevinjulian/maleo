# SidebarNavigation

Status: Approved. Owner: design-system patterns.

## Purpose

Standardize route navigation chrome across workspace and instance administration.

## Use when

Use for persistent side navigation or navigation inside a drawer. Do not use for editor mode tabs or timeline tools.

## Structure

Header, named groups of destinations, optional footer destinations, product footer. Shell owns placement and collapse state.

## Allowed controls and composition

Items carry identity, label, canonical icon and navigation callback. Header may contain WorkspaceSwitcher and IconButton. Footer accepts product identity and version. Features enforce authorization before providing items.

## Variants, density and responsive behavior

Expanded, icon rail, hidden and drawer content. Icons retain complete accessible names in rail. Long labels truncate visually. Coarse-pointer targets have 44px floor. Semantic surface, border, typography and spacing tokens own appearance.

## Accessibility and states

Named navigation, aria-current page, button keyboard activation, visible focus and complete labels. Drawer modality, Escape, Back and focus restoration belong to Sheet through VUI.

## Current usages and ownership

AppSidebar provides workspace destinations and owner-only God Mode footer. GodModePage provides Management and Instance destinations. Design-system pattern owns appearance; consumers own routing and persistence.

## Acceptance evidence

See accepted tasks and proof (private historical record). Acceptance requires production desktop/320px navigation, collapse/reload, drawer dismissal and focus restoration.

## Implementation

Import `SidebarNavigation` from `@design-system/patterns/sidebar-navigation.tsx`. Styles live beside component. Stories: `stories/patterns/shell/shell.stories.tsx`. Component contract tests: `src/design-system/patterns/shell.test.tsx`.
