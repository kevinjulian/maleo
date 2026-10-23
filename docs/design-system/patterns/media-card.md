# MediaCard

**Status:** Implemented and in production (OpenSpec audit-ui-system task 10.3, done): the image gallery, the reference library, the editor's media browser and stock results. Earlier sections are the intent; [Implementation](#implementation) records the shipped contract where it is more specific.

## Purpose

Present one asset with consistent preview, metadata and relevant actions.

## Use when

- Library or project image/video/audio items that can be previewed, selected or acted on.
- Thumbnail-led project records that open their authored media workspace. Record metadata belongs in `meta`; opening remains the single activation.
- Export attempt records in a media history collection. Unfinished or failed attempts use an explicit unavailable preview, execution status and progress or cause; they never imply playable output. Full generation diagnostics and recovery stay in details.

## Do not use for

- Generation run summaries
- free-form editorial cards
- whole asset-selection dialogs.

## Structure

```text
MediaCard
├── MediaPreview
├── Title + Metadata
└── Optional Selection / ContextActions
```

## Allowed controls and composition

- Existing Frame/media preview contract
- Badge
- Button/IconButton
- DropdownMenu
- Checkbox for explicit multi-selection.
- Progress for measured export work in metadata; Spinner for an in-progress unavailable preview.

## Rules

- Preserve media aspect/geometry and use owned preview/letterbox behavior.
- Card activation has one primary meaning; separate preview, selection and menu actions.
- Do not nest interactive controls inside a whole-card button.
- Actions remain discoverable with keyboard and touch, not hover only.
- Share chrome tokens; media/user colors remain content data.

## Variants, density and responsive behavior

