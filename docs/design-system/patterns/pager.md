# Pager

**Status:** Implemented and in production (OpenSpec unify-video-export-experience task 7.4). Earlier sections are the intent; [Implementation](#implementation) records the shipped contract.

## Purpose

Move a server-paged collection to its previous or next page, and say which rows are shown.

## Use when

- A collection is read one page at a time from the server: Projects, Video exports.

## Do not use for

- Client-side lists that render every row
- Infinite scroll
- Step-by-step flows (a wizard's Back and Continue)
- Timeline or media navigation.

## Structure

```text
Pager (nav, named)
├── Range       "61–66 of 66"
└── Actions
    ├── Previous
    ├── Optional Position   "Page 2 of 2"
    └── Next
```

## Allowed controls and composition

- Two secondary small Buttons with chevron glyphs
- Caption-role text for range and position.

## Rules

- Place it under the collection rows, after any inline error.
- Hidden when there is neither a previous nor a next page.
- Both directions are disabled while a page loads; the rows on screen stay.
- The feature owns the offset, the page size and the URL; the Pager only reports intent.
- Show the position only when the feature knows the page count. Do not invent one.

## Variants, density and responsive behavior

One variant. Range at the start and actions at the end; on a narrow screen the actions wrap under the range. Use [foundation roles](../foundations.md#target-grammar), not feature-local visual values.

## Accessibility and states

A `nav` landmark with the feature's label ("Project pages", "Export pages"), so two pagers on one screen stay distinct. Buttons keep their names ("Previous", "Next"); a disabled direction is a disabled button, not a hidden one. Busy disables both. Range and position use tabular numerals.

## Examples

Good:

```tsx
<Pager
	label="Export pages"
	range={{ start: 61, end: 66, total: 66 }}
	hasPrevious
	hasNext={false}
	busy={loading}
	onPrevious={previous}
	onNext={next}
/>
```

Bad — a hand-written row of buttons with its own label and count format:

```tsx
<Toolbar>
	<Button>Prev</Button>
	<span>Page 2</span>
	<Button>Next</Button>
</Toolbar>
```

## Implementation

`Pager` in [collection.tsx](../../../apps/web/src/design-system/patterns/collection.tsx): `label`, `range { start, end, total }`, optional `page { current, count }`, `hasPrevious`, `hasNext`, optional `busy`, `onPrevious`, `onNext`. It returns `null` when there is nowhere to go. Styles are `.collection-pager*` in `app/styles/controls.css`, beside the other collection states. Story: `Patterns/Pager`.

## Current usages and ownership

- Projects (`pages/content.tsx`), with page position.
- Video exports (`pages/video.tsx`), range only: the server returns `has_more`, not a page count.
- `components/admin/god-pager.tsx` still draws its own; it moves to Pager when the God Mode surfaces are restyled.

## Acceptance evidence

`collection.test.tsx` covers hidden, range/position and busy states. `visual/projects-inventory.spec.ts` and `visual/video-exports.spec.ts` page forward through the real screens at desktop and 320px in both themes.
