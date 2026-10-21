# Maleo UI principles and target architecture

Documented target direction, 2026-10-01. Application implementation remains unchanged. Current authoring authority is [apps/web/DESIGN.md](../../apps/web/DESIGN.md); [foundations.md](foundations.md) defines the target visual vocabulary. OpenSpec audit-ui-system (private historical record) owns pending work and proof. This reference describes the intended boundary, not today's folder layout.

## Principles

1. Small vocabulary. Choose named surfaces, text, borders, spacing and full typography recipes. Preserve the existing neutral direction; variation needs a semantic reason.
2. Standardize actual usages. A toolbar owns grouping, density, overflow and action hierarchy. A consistent Button alone cannot provide that contract.
3. Reuse existing behavior. Base UI supplies interaction primitives where needed; shadcn supplies adapted recipes, not a competing runtime layer. Native form controls remain valid behind shared components where their contract fits.
4. Patterns describe a user task. Property rows edit named values; media cards preview/select assets; generation cards communicate run state and available actions. Domain state and IO remain with features.
5. States remain truthful. Loading, empty, filtered-empty, failure and populated differ. Selection, hover and focus differ. Disabled and busy need behavior as well as paint.
6. Verify before approval. Source evidence, real screens, keyboard/state checks and theme/density proof precede kit publication. Inventory candidates are not approved components.

## Component versus pattern

| Kind      | Unit of reuse                             | Owns                                                                                | Examples                                              |
| --------- | ----------------------------------------- | ----------------------------------------------------------------------------------- | ----------------------------------------------------- |
| Component | A control or small presentation primitive | Accessible behavior, supported variants, token-backed appearance                    | Button, Input, Popover, Badge                         |
| Pattern   | A Maleo task composition                  | Hierarchy, placement, grouping, density, responsive behavior and state presentation | PropertyRow, Toolbar, GenerationCard                  |
| Feature   | A domain workflow                         | Data, IO, permissions, commands and orchestration                                   | Project generation, timeline editing, asset selection |

A pattern may be implemented by React components or documented recipes. The distinction is its semantic contract, not JSX size, file name or count of children. The source inventory calls JSX definitions “components”; that implementation census does not classify every definition as a design-system primitive.

### Canonical components

