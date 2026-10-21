# PanelHeader

**Status:** Implemented and in production (OpenSpec audit-ui-system task 4.8, done). Earlier sections are the intent; [Implementation](#implementation) records the shipped contract.

## Purpose

Identify a panel and place its contextual state, actions and close control consistently.

## Use when

- Inspector rails, asset panels and editor sheets with a distinct named region.

## Do not use for

- Page hero headings
- repeated headings inside every property row
- route navigation.

## Structure

```text
PanelHeader
├── Title + optional Status
├── Optional ContextActions
└── Optional CloseAction
```

## Allowed controls and composition

- Heading/text recipe
- Badge
- Button/IconButton
- DropdownMenu for contextual overflow.

## Rules

- Title identifies the region; panel content is associated with that title.
- Close is explicitly named and distinct from destructive delete.
- Use the shared header height/padding recipe; do not duplicate title/actions/close layout in feature CSS.
- Keep primary context visible; overflow secondary actions at narrow widths.
- Sheet/modal dismissal and focus return stay with the overlay controller (`controllers/overlay`).

## Variants, density and responsive behavior

Persistent rail has no close unless closable; dismissible sheet has close. Status/actions are optional slots, not separate headers. Use [foundation roles](../foundations.md#target-grammar), not feature-local visual values.

## Accessibility and states

Normal, busy contextual action, unavailable action and narrow/overflow. Long titles truncate visually without losing their full accessible name. Controls keep their accessible behavior when composed; color/hover alone cannot carry essential meaning. Values and allowed actions come from the feature; this pattern does not own IO or authority.

## Examples

Good — preserves intent and the owned composition:

```tsx
<PanelHeader title="Inspector" actions={<IconButton label="More inspector actions" />} />
```

Bad — bypasses the semantic or behavior contract:

```tsx
<div style={{ padding: "7px 13px" }}>
	Inspector<button>×</button>
</div>
```

## Implementation

`PanelHeader` in [panel-header.tsx](../../../apps/web/src/design-system/patterns/panel-header.tsx), styled by [panel-header.css](../../../apps/web/src/design-system/patterns/panel-header.css); stories under `Patterns/PanelHeader`.

```tsx
<PanelHeader title="Captions" onClose={onClose} closeLabel="Hide panel" />
<PanelHeader title="Audit" actions={<IconButton size="xs" title="Refresh" … />} onClose={onClose} closeLabel="Close audit" />
<PanelHeader density="compact" title={subject} sub="Transform properties" actions={…} onClose={phone ? close : undefined} />
```

- `title` (an `h2`, so the region is reachable by heading navigation), optional `sub` (a second line), optional `actions`, optional `onClose` with `closeLabel`, `density`.
- `panel` (default): the Panel title role on `--topbar-h`, so a rail panel's header shares a line with the top bar. For rail panels and sheets.
- `compact`: the Section title role on `--control-h`. For the inspector column and popovers.
- `tool`: editor tool destinations. Above 860px, a 44px row using `--control-h-touch`, tighter token padding, body-size normal-weight title and dim foreground. At phone widths it retains the default panel title and close control; canonical coarse-pointer targets remain at least 44px. Use this density instead of feature title overrides.
- Close is an `IconButton size="xs"`, always last, named by `closeLabel`: "Hide panel" for a rail panel that reopens from its rail button, "Close" otherwise. Omit `onClose` where the panel cannot be closed (the docked inspector).
- Long titles ellipsize; the heading keeps its full text.
- A caller may hide the header where its context already names the panel (`[data-slot="panel-header"]` in an inline or phone-chat host) and may tint its ground; it does not restyle the title or the actions.

Not migrated, on semantics: the scene drawer's header (its title is an editable name field), the motion studio's layer header (a layer name beside Delete), `SceneCast`'s heading (a section heading with a count and a text action inside a panel), the storyboard section and beat heads, the page header and the app top bars.

## Current usages and ownership

[Current usage family and screen evidence](../patterns.md#page-and-library-headers); [complete consumer inventory](../components.md). Target owner: `apps/web/src/design-system/patterns/panel-header/` if a shared implementation is justified; no target directory/API was created. Feature/VUI behavior owners remain as specified in [principles.md](../principles.md).

- [Panel](../../../apps/web/src/design-system/components/panel.tsx) — current source candidate at line 40; not proof of target-pattern compliance.
- [LibraryHeader](../../../apps/web/src/components/catalog/library-chrome.tsx) — current source candidate at line 29; not proof of target-pattern compliance.

## Acceptance evidence

Review all 16 audited header declarations; verify heading association, close name/focus return, long names and phone sheets. Test relevant theme, narrow/desktop, keyboard, disabled/busy/error and coarse-pointer states before approval. Source/screenshot presence alone does not approve this specification or implementation. Record proof, exceptions and review in OpenSpec (private historical record), not a local task checklist.