Image, video and audio previews; selectable or browse-only. Domain metadata changes through slots without replacing card hierarchy. Use [foundation roles](../foundations.md#target-grammar), not feature-local visual values.

## Accessibility and states

Preview loading, unavailable media, selected, disabled action and playback state. Media failure does not imply the collection is empty. Controls keep their accessible behavior when composed; color/hover alone cannot carry essential meaning. Values and allowed actions come from the feature; this pattern does not own IO or authority.

## Examples

Good — preserves intent and the owned composition:

```tsx
<MediaCard asset={presentation} actions={<IconButton label="More asset actions" />} />
```

Bad — bypasses the semantic or behavior contract:

```tsx
<button onClick={select}>
	<video />
	<button onClick={remove}>Delete</button>
</button>
```

## Implementation

`MediaCard` in [media.tsx](../../../apps/web/src/design-system/patterns/media.tsx), styled by [media.css](../../../apps/web/src/design-system/patterns/media.css); stories under `Patterns/Media`.

```tsx
<MediaCard preview={<img … />} caption="overlay" title={attribution} label={`Image, ${attribution}`}
  selected={id === selected} onActivate={toggle} unavailable={missing ? "Image unavailable" : undefined}
  overlay={<FrameBadge corner="tr">…</FrameBadge>} />
<MediaCard draggable hint="Drag onto the timeline" preview={<video … />}
  actions={<FrameActions corner="tl" reveal><FrameAction title="Add without placing" … /></FrameActions>} />
```

- `preview` is the caller's `<img>`, `<video>` or Frame; the card owns the box: `aspect` (default 1), `fit` (`cover`, or `contain` where a crop would hide what the asset is) and an optional `ground` colour.
- `layout="list"` is the reviewed thumbnail-led record variant: fixed thumbnail beside wrapping metadata and an ellipsized title. It forces below-preview captions into adjacent copy; activation, unavailable state and list semantics stay identical. `actions` sit at the row end and wrap under the copy only when the row is too narrow for both. `MediaGrid layout="list"` supplies one column. The default grid layout keeps its preview/caption arrangement.
- `meta` is a wrapping row of facts in both layouts: pass each fact (a status Chip, a date, a length) as its own child, and the card spaces them. A child that is full width — a Progress for a running job, a one-line cause — takes its own line. Features do not wrap meta in a local flex class.
- `unavailableIcon` names what kind of item has no preview (a film, a text glyph, a Spinner for work still in progress). Without it the card shows the image glyph. The glyph shows in both layouts.
- One activation: `onActivate` makes the card's body a real button. Without it the body is a plain element and the card is browse-only.
- `actions` are rendered beside that button, never inside it: FrameActions, a menu, attribution links. Use the top corners; hover-revealed actions also show on focus and touch.
- `overlay` holds FrameBadges, the non-interactive facts (duration, kind, favourite).
- `title` and `meta` sit under the preview, or `caption="overlay"` lays the title over its foot for small tiles. `label` names the activation where the visible title is not enough.
- `selected` given (true or false) makes it a selectable: `aria-pressed`, and the selection ring.
- `unavailable` replaces the preview with a named placeholder. The item stays in the collection.
- Remaining props go to the `<li>`: `draggable`, drag and pointer handlers, context menu. `hint` is the card's pointer tooltip.
- Also used by the editor's project reference and product cards, whose Select and Cast controls are the card's `actions`. Material assets are not consumers: they are list rows (a thumbnail beside text), not tiles. Explicit `selection={{ label, checked, onCheckedChange, disabled? }}` renders canonical Checkbox beside preview activation and actions. It owns selection chrome/placement only; feature owns selected IDs, pruning and bulk behavior. Preview activation remains independent and does not announce aria-pressed when explicit selection is present. Grid/list both preserve keyboard/touch targets; selection shares a wrapping footer with inline actions; duration badges remain read-only preview facts. Native playback remains feature-owned.

### Pending media

A file chosen for import is an asset before its upload finishes (OpenSpec `use-media-while-uploading` D7). Its card is the ordinary asset card in Ready to place or In use, with the state composed into the existing slots, never a second card for the same file:

| State                                                           | `overlay`                                               | `meta` / list status                 | `actions` (beside the activation)                  |
| --------------------------------------------------------------- | ------------------------------------------------------- | ------------------------------------ | -------------------------------------------------- |
| Uploading                                                       | determinate `Progress` at the preview foot, `hideLabel` | `Uploading N%`                       | Cancel                                             |
| Processing (after the last byte, and while the server converts) | indeterminate `Progress`                                | `Processing`                         | Cancel                                             |
| Failed                                                          | warning `FrameBadge`                                    | the reason, `role="alert"`           | Retry (file still held), Choose file again, Delete |
| Interrupted (no file to resume after a reload)                  | warning `FrameBadge`                                    | `Interrupted: choose the file again` | Choose file again, Delete                          |

- The card stays draggable and placeable while uploading or processing when its length is known; a length the browser could not read is the card's `unavailable` reason until processing provides it. A file the browser cannot decode shows `Preview after processing` in the preview box.
- The card's accessible label carries the state (`beach.mov, Uploading 40%`), so the state is not colour or motion alone. The progress bar is named the same way.
- Delete on a used pending asset removes its clips too, as one undo step; the feature owns that rule.
- The state comes from the import session, keyed by the asset id (the import request key); the card neither polls nor owns IO.
- Files with no asset yet (source replacement waiting for its ready file, a server import restored without a pending asset) keep the `UploadCard` under Uploading, with the same states and action names.

Story: `Patterns/Media/Pending media`, at desktop and 320px in both themes.

## Current usages and ownership

[Current usage family and screen evidence](../patterns.md#media-frames-and-previews); [complete consumer inventory](../components.md). Owner: `apps/web/src/design-system/patterns/media.tsx`. Feature/VUI behavior owners remain as specified in [principles.md](../principles.md).

- [Frame](../../../apps/web/src/design-system/components/frame.tsx) — current source candidate at line 37; not proof of target-pattern compliance.
- [ReferenceImage](../../../apps/web/src/components/catalog/references-library.tsx) — current source candidate at line 41; not proof of target-pattern compliance.

## Acceptance evidence

Check each media kind, broken/slow previews, selection versus enlargement, menu focus and touch access in actual Library/project collections. Test relevant theme, narrow/desktop, keyboard, disabled/busy/error and coarse-pointer states before approval. Source/screenshot presence alone does not approve this specification or implementation. Record proof, exceptions and review in OpenSpec (private historical record), not a local task checklist.

Explicit selection and ordinary action controls share a wrapping footer beside the preview activation. Selectable cards use inline Toolbar actions rather than positioned FrameActions; selection and actions must remain distinct hit targets at 320px on coarse pointers. Read-only badges stay on the preview.

### Compact element picker tiles

`MediaCard variant="picker"` inside `MediaGrid min={72} density="compact"` presents a square preview tile without a border, caption or subtitle. Names remain in accessible activation labels and hover hints. Tiles retain the 44px target floor; the grid fits compact columns to the available panel width. Hover, selected state and keyboard focus remain owned by MediaCard; the feature provides renderer thumbnails, activation, drag data and context actions. Built-in Elements tools and saved CustomTemplatesBlock use this variant; Library keeps its browse presentation. Story: `Patterns/Media/ElementPickerTiles`. Browser proof: `visual/basic-elements.spec.ts`.

Catalogue thumbnail players loop automatically with muted playback and no shared audio tags. TextPresetPreview shares reduced-motion handling through usePreviewFrame: an explicit still or reduced-motion preference shows frame 45; a live preference change remounts the player at that arrived frame. Static basic elements remain static. Playback proof covers built-in and saved items in tools and Library at desktop and 320px in `visual/catalogue-autoplay.spec.ts`.
