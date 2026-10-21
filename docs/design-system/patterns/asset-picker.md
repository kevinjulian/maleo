# AssetPicker

**Status:** Candidate, not built (OpenSpec audit-ui-system task 10.6). The only confirm-and-cancel picker in the app is the preset modal; one consumer is not a pattern. Build it when a second picker with the same commitment semantics exists. Examples are semantic pseudocode, not promises of current exports or prop types.

## Purpose

Let a user choose assets for a specified task with clear selection and commitment.

## Use when

- Choosing a reference image, material, voice or other allowed asset for an editor operation.

## Do not use for

- General collection management
- editing an asset
- silently copying global assets into project scope.

## Structure

```text
AssetPicker
├── PanelHeader
├── Query / ScopeControls
├── MediaGrid or reviewed asset list
└── SelectionSummary + Confirm / Cancel
```

## Allowed controls and composition

- Dialog/Popover through the existing lifecycle
- Input/Select
- MediaGrid/MediaCard
- Button
- request-state patterns.

## Rules

- State what is being chosen and whether selection is single or multiple.
- Keep global Library and project-local scope explicit; feature owns copy/reference policy.
- Make confirm/cancel semantics explicit; immediate selection is a separately reviewed mode.
- Show incompatible/unavailable items truthfully; do not silently select them.
- Keep dismissal/focus return with the overlay owner; do not build local document listeners.

## Variants, density and responsive behavior

Single-select or multi-select; modal/sheet or anchored picker. Asset-kind differences affect presentation, not commitment semantics. Use [foundation roles](../foundations.md#target-grammar), not feature-local visual values.

## Accessibility and states

Loading, filtering/no-results, selected, failed, committing and unavailable asset. Cancel does not commit a draft selection. Controls keep their accessible behavior when composed; color/hover alone cannot carry essential meaning. Values and allowed actions come from the feature; this pattern does not own IO or authority.

## Examples

Good — preserves intent and the owned composition:

```tsx
<AssetPicker
	title="Choose reference image"
	selected={draft}
	onConfirm={confirm}
	onCancel={cancel}
/>
```

Bad — bypasses the semantic or behavior contract:

```tsx
<div onClick={() => copyAndSelectGlobalAsset(asset)}>Pick</div>
```

## Current usages and ownership

[Current usage family and screen evidence](../patterns.md#references-mentions-and-entity-pickers); [complete consumer inventory](../components.md). Target owner: `apps/web/src/design-system/patterns/asset-picker/` if a shared implementation is justified; no target directory/API was created. Feature/VUI behavior owners remain as specified in [principles.md](../principles.md).

- [PresetPickerModal](../../../apps/web/src/components/editor/preset-picker.tsx) — current source candidate at line 22; not proof of target-pattern compliance.
- [ReferenceImage](../../../apps/web/src/components/catalog/references-library.tsx) — current source candidate at line 41; not proof of target-pattern compliance.

## Acceptance evidence

Check reference/material/voice flows, filter selection persistence, cancel/confirm, scope/permission changes and nested overlay keyboard behavior. Test relevant theme, narrow/desktop, keyboard, disabled/busy/error and coarse-pointer states before approval. Source/screenshot presence alone does not approve this specification or implementation. Record proof, exceptions and review in OpenSpec (private historical record), not a local task checklist.
