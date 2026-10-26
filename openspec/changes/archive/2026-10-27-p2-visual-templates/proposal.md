# Proposal

## Why

The editor should supply basic building blocks while users create reusable motion themselves. Removing the stock visual-preset library reduces the remaining Rust migration to plain text, five shapes and user-authored layer compositions.

## What Changes

- Expose exactly three element groups: **Text**, **Shapes** and **Motion**. Text supplies plain text. Shapes supplies Circle, Rectangle, Triangle, Star and Cross. Motion contains user-created compositions only, with an empty state until users save one.
- Add Triangle, a five-point Star and a plus-sign Cross to the existing Circle/Rectangle controls and placement path. Preserve fill, stroke, transforms, opacity, timing and supported keyframes.
- Reuse the saved composition layer format as a versioned declarative definition over these primitives. Reuse existing motion authoring, save, edit, place and delete flows.
- Interpret the same primitive and composition data in Remotion and Rust, with parity cases for geometry, styles, layering, timing and animation.
- **BREAKING**: remove built-in styled text presets, animated cards, titles, intros/outros and logo/motion templates. Remove their catalogue entries, forms, defaults and renderer branches.
- **BREAKING**: migrate project clips by deleting retired-preset clips without ripple. Remove retired layers inside placed compositions and saved user templates. Delete saved templates left empty, including custom variants whose only base is retired. Preserve surviving content and timing.
- Prevent retired content from returning through old snapshots, stale clients, agent output, imports or fixture bootstrap. New generation emits supported primitives instead of retired presets.
- Preserve camera motion, transitions, effects, captions, media clips and video-level template policy. These are distinct from the retired element presets.

## Capabilities

### New Capabilities

- `visual-templates`: versioned primitive/composition data, user-authored motion lifecycle, destructive retired-preset cleanup and supported generation output.

### Modified Capabilities

- `timeline-elements-menu`: exactly three groups, five shapes, user-only Motion, shared library/rail definitions and shape-specific inspection.
- `engine-renderer`: draw the five primitive shapes and user compositions from the shared render input.
- `timeline-template-fields`: titling selections resolve only to supported plain text or no title, with retired choices removed.

The AI-planning capability `executable-template-definitions` remains separate. Existing renderer-parity gates apply to this change's new support.

## Impact

- `packages/shared`: primitive IDs/geometry, composition schema/version, retirement transforms, render mapping, generation and title defaults.
- `crates/renderer` and `crates/renderer-wasm`: shape paths, composition timing/layer interpretation, input-derived coverage and golden fixtures.
- `apps/web`: Elements and Library catalogues, inspector, Motion Studio/custom composition flows, template previews and legacy-default removal.
- `apps/api`, `packages/db`: template validation/storage, project migration through authoritative persistence and command-log boundaries, restore/save guards and producer updates.
- `packages/video`: basic primitive/composition interpreter and deletion of retired preset renderers. Remotion remains normal preview/export; Rust remains compare-only.
- Migration and regression tests, synthetic corpus, owning docs and changelog. Migration deletes content, not underlying media assets.
- No new external dependencies, general template scripting language, renderer cutover, video decoder or export encoder.