Components are built only from [Foundations](foundations.md#target-grammar); patterns are built only from components. Dependency runs one way: Foundations → Components → Patterns → Features.

A component is **canonical** when all of these hold: semantic colour tokens only; a typography role, never a bare size; the spacing scale; the standard control heights (xs 24 / sm 32 / md 40) with a touch floor under a coarse pointer; the radius roles (sm controls, md floating, full pills); the border roles; hover, focus, pointer-down and disabled states defined; variants that each name a purpose; Storybook stories showing the variants and states; and no arbitrary styling — no legacy class another sheet paints and no one-off value.

| Group                  | Canonical components (`apps/web/src/design-system/components/`)                                                                                                                                                                                      |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Actions                | Button (`primary` · `secondary` · `ghost` · `danger`; `sm` / `md`; `loading` announces `aria-busy`, shows a Spinner and keeps focus), IconButton (`micro` / `xs` / `sm` / `md`; `on` toggles with `aria-pressed`)                                    |
| Forms                  | Input, Textarea, Select (one field recipe, `field-recipe.ts`: `xs` editor field / `sm` / `md`), SearchField (glyph, query and one clear control in one box; Escape clears and keeps focus), NumberField, Checkbox, Switch, Slider, Field, FieldLabel |
| Navigation / selection | Tabs (`outline` in a page, `segmented` for a mode switch in chrome), ToggleGroup, Toggle                                                                                                                                                             |
| Overlays               | Popover, Menu, ContextMenu, Tooltip (a supplemental hint on hover and keyboard focus; never the control's name, and used instead of a `title`, not with one), Modal (Dialog), Sheet — Modal/Sheet lifecycle stays with `@maleo/vui/dom`              |
| Media                  | Lightbox (a dark surface in both themes, so its chrome is the canonical IconButton), Frame, AudioPreview (IconButton + Slider + timecode)                                                                                                            |
| Feedback               | Chip (badge `tag` with tones; filter `inline`; ChipButton), Note, Callout, Spinner, Progress                                                                                                                                                         |
| Identity               | Avatar (initials on a fill: `circle` on ink for a person, `square` on its own colour under `--on-identity` for a workspace; `sm` / `md`)                                                                                                             |
| Structure              | Separator                                                                                                                                                                                                                                            |

Selection reads one way everywhere: a pressed or selected control (IconButton `on`, ChipButton `on`, Toggle, ToggleGroup item, Tabs) uses the accent wash and accent ink. AlphaColorControl's picker is the canonical Popover. Not built, on evidence: ScrollArea (native scroll only). The 217 native `title` attributes move to Tooltip as their surfaces migrate. Storybook `Components/Overview` shows this status; agents compose these components and never restyle them in feature CSS — contextual rules may only lay them out, selecting `[data-slot]`.

### Target pattern vocabulary

| Family                | Patterns                                            | Shared semantic contract                                                                                                                                                                                 |
| --------------------- | --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Properties and panels | PropertyRow, InspectorSection, PanelHeader          | Named value/control/hint/error/reset; grouping/disclosure; region title/state/actions/close                                                                                                              |
| Toolbars              | Toolbar, ToolbarGroup, ToolbarAction                | Action hierarchy, grouping, separators, density, overflow, keyboard access and narrow reflow                                                                                                             |
| Assets                | MediaCard, MediaGrid, AssetPicker                   | Preview and metadata hierarchy, selection, responsive collection and choose/confirm/cancel flow                                                                                                          |
| Request states        | EmptyState, ErrorState, LoadingState                | Distinguish no data, filtered-empty, failure and pending work; meaningful recovery/progress                                                                                                              |
| Generation            | GenerationCard, GenerationProgress, GenerationError | Run identity, stage/progress/output/failure and allowed actions; feature supplies authority and commands                                                                                                 |
| Chat                  | ChatMessage, ToolCall, PromptComposer               | Speaker/content hierarchy, tool lifecycle disclosure, compose/submit/newline/IME/attachments                                                                                                             |
| Timeline              | TimelineTrack, TimelineClip, TransportControls      | Lane/clip hierarchy, selection/state/action placement, playback/timecode controls; preserve the editor workspace's geometry and gesture contracts (`controllers/surface`, `components/editor-workspace`) |

Reuse existing implementations where they meet these roles. EmptyState is semantically a pattern even though its current source lives under shared UI. Timeline pattern contracts describe compositions over public VUI APIs, not a request to duplicate its editor engine. The full list is a classification vocabulary; create an implementation only when current usages justify it.

### Agent composition rule

**Agents may freely compose approved components within the approved pattern’s extension points. They must preserve the pattern contract and must not casually invent a parallel PropertyRow, Toolbar or state layout.**

For example, a PropertyRow can contain Input, Select, Slider, Checkbox or a reviewed compound control. Its label association, value/control alignment, hint/error/reset placement, density and keyboard contract remain consistent. An agent can supply domain-specific controls and actions; it cannot copy row CSS, change label hierarchy or bypass the recipe to fit one inspector. A ToolbarAction expresses command placement/priority; IconButton remains the control that executes it.

“Approved” requires recorded review of the semantic contract and representative usages/states, linked from the owning OpenSpec scope. Presence in this target list, source inventory or screenshot does not approve an API. Until approval, reuse the current canonical implementation and record gaps instead of declaring a new approved pattern.

When a composition does not fit: locate the closest existing pattern and usages; explain the semantic mismatch; propose a supported variant or NEW_PATTERN with concrete consumers and state evidence; review its contract before migration. Prefer extending a matching pattern over creating a competing layout. Composition freedom covers content and supported controls, not replacement of structure, accessibility or state semantics.

The [pattern specification index](patterns.md#pattern-intent-specifications) links an intent specification for every named target pattern. These are proposed contracts with illustrative examples, not implemented APIs. Each reviewed pattern reference must state purpose, applicable/non-applicable usages, slots and permitted composition, variants/density, responsive behavior, accessibility/state contract, owning implementation, and representative evidence. Review/approval and unresolved work stay in OpenSpec; these documents are references, not another status tracker.

## Layout

Within `apps/web/src/`:

```text
design-system/
  tokens/        tokens.css: the one token sheet
  icons/         the Ic registry and the ICON size scale
  components/    canonical components, one module each
  patterns/      inspector (InspectorSection, PropertyRow), collection (EmptyState)
components/      feature UI, clustered by domain
app/  pages/  hooks/  stores/  api/  models/
```

Imported as `@design-system/*`. `check:layers` enforces the boundary: the design system sits below `components/` and `pages/` and cannot import them or `stores/`; inside it tokens and icons are leaves, components build on them and patterns build on components; and `@base-ui/react` is imported only from `design-system/`. There is no compatibility re-export from the old `components/ui/` path.

Not done, deliberately: `tokens.css` is not split into colour, type, spacing and motion sheets (the dark block's override order makes that a cascade change, not a move), and components are flat modules rather than a directory each. Feature directories keep their existing `components/<domain>/` shape; there is no `features/` tree. A control that needs a domain model to render (ImageProviderSelect) lives with its domain and composes design-system components.

Documentation entry points are `principles.md`, `foundations.md`, `patterns.md`, `components.md` and `audit.md` in this directory. Pending architecture choices and migration tasks stay in OpenSpec.

## Dependency direction

```text
FEATURE → PATTERN → COMPONENT → BASE UI
                         ↓
                       TOKEN
              PATTERN → TOKEN
```

This expresses dependency ownership. Tokens are leaf styling data. Base UI provides behavior and does not import Maleo tokens; Maleo components combine primitive behavior with token-backed recipes. Features can use components directly when no composition pattern is needed. No empty pattern wrapper is required to complete the diagram.

| Layer     | Owns                                                    | Allowed dependencies                                                                                        | Boundary                                                                                    |
| --------- | ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| App       | Routing, providers, shell composition, global styles    | Features and public design-system entry points                                                              | Does not implement another primitive stack                                                  |
| Feature   | Domain models, IO, orchestration and domain-specific UI | Public patterns/components; editor workspace components and controllers where editor behavior requires them | Generally no direct Base UI import or copied primitive recipe                               |
| Pattern   | Repeated semantic composition and state presentation    | Components and foundation recipes/tokens                                                                    | No feature imports, fetching, persistence, provider selection or application business state |
| Component | Accessible control contract and supported variants      | Base UI, suitable native controls, tokens and the overlay/keyboard controllers                              | No feature imports or domain-specific side effects                                          |
| Token     | Semantic visual values and complete foundation recipes  | Other owned token definitions where necessary                                                               | No runtime feature/component dependency                                                     |

Common domain types can pass through neutral props; design-system code must not import feature models to render them. Media-card and generation-card recipes render typed presentation data/actions; feature code owns playback/generation requests, trusted permissions, run-frontier policy and historical action eligibility. Keep specialized timeline geometry and gesture machinery in public VUI contracts, not generic design-system components.

## Overlay ownership

Modal, Sheet and Lightbox are facades over the overlay lifecycle in `controllers/overlay`; there is no second dialog stack, and Back is answered by that stack's key owner (`back-dismissal.ts`). While one is open the stack marks every other child of `<body>` inert, so a floating popup opened inside an overlay cannot render at `<body>`. Popover, Menu, ContextMenu and Tooltip therefore portal into the open overlay's own host (`OverlayHostContext` in `hooks/ui/use-overlay.ts`) and use fixed positioning. An open interactive popup owns Escape and its own Tab order; the overlay's handler stands aside until it closes. Tooltips never absorb Escape.

## Boundary exceptions

None. No module outside `design-system/` imports Base UI; the check's exception list is empty. WorkspaceSwitcher stays a feature — it owns workspace data, switching, creation and navigation — and composes the shared Popover, Avatar, Input, Button and Note. Frame and Lightbox read `assetUrl` from `api/` and AudioPreview a player from `models/`: lower layers, allowed by the import order.

## Migration rules

M00 established the visual grammar and M18 the design-system boundary and import ownership; both are in place. Matching component/pattern migrations follow those gates. Move existing implementations in bounded batches; preserve compatibility re-exports only while real callers remain, then remove them. Do not retain two token owners or duplicate old/new component implementations.

`check:layers` rejects feature Base UI imports, design-system imports from features or stores, and upward imports inside the design system. A justified exception is listed in the check with its owner and reason.

Implementation requires a separate authorized OpenSpec scope with relevant delta requirements, source/consumer updates and browser proof. No folder moves, token CSS edits, new controls, dependency installation, baseline refresh or publication occurred here.
