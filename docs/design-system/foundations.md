# Maleo visual grammar and foundation evidence

The grammar below constrains all UI work. It is implemented in [tokens.css](../../apps/web/src/design-system/tokens/tokens.css) and rendered live, in both themes, by the Storybook `Foundations` pages (Overview, Colors, Typography, Spacing, Sizing & Density, Radius, Borders, Shadows & Elevation, Icons, Motion, Theme Check), which read computed values so they cannot drift from the tokens. Visual approval and baseline refresh remain pending in OpenSpec (private historical record). [principles.md](principles.md) defines the target architecture and dependency rules.

## Target grammar

Choose a semantic role before a value; write the role's token. Components own their visual recipes; features select supported variants and patterns. Do not introduce local colors, spacing, type sizes, radii, shadows, icon sizes or stacking values to make an individual screen fit. `check-layers` rejects a declared token nothing reads, a read token nothing declares, and a numeric icon size outside the registry.

### Design language

Dense, professional, quiet, precise, content-first, low decoration. Content outranks chrome; spacing and typography group before containers do; borders and backgrounds must separate something; controls are compact; similar interactions look identical; elevation means hierarchy; semantic tokens only; composition over specialized components. Storybook `Foundations/Overview` states these with live Do/Don't compositions.

### Spacing

| Role   | CSS px | Token     | Intended use                                                        |
| ------ | -----: | --------- | ------------------------------------------------------------------- |
| `hair` |      2 | `--s-0-5` | Between a glyph and its count; the inset of a segmented group       |
| `xs`   |      4 | `--s-1`   | Icon/text separation, controls inside one row, rows in a dense list |
| `xs+`  |      6 | `--s-1-5` | Gaps inside a dense editor row or card                              |
| `sm`   |      8 | `--s-2`   | Label to control; related control groups                            |
| `sm+`  |     10 | `--s-2-5` | Inline padding of compact controls and dense cards                  |
| `md`   |     12 | `--s-3`   | Panel inline padding; below a section's last row                    |
| `lg`   |     16 | `--s-4`   | Panel padding outside the dense editor; related groups              |
| `xl`   |     24 | `--s-6`   | Section separation on a page                                        |
| `2xl`  |     32 | `--s-8`   | Page gutters and major region separation                            |

`--s-5` (20), `--s-12` (48) and `--s-16` (80) are named layout exceptions, not component choices. Zero, `auto`, percentages and content-derived geometry (timeline coordinates, aspect ratios, resize handles) are not spacing.

Standard framed tables use `--measure-table` (620px minimum readable table width), retained from the AI Explorer detail drawer. Canonical TableScroll contains horizontal overflow within its rounded bordered frame; the page remains within its viewport.

### Color roles

