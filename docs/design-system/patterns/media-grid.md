# MediaGrid

**Status:** Implemented and in production (OpenSpec audit-ui-system task 10.3, done): the image gallery, the reference library, the editor's media browser and stock results. Earlier sections are the intent; [Implementation](#implementation) records the shipped contract where it is more specific.

## Purpose

Lay out a media collection with predictable responsive geometry and collection states.

## Use when

- Image/video/reference asset browsing with repeated MediaCard items.

## Do not use for

- Timeline tracks
- heterogeneous dashboard panels
- data tables that need columns and row relationships.

## Structure

```text
MediaGrid
├── Optional CollectionSummary
├── MediaCard items
└── Optional Paging / LoadMore
```

## Allowed controls and composition

- MediaCard
- existing pagination controls
- EmptyState/ErrorState/LoadingState as collection replacements.

## Rules

- Use one reviewed gap and card-size recipe; features do not invent grid geometry per route.
- Reflow by available region width; preserve DOM reading order and media aspect.
- Keep selection identity stable through sorting, filtering and pagination.
- Do not assign grid role unless its complete interaction model exists; CSS grid can use normal list semantics.
- Feature owns fetching and virtualization policy; pattern displays supplied items and states.

## Variants, density and responsive behavior

Comfortable/compact collection density and narrow single-column reflow. Virtualized implementations retain the same semantic contract. Use [foundation roles](../foundations.md#target-grammar), not feature-local visual values.

## Accessibility and states

Initial loading, populated, empty, filtered-empty, failed and incremental loading. Preserve already loaded items during pagination failure. Controls keep their accessible behavior when composed; color/hover alone cannot carry essential meaning. Values and allowed actions come from the feature; this pattern does not own IO or authority.

## Examples

Good — preserves intent and the owned composition:

```tsx
<MediaGrid>
	<MediaCard asset={first} />
	<MediaCard asset={second} />
</MediaGrid>
```

Bad — bypasses the semantic or behavior contract:

```tsx
<div className="grid grid-cols-5 gap-[7px]">{assets.map(renderLocalCard)}</div>
```

## Implementation

`MediaGrid` in [media.tsx](../../../apps/web/src/design-system/patterns/media.tsx).

```tsx
<MediaGrid label="Generated images">{items.map((item) => <MediaCard key={item.id} … />)}</MediaGrid>
<MediaGrid label="Stock results" min={72} density="compact">…</MediaGrid>
```

- A named list (`role="list"`), not `role="grid"`: there is no cell-to-cell keyboard model, so none is claimed. Cards are list items in DOM order.
- `min` is the narrowest a column may get (default 150px; 72 for a rail panel). Columns fill the region; the floor is capped at 45% of the grid's width, so a phone keeps two columns.
- `density="compact"` tightens the gap and the overlay caption.
- It renders what it is given. Loading, empty and failed are the collection states (LoadingState, EmptyState, ErrorState) the feature shows instead of the grid; there is no paging or load-more slot yet, because the galleries load one page.
- Audio MediaCard list records may sit in a tile grid: they span its columns while retaining original DOM order among image/video tiles. Native playback controls use the card action slot.
- `layout="list"` presents thumbnail-led MediaCard records in one column; default `grid` keeps responsive tile columns. Both retain named list semantics, existing density and keyboard/touch activation. Projects uses this reviewed variant for view switching without changing record identity.

## Current usages and ownership

[Current usage family and screen evidence](../patterns.md#library-collection-rows-and-cards); [complete consumer inventory](../components.md). Owner: `apps/web/src/design-system/patterns/media.tsx`. Feature/VUI behavior owners remain as specified in [principles.md](../principles.md).

- [ReferenceImage](../../../apps/web/src/components/catalog/references-library.tsx) — current source candidate at line 41; not proof of target-pattern compliance.
- [Frame](../../../apps/web/src/design-system/components/frame.tsx) — current source candidate at line 37; not proof of target-pattern compliance.

## Acceptance evidence

Check sparse/large collections, long metadata, filters, paging failure, keyboard selection and 320px region containment. Test relevant theme, narrow/desktop, keyboard, disabled/busy/error and coarse-pointer states before approval. Source/screenshot presence alone does not approve this specification or implementation. Record proof, exceptions and review in OpenSpec (private historical record), not a local task checklist.

### Compact element picker tiles

`MediaCard variant="picker"` inside `MediaGrid min={72} density="compact"` presents a square preview tile without a border, caption or subtitle. Names remain in accessible activation labels and hover hints. Tiles retain the 44px target floor; the grid fits compact columns to the available panel width. Hover, selected state and keyboard focus remain owned by MediaCard; the feature provides renderer thumbnails, activation, drag data and context actions. Built-in Elements tools and saved CustomTemplatesBlock use this variant; Library keeps its browse presentation. Story: `Patterns/Media/ElementPickerTiles`. Browser proof: `visual/basic-elements.spec.ts`.
