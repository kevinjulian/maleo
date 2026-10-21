# Storybook

Storybook renders `@maleo/web` components with the real app stylesheet,
tokens, fonts, and theme. `docs/design-system/` is the specification; stories
show what the code currently renders.

```bash
bun run --cwd apps/web storybook        # dev server on :6006
bun run --cwd apps/web build-storybook  # static build to apps/web/storybook-static
```

Stories that mount the editor need the engine's WASM: run
`bun scripts/editor-engine.mts build` first on a fresh checkout.

## Where stories go

Stories live here, not beside components, so the `src/` layer checks keep
seeing only app code. Each top-level folder is one sidebar section:

| Folder         | Title prefix   | Holds                                                 |
| -------------- | -------------- | ----------------------------------------------------- |
| `foundations/` | `Foundations/` | tokens, type, color, spacing, motion                  |
| `components/`  | `Components/`  | one file per `src/design-system/components` primitive |
| `patterns/`    | `Patterns/`    | compositions from `docs/design-system/patterns/`      |

## Naming

- File: kebab-case component name, `button.stories.tsx`.
- Title: `<Section>/<Component>` in Title Case, `Components/Button`.
- Story exports: PascalCase states that exist in the component's props
  (`Default`, `Disabled`, `Small`). Do not add variants a component lacks.
- Import components through the app aliases (`@design-system/components/button.tsx`).
- A helper a folder's stories share (the inspector width frame in
  `patterns/inspector/inspector-frame.tsx`, the inline image/audio fixtures in
  `components/media-fixture.ts`) is a plain module beside them; only
  `*.stories.tsx` files are stories. Stories never fetch: media is a data URI.
- Never import a feature stylesheet into a story. A primitive that renders
  bare in isolation is styled in the wrong place; move its rules beside it.
- Overlays (`Modal`, `Menu`) portal to `document.body`; show the open state
  directly or with a `play` function.

`.storybook/preview.tsx` loads `src/app/styles.css` and adds a Theme toolbar
that toggles the `dark` class on `<html>`, the same switch the app uses.