| Group       | Role                   | Token                                   | Use                                                                                                              |
| ----------- | ---------------------- | --------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Background  | canvas                 | `--bg`                                  | App ground between panels; media letterbox stays `--media-bg`                                                    |
|             | surface                | `--surface`                             | Panel, inspector, rail, card body                                                                                |
|             | surface-raised         | `--surface-raised`                      | Lifted object in a panel: focused field, slider thumb                                                            |
|             | surface-overlay        | `--surface-overlay`                     | Menus and popovers, always with an elevation shadow                                                              |
| Foreground  | primary                | `--fg`                                  | Content and values                                                                                               |
|             | secondary              | `--fg-dim`                              | Labels and supporting text                                                                                       |
|             | muted                  | `--muted`                               | Hints, metadata, placeholders                                                                                    |
|             | disabled               | `--fg-disabled`                         | Unavailable controls only; never idle or read-only content                                                       |
| Interaction | hover                  | `--surface-hover`                       | Transient pointer feedback (overlay)                                                                             |
|             | active                 | `--surface-strong`                      | Pressed                                                                                                          |
|             | selected               | `--ai-bg` + `--ai`                      | Persistent selection fill plus indicator/text                                                                    |
|             | focus                  | `--focus-color`                         | Keyboard focus ring (`--focus-w`)                                                                                |
| Semantic    | accent                 | `--ai` / `--on-ai`                      | Selection, focus, checked, primary editor action                                                                 |
|             | identity               | `--on-identity`                         | Text on a generated identity colour (a workspace's); the same in both themes because the colour under it is data |
|             | destructive            | `--err` / `--on-accent`                 | Delete and error                                                                                                 |
|             | warning, success, info | `--warn`, `--ok`, `--info` + `-bg` wash | Status text on its wash; never a solid fill with text                                                            |
| Border      | subtle                 | `--border-subtle`                       | Separators between groups                                                                                        |
|             | default                | `--border`                              | Region edges, outlined controls                                                                                  |
|             | strong                 | `--border-strong`                       | Rare emphasis, drop targets                                                                                      |
|             | focus                  | `--border-focus`                        | A focused edge where a ring cannot fit                                                                           |

Every readable pairing above is checked live on the Colors page against WCAG AA (4.5:1) in both themes and passes; [palette source](#palette-source) records the values and deviations. Status keeps a name or icon beside its colour.

### Typography roles

Space Grotesk only; there is no monospace and no uppercase micro label in the interface. The floor is `--type-micro-size` (10px), for labels inside timeline clips and badges where 11 does not fit; nothing is set smaller, and sizes between steps (11.5, 12.5) are not written. Digits align by tabular figures, set once on `body`. A role carries size, line height, weight, tracking and colour together; never set a size alone.

| Role           | Recipe                                                 | Scope                                           |
| -------------- | ------------------------------------------------------ | ----------------------------------------------- |
| Display        | `--type-display-*`, 700                                | Onboarding only; never editor chrome            |
| Page title     | `--type-title-*`, 700                                  | Page heading outside the editor                 |
| Heading        | `--type-section-*`, 600                                | Section heading within a page                   |
| Panel title    | `--type-subsection-*`, 600                             | Panel, sheet or dialog title                    |
| Section title  | `--type-caption-*`, 600                                | Group heading inside a panel (InspectorSection) |
| Body           | `--type-body-*`, 400                                   | Reading text and form controls                  |
| Control text   | `--type-control-size` (the `text-xs` utility), tabular | Value inside a field, select, tab, chip         |
| Label          | `--type-label-*` in `--fg-dim`                         | Property or field label                         |
| Caption        | `--type-caption-*` in `--fg-dim`                       | Supporting prose                                |
| Muted          | caption recipe in `--muted`                            | Hints and metadata                              |
| Code / numeric | `--type-data-*`, tabular figures                       | Timecode, measurements, IDs                     |

Editor hierarchy is section title (12 strong) → label (11 dim) → control text (12 tabular).

### Sizing and density

| Kind           | Step              | Token                                                                              | Use                                                                                                                         |
| -------------- | ----------------- | ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Control height | xs · editor       | `--control-h-xs` (24)                                                              | Property rows, editor fields, small icon buttons; the editor default                                                        |
|                | sm · compact      | `--control-h-sm` (32)                                                              | Toolbars, section headers, compact buttons/selects                                                                          |
|                | md · form         | `--control-h` (40)                                                                 | Forms and settings outside the editor                                                                                       |
|                | touch floor       | `--control-h-touch` (44)                                                           | Coarse-pointer minimum hit target; Button, IconButton, the field recipe, NumberField, Slider and PropertyRow all grow to it |
| Icon           | xs / sm / md / lg | `ICON.xs` 12 / `sm` 14 / `md` 16 / `lg` 20                                         | Chrome glyphs, named at the call site: `Ic.check(ICON.sm)`                                                                  |
|                | xl / display      | `ICON.xl` 24 / `display` 48                                                        | Status and empty-state illustration only                                                                                    |
| Geometry       |                   | `--property-row-h`, `--section-header-h`, `--panel-w`, `--sidebar-w`, `--topbar-h` | Panels and patterns read these instead of stating numbers                                                                   |

### Radius

Four roles: **none** (panels, rows, separators), **sm** `--r-1` 4px (controls), **md** `--r-2` 8px (floating surfaces, dialogs, the rare content tile), **full** `--r-pill` (badges, avatars, pills, switches only). There is no fifth curve; the former 6/10/14px steps were folded into these.

### Borders

Don't use borders to solve every grouping problem: prefer spacing, typography and surface hierarchy first. A border marks a boundary the eye cannot otherwise find — two regions with the same paint, a panel against a near-identical canvas, an error or focus state. Not around each property or field, not around a group that already has a heading, and never a card inside a panel inside a card. Focus indication is never removed to keep a screen quiet.

### Elevation, stacking and motion

| Elevation | Token        | Use                                                                                   |
| --------- | ------------ | ------------------------------------------------------------------------------------- |
| none      | —            | Panels, inspector, timeline, grid cards: flat, separated by surface and a subtle rule |
| floating  | `--shadow-1` | Small lifted objects: slider thumb, dragged clip, tooltip                             |
| overlay   | `--shadow-2` | Menus, popovers, colour picker (with `--surface-overlay`, `--r-2`)                    |
| modal     | `--shadow-3` | Dialogs and sheets, over the one `--scrim`                                            |

Stacking roles are page, chrome, floating and modal. Floating surfaces (menus, popovers, context menus) read `--z-floating`, which sits above an open dialog's content so a menu inside a dialog is never trapped; modal nesting, focus, dismissal and history belong to the VUI overlay owner. Anything that covers the page takes a named layer (`--z-nav` 50, `--z-palette` 100, `--z-toast` 200, `--z-topbar` 500, `--z-modal` 600, `--z-sheet` 700, `--z-dialog` 1000); small numbers that order a stage's, track's or panel's own children are local stacking and stay literal. Feature code does not pick a z-index to win.

Motion uses `--d-fast` (120ms) for hover, press, focus and disclosure and `--d-med` (220ms) for popovers, menus, dialogs and sheets, with `--ease` for in-place change and `--ease-out` for surfaces entering. Animate transform and opacity only; reduced-motion users get the end state. Timeline keyframes are content, not UI motion.

### Foundation acceptance gate

M00 must establish the semantic role mapping, light/dark paints, compatibility aliases and shadcn utility bridge before downstream migrations. Build a review specimen covering surfaces, type, controls and hover/selected/focus/disabled/busy/error states, then verify actual Library, inspector and timeline usages at desktop, 320px and coarse-pointer settings. Keep candidate specimens distinct from approved-kit publication.

Check normal text against its composed background at 4.5:1 and qualifying large text at 3:1, with the documented exceptions in [WCAG text contrast](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum). Required non-text control/state indicators need 3:1 against adjacent colors under [WCAG non-text contrast](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast); this does not require every decorative border to meet that ratio. Current alpha text/borders are evidence, not certification. Review focus, inversion and selection separately. No contrast or screenshot approval is claimed by this documentation pass.

## Current implementation reference

The remainder records the 2026-10-01 implementation snapshot. It is the migration source map, not the default choice list for new UI. Authoring authority remains [apps/web/DESIGN.md](../../apps/web/DESIGN.md), owning token files and accepted OpenSpec requirements. Source locations stay current until a separately authorized migration moves them.

## Ownership and cascade

App palette, type, spacing, radius, motion, focus and density live in [tokens.css](../../apps/web/src/design-system/tokens/tokens.css). [styles.css](../../apps/web/src/app/styles.css) fixes layer order: `theme, reset, workspace, app-base, chrome, feature, utilities`; `workspace` holds the editor workspace's structure (formerly `@maleo/vui`'s `vui` layer). The `tw:` utility layer outranks feature CSS; unlayered touch rules deliberately override layered rules. This precedence directly explains the Library search adornment defect (F01).

The [shadcn bridge](../../apps/web/src/app/styles/shadcn.css) maps semantic shadcn names onto Maleo tokens. Recipes are source-owned Base UI/shadcn-style classes; shadcn is not a separate runtime component dependency. `@base-ui/react` is declared at `^1.8.0`; `react-colorful` at `^5.7.0`; React at `^19.2.6`. These are manifest ranges, not assertions about every resolved dependency.

## App tokens

| Token                     | Current declaration                                                                     |
| ------------------------- | --------------------------------------------------------------------------------------- |
| `--bg`                    | `hsl(0 0% 100%)`                                                                        |
| `--surface`               | `hsl(210 20% 98%)`                                                                      |
| `--surface-tint`          | `rgba(0, 0, 0, 0.05)`                                                                   |
| `--surface-hover`         | `rgba(0, 0, 0, 0.07)`                                                                   |
| `--surface-strong`        | `rgba(0, 0, 0, 0.1)`                                                                    |
| `--surface-raised`        | `hsl(0 0% 100%)`                                                                        |
| `--surface-overlay`       | `hsl(0 0% 100%)`                                                                        |
| `--fg`                    | `hsl(0 0% 11%)`                                                                         |
| `--fg-dim`                | `hsl(0 0% 36%)`                                                                         |
| `--muted`                 | `hsl(0 0% 44%)`                                                                         |
| `--fg-disabled`           | `hsl(0 0% 68%)`                                                                         |
| `--border-subtle`         | `hsl(0 0% 92%)`                                                                         |
| `--border`                | `hsl(0 0% 87%)`                                                                         |
| `--border-strong`         | `hsl(0 0% 83%)`                                                                         |
| `--border-focus`          | `hsl(0 0% 53%)`                                                                         |
| `--dark`                  | `hsl(0 0% 11%)`                                                                         |
| `--dark-fg`               | `hsl(0 0% 98%)`                                                                         |
| `--dark-border`           | `rgba(255, 255, 255, 0.12)`                                                             |
| `--ok`                    | `hsl(141 71% 27%)`                                                                      |
| `--ok-bg`                 | `rgb(from var(--ok) r g b / 8%)`                                                        |
| `--warn`                  | `hsl(38 92% 29%)`                                                                       |
| `--warn-bg`               | `rgb(from var(--warn) r g b / 8%)`                                                      |
| `--err`                   | `hsl(0 83% 46%)`                                                                        |
| `--err-bg`                | `rgb(from var(--err) r g b / 8%)`                                                       |
| `--info`                  | `hsl(220 70% 45%)`                                                                      |
| `--info-bg`               | `rgb(from var(--info) r g b / 8%)`                                                      |
| `--accent`                | `hsl(0 0% 2%)`                                                                          |
| `--accent-bg`             | `rgba(0, 0, 0, 0.06)`                                                                   |
| `--font-display`          | `'Space Grotesk', 'The Future', 'Inter', -apple-system, BlinkMacSystemFont, sans-serif` |
| `--font-body`             | `'Space Grotesk', 'The Future', 'Inter', -apple-system, BlinkMacSystemFont, sans-serif` |
| `--type-display-size`     | `clamp(48px, 6vw, 80px)`                                                                |
| `--type-display-lh`       | `1.02`                                                                                  |
| `--type-display-track`    | `-0.03em`                                                                               |
| `--type-title-size`       | `clamp(28px, 3.5vw, 40px)`                                                              |
| `--type-title-lh`         | `1.15`                                                                                  |
| `--type-title-track`      | `-0.02em`                                                                               |
| `--type-section-size`     | `22px`                                                                                  |
| `--type-section-lh`       | `1.2`                                                                                   |
| `--type-section-track`    | `-0.01em`                                                                               |
| `--type-subsection-size`  | `18px`                                                                                  |
| `--type-subsection-lh`    | `1.2`                                                                                   |
| `--type-subsection-track` | `-0.01em`                                                                               |
| `--type-body-size`        | `13px`                                                                                  |
| `--type-body-lh`          | `1.45`                                                                                  |
| `--type-control-size`     | `12px`                                                                                  |
| `--type-caption-size`     | `12px`                                                                                  |
| `--type-caption-lh`       | `1.4`                                                                                   |
| `--type-label-size`       | `11px`                                                                                  |
| `--type-label-lh`         | `1.4`                                                                                   |
| `--type-micro-size`       | `10px`                                                                                  |
| `--type-data-size`        | `12px`                                                                                  |
| `--type-data-lh`          | `1.45`                                                                                  |
| `--weight-body`           | `400`                                                                                   |
| `--weight-medium`         | `500`                                                                                   |
| `--weight-strong`         | `600`                                                                                   |
| `--weight-display`        | `700`                                                                                   |
| `--r-1`                   | `4px`                                                                                   |
| `--r-2`                   | `8px`                                                                                   |
| `--r-pill`                | `999px`                                                                                 |
| `--s-0-5`                 | `2px`                                                                                   |
| `--s-1`                   | `4px`                                                                                   |
| `--s-1-5`                 | `6px`                                                                                   |
| `--s-2`                   | `8px`                                                                                   |
| `--s-2-5`                 | `10px`                                                                                  |
| `--s-3`                   | `12px`                                                                                  |
| `--s-4`                   | `16px`                                                                                  |
| `--s-5`                   | `20px`                                                                                  |
| `--s-6`                   | `24px`                                                                                  |
| `--s-8`                   | `32px`                                                                                  |
| `--s-12`                  | `48px`                                                                                  |
| `--s-16`                  | `80px`                                                                                  |
| `--scrim`                 | `rgba(0, 0, 0, 0.4)`                                                                    |
| `--shadow-1`              | `0 1px 3px rgba(15, 15, 20, 0.04), 0 1px 2px rgba(15, 15, 20, 0.03)`                    |
| `--shadow-2`              | `0 4px 12px rgba(15, 15, 20, 0.06), 0 2px 4px rgba(15, 15, 20, 0.04)`                   |
| `--shadow-3`              | `0 16px 40px rgba(15, 15, 20, 0.10), 0 4px 8px rgba(15, 15, 20, 0.04)`                  |
| `--d-fast`                | `120ms`                                                                                 |
| `--d-med`                 | `220ms`                                                                                 |
| `--ease`                  | `cubic-bezier(0.2, 0.8, 0.2, 1)`                                                        |
| `--ease-out`              | `cubic-bezier(0.22, 1, 0.36, 1)`                                                        |
| `--focus-w`               | `2px`                                                                                   |
| `--focus-offset`          | `2px`                                                                                   |
| `--focus-color`           | `var(--ai)`                                                                             |
| `--control-h`             | `40px`                                                                                  |
| `--control-h-sm`          | `32px`                                                                                  |
| `--control-h-xs`          | `24px`                                                                                  |
| `--control-h-touch`       | `44px`                                                                                  |
| `--panel-w`               | `312px`                                                                                 |
| `--focus-ring`            | `0 0 0 var(--focus-w) var(--focus-color)`                                               |
| `--ring-selected`         | `0 0 0 1px var(--ai)`                                                                   |
| `--z-floating`            | `1100`                                                                                  |
| `--z-nav`                 | `50`                                                                                    |
| `--z-palette`             | `100`                                                                                   |
| `--z-toast`               | `200`                                                                                   |
| `--z-topbar`              | `500`                                                                                   |
| `--z-modal`               | `600`                                                                                   |
| `--z-sheet`               | `700`                                                                                   |
| `--z-dialog`              | `1000`                                                                                  |
| `--section-header-h`      | `var(--control-h-sm)`                                                                   |
| `--property-row-h`        | `var(--control-h-xs)`                                                                   |
| `--surface-translucent`   | `rgba(255, 255, 255, 0.85)`                                                             |
| `--measure-form`          | `520px`                                                                                 |
| `--sidebar-w`             | `240px`                                                                                 |
| `--page-pad`              | `28px`                                                                                  |
| `--topbar-h`              | `48px`                                                                                  |
| `--page-pad`              | `16px`                                                                                  |
| `--page-pad`              | `32px`                                                                                  |

## Palette source

The colour tokens are ported from [OpenCut classic](https://github.com/opencut-app/opencut-classic) (its web app's `globals.css` at commit [cf5e79e](https://github.com/opencut-app/opencut-classic/tree/cf5e79e919144200294fb9fed22a222592a0aeea), MIT, Copyright 2025-2026 OpenCut; license text in [apps/web/third-party/opencut-classic-license.txt](../../apps/web/third-party/opencut-classic-license.txt)). Their values are mapped onto our semantic roles, not their shadcn names:

| Our role                                        | Their source                                                | Light / dark                             |
| ----------------------------------------------- | ----------------------------------------------------------- | ---------------------------------------- |
| `--bg`                                          | `--background`                                              | 100% / 5%                                |
| `--surface`                                     | `.panel --background`                                       | `hsl(210 20% 98%)` / 10%                 |
| `--fg`, `--muted`                               | `--foreground`, `--muted-foreground`                        | 11% / 87%, 44% / 52%                     |
| `--border`, `--border-strong`, `--border-focus` | `.panel --border`, `--muted`, `--ring`                      | 87%, 83%, 53% / 18%, 22%, 52%            |
| `--ai` (selection, focus, checked)              | `--primary`                                                 | hue 200 90% at 36% / 52%                 |
| `--ai-bg`                                       | `--secondary`                                               | `hsl(204 100% 96%)` / `hsl(204 67% 12%)` |
| `--ok`, `--warn`, `--err`, `--info`             | `--constructive`, `--caution`, `--destructive`, `--chart-1` | same hues                                |

Deliberate deviations, each for WCAG AA:

- `--ai` light is 36% lightness, not 52%: white text on their blue is 2.6:1; at 36% it is 4.9, and 4.7 as text on a panel. Dark keeps 52% and puts `--on-ai` (near-black, 7.4:1) on it.
- Light status tones are darkened until their text clears 4.5:1 on their own 8% wash: `--ok` 27%, `--warn` 29%, `--info` 45%, `--err` 46% (theirs 2.0–4.4:1). Dark `--err` is 62% and dark `--info` 65% (theirs 3.8 and 3.2:1 on a panel); dark `--on-accent` is near-black on the red fill (5.4:1, white was 3.6).
- Light `--muted` is 44%, not 48% (4.1:1 on a panel; 44% is 4.7).
- `--fg-dim` has no source value; it is derived between foreground and muted text (36% / 66%).
- The three surface tints stay alpha overlays so one token lands on their values over both the ground and a panel.

Ink (`--dark`) stays the default button fill, as in their editor; the accent blue marks selection, focus and checked state only.

## Typography roles and usage

`display`, `title`, `section`, `subsection`, `body`, `control`, `caption`, `label`, and `data` are the current roles. Display/title use clamps; body is 13px, control/caption/data 12px, label 11px. Every role uses Space Grotesk; the mono micro label (10px, uppercase, tracked) was retired and its 62 sites converted to the Label role. Weight roles are 400, 500, 600 and 700, the four the font is loaded at; an in-between weight draws as the next one up, so none is written.

Use the named role according to hierarchy, not whichever raw size makes a local screenshot fit. `ML`, `Field`, `PageTitle` and shared controls consume pieces of this vocabulary. Feature typography still uses separate values; the raw histogram below is current source, while explanatory historical counts in token comments may be stale.

## Theme, density, focus, and motion

Dark mode overrides surface/text/border/accent/shadow variables. Theme adaptation is token-driven; media colors chosen by users are content data and are not chrome token violations. Default/small/extra-small heights are 40/32/24px; coarse-pointer target floor is 44px. A 320px desktop-pointer screenshot does not prove a touch hit-target check. Focus is 2px with 2px offset and the AI accent. Motion durations are 120/220ms; reduced-motion behavior belongs to actual controls and browser suites, not token existence alone.

## Responsive composition

The app token comment names 640px phone and 1024px desktop boundaries, with page gutters 16px on phone, 28px between, and 32px desktop. Editor phone composition separately switches at 860px. The editor workspace uses container queries and editor width, so the same composition works embedded and in the studio modals. These are different contracts: do not force timeline geometry onto app breakpoints without verifying behavior. Usage overflow at 320px is a route-layout defect, not evidence that all dense controls should enlarge.

## Editor workspace foundation

The editor workspace's structure — pane grid, preview, inspector rail, accordion, overlay and sheet geometry — is [editor-workspace.css](../../apps/web/src/components/editor-workspace/editor-workspace.css), in the `workspace` layer, scoped under `[data-vui-root]`. Its surface tokens (`--vui-surface`, `--vui-fg`, `--vui-muted`, `--vui-border`, `--vui-accent`) resolve to the app palette in that sheet; `--vui-bg` (the preview letterbox) and `--vui-surface-raised` have no app token and keep their values. The workspace follows the app's visual grammar; `@maleo/vui`'s opt-in `theme.css` is a library artifact retiring with the package, not a target (`migrate-editor-to-shared-rust-core`).

## Raw value evidence

The complete style-values.json (private historical record) records literal declarations for type, padding, gap, radius, stacking, outline and heights after stripping comments. It is a heuristic source list, not a computed-style result. Token-backed `var()` values are excluded here. Arbitrary `tw:[…]` utilities, their exact lines and token-backed flag are retained per module/component in inventory.json (private historical record). Standard utilities such as `tw:px-3` also encode values through the Tailwind/shadcn bridge; they are not absent merely because they lack brackets.

| Property      | Frequent literal values (declaration counts)                                                                                                                       |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| font-size     | 11px ×117; 12px ×93; 10px ×73; 11.5px ×58; 10.5px ×49; 12.5px ×43; 13px ×39; 9.5px ×23; 9px ×23; 14px ×20; 13.5px ×9; 16px ×7; 15px ×7; 17px ×5; 8.5px ×5          |
| padding       | 0 ×62; 6px ×17; 12px ×15; 10px ×14; 10px 12px ×13; 0 8px ×13; 8px ×11; 8px 10px ×9; 1px 6px ×9; 2px ×8; 12px 14px ×8; 5px 7px ×7; 16px ×7; 2px 6px ×6; 7px 10px ×6 |
| gap           | 8px ×119; 6px ×108; 5px ×50; 10px ×49; 4px ×38; 2px ×36; 12px ×35; 7px ×35; 9px ×16; 3px ×13; 14px ×11; 1px ×11; 16px ×9; 0 ×8; 11px ×5                            |
| border-radius | 50% ×32; 999px ×13; 0 ×10; 5px ×10; 3px ×8; 2px ×7; 8px ×7; 4px ×6; 6px ×5; 14px ×4; inherit ×4; 7px ×3; 20px ×1; 1px ×1; 9px ×1                                   |
| z-index       | 3 ×11; 20 ×7; 1 ×7; 2 ×4; 5 ×4; 100 ×3; 50 ×3; 30 ×3; 120 ×3; 6 ×3; 130 ×2; 21 ×2; 40 ×2; 1100 ×2; 4 ×2                                                            |
| outline       | none ×28; auto ×1; 2px solid transparent ×1                                                                                                                        |
| height        | 100% ×36; auto ×12; 28px ×9; 1px ×9; 16px ×9; 18px ×9; 20px ×8; 30px ×8; 26px ×7; 22px ×6; 32px ×6; 4px ×5; 44px ×5; 14px ×5; 34px ×5                              |
| min-height    | 0 ×40; 30px ×7; 100dvh ×4; 24px ×3; 58px ×3; 72px ×3; 96px ×3; 130px ×2; 28px ×2; 60px ×2; 36px ×2; 46px ×2; 40px ×1; 1lh ×1; 13px ×1                              |

## Dispositions

| Foundation area | Classification | Reason |
|---|---|
| Canonical palette and shadcn bridge | KEEP | One existing ownership path; reuse it. |
| Type roles versus local half-pixel scales | STANDARDIZE | F10: choose roles by hierarchy, verify dense screens. |
| App and VUI theme isolation | RETIRED | The workspace stylesheet is app-owned and reads the app palette; package independence ended with `migrate-editor-to-shared-rust-core`. |
| Search adornment padding | STANDARDIZE | F01: composed input overrides lose to utility layer. |
| Shared-control literal chrome | STANDARDIZE | F09/F10: separate semantic chrome from editable media data. |
| Responsive route navigation | REFACTOR | F02: current mobile overflow is reproduced. |
| Timeline/media geometry and user colors | KEEP | Data/geometry are not arbitrary app styling. |

## Census interpretation

Snapshot: 48 stylesheets, 475 web source modules, 1,583 defined classes, 439 cross-cluster classes, 136 classes without static call sites, 306 inline style objects, and 147 TSX color-literal occurrences. These counts include deliberate shared vocabulary and dynamic/data styling. The census allowlist permits 11 literal inline colors in Lightbox, Launcher, Frame and VoiceDot. Five undefined-class exceptions include two stale/test-only entries (`cv-field-lbl`, `chip-removable`) and three live ones (`is-gesturing`, `tl2-clip-motionbody`, `tl2-clipbar-more`). Static no-caller classes require dynamic-reference review before REMOVE.

Layer check passed with 471 cross-cluster imports; it is a ratchet, not a claim of zero debt. The 800-line limit is already reached by create-content.tsx; timeline-editor.tsx has two lines of headroom and timeline-tracks.tsx nine. Source ownership and pattern work should avoid adding new complexity to those hosts.
