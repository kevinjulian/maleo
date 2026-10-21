# web-ui-primitives Specification

## Purpose

TBD - created by archiving change restructure-web-role-first. Update Purpose after archive.

## Requirements

### Requirement: A visual variant is a prop, not a class name

The web client SHALL express repeated visual variants as typed props on a primitive component under `apps/web/src/design-system/components/`. A component SHALL NOT apply a shared variant class such as `btn`, `btn-ghost`, `btn-light`, `btn-dark`, `btn-sm`, `btn-ai`, or `btn-danger` by writing it into a `className` string.

`btn` appears as a bare `className` at 171 call sites today, with five variant classes alongside it. Written as strings the variants cannot be renamed, cannot be enumerated, and cannot be checked — a typo produces an unstyled button and no error.

#### Scenario: A button is added

- **WHEN** a new button is written
- **THEN** it renders `<Button variant="ghost" size="sm">` rather than `<button className="btn btn-ghost btn-sm">`

#### Scenario: A variant is misspelled

- **WHEN** a caller passes a variant name that does not exist
- **THEN** `bun run typecheck` fails, rather than the element rendering unstyled

#### Scenario: A variant class is written directly

- **WHEN** a module under `components/` or `pages/` puts a registered variant class into a `className` string
- **THEN** the structural check fails and names the file

### Requirement: Introducing the primitive changes no pixels

The initial structural introduction of a primitive SHALL emit the same classes as
its existing call sites and SHALL pass existing visual baselines without snapshot
updates. A later design-convergence change MAY intentionally change its appearance
only when the changed states and affected surfaces are named, inspected, and
recorded as convergence proof.

Separating structural promotion from design approval keeps each change reviewable:
the first proves one application point; the second proves the chosen appearance.

#### Scenario: Structural conversion lands

- **WHEN** call sites are converted to a primitive without an approved design change
- **THEN** `bun run visual` passes against existing baselines with no snapshot updates

#### Scenario: Approved convergence lands

- **WHEN** an OpenSpec design-convergence task intentionally changes a primitive's appearance
- **THEN** affected baselines move only after changed states and representative surfaces are inspected and recorded

### Requirement: Merging a caller's class names has one path

A component that combines a caller's `className` with its own SHALL do so through the shared `cn()` helper, and SHALL NOT build that string by template literal, concatenation or a hand-rolled filter/join.

This is narrower than "all conditional classes", deliberately. A self-contained toggle — `` `sb-item${active ? " active" : ""}` `` — resolves nothing and there are around 110 of them; rewriting those produces identical output, because the class vocabulary here is hand-written CSS rather than Tailwind utilities and the merge step has nothing to merge. The case that genuinely needs one path is a caller's string meeting the component's, where composition order and duplicates decide the result.

#### Scenario: A component accepts a className

- **WHEN** a component takes a `className` prop and renders it alongside classes of its own
- **THEN** the two are combined with `cn()`, and the structural check rejects a hand-rolled merge

#### Scenario: A component toggles a class on its own state

- **WHEN** a component adds a class from a condition it owns, with no caller className involved
- **THEN** a template literal is acceptable; the rule does not apply

### Requirement: Icons come from one registry

The web client SHALL resolve every icon through a single registry module at `apps/web/src/design-system/icons/`. A component SHALL NOT define an inline icon component, and no module outside the registry SHALL import an icon library directly. A module in a non-rendering role SHALL NOT return JSX at all: an icon defined in one is both a layering violation and a second icon source. `components`, `app` and `pages` render by definition; every other role does not, and constructing markup there files a component under a name that says it is not one.

Three sources exist today: the registry, fourteen inline `*Icon()` functions in the app shell — a file that also imports the registry — and an icon package dependency. Three sources means an icon's appearance depends on which one the author reached for.

The check SHALL detect an icon however it is declared. Matching only `function <Name>Icon(` misses an arrow constant: `services/editor/create-content-model.tsx` exported `TlExportIcon` as `export const TlExportIcon = (s = 14) => (...)`, was imported and rendered by `components/editor/export-menu.tsx`, and passed the check for as long as it existed. A pattern that enforces a rule against one declaration form teaches authors the other form.

The registry's carve-out SHALL be encoded in the check rather than stated only in prose. A glyph that takes a size and nothing else is one the registry can express as `(size?: number) => JSX.Element`, and SHALL live there; a glyph needing a further argument — a flip, an end, a kind — cannot, and SHALL stay with the surface that owns it. Left in prose, the carve-out is applied by whoever remembers it: three timeline glyphs qualified for it and a fourth, taking only a size, did not, and nothing distinguished them.

#### Scenario: A component needs an icon

- **WHEN** a component renders an icon
- **THEN** it reads it from the registry, and the registry is the only module that knows where the glyph came from

#### Scenario: An icon exists only in a third-party package

- **WHEN** a required glyph is available only from an icon library
- **THEN** the registry imports it and re-exports it under a registry name, and the dependency appears in no other module

#### Scenario: An icon is declared as a constant

- **WHEN** a module outside the registry declares an icon as an arrow constant rather than a function declaration
- **THEN** the structural check fails and names it, the same as it would for a function declaration

#### Scenario: A glyph needs more than a size

- **WHEN** a module outside the registry declares an icon taking an argument beyond its size
- **THEN** the structural check accepts it, because the registry's one-argument shape cannot express it and the glyph belongs with the surface that varies it

#### Scenario: A non-rendering role returns JSX

- **WHEN** a module under `api/`, `stores/`, `hooks/`, or `models/` returns a JSX element
- **THEN** it is moved into `components/`, because a role that does not render has no reason to construct markup

### Requirement: A UI dependency is used or removed

The web client SHALL NOT declare a dependency no module imports. A declared-but-unused dependency is a standing invitation to introduce a second way of doing something already solved.

A single importer is not evidence of waste. The opposite is often true: `clsx` and `tailwind-merge` are imported once each, by `cn()`, and that is the point of having `cn()` — one module owns class composition so every caller gets the same precedence rules. An import count is a signal to look, not a threshold to enforce.

#### Scenario: A dependency has no importer

- **WHEN** a declared UI dependency is imported by no module under `src/`
- **THEN** it is removed from `package.json` rather than left for a future adopter

#### Scenario: A dependency has exactly one importer

- **WHEN** a declared UI dependency is imported by a single module
- **THEN** that module is checked for being the deliberate single owner of the concern, and the dependency is kept when it is

### Requirement: Audio preview is a primitive, not a browser default

The web client SHALL preview audio through one primitive component under `apps/web/src/design-system/components/`. A module under `components/` or `pages/` SHALL NOT render a native `<audio controls>` element.

The primitive SHALL offer a play toggle, a scrub bar that can be dragged to seek, and the elapsed and total time. It SHALL NOT require a waveform: provider support for one is uneven, and computing peaks in the client means decoding the audio to draw a decoration.

At most one preview SHALL play at a time across the whole page, following the single-element behaviour the voice-sample previews already have.

Native controls capture pointer events, which is why this is a requirement rather than a preference: a row whose body is a native audio element cannot itself be dragged, so any surface that both previews and places audio needs the primitive first.

#### Scenario: An audio preview is added

- **WHEN** a surface needs to preview an audio asset
- **THEN** it renders the primitive rather than `<audio controls>`

#### Scenario: A second preview starts

- **WHEN** a preview is playing and the operator starts another
- **THEN** the first stops

#### Scenario: The operator seeks

- **WHEN** the operator drags the scrub bar
- **THEN** playback moves to that position and the elapsed reading follows it

#### Scenario: A native control is reintroduced

- **WHEN** a module under `components/` or `pages/` renders `<audio controls>`
- **THEN** the structural check fails and names the file

### Requirement: An overlay pane is a primitive, not a hand-rolled transform

A pane that slides in over the app from a viewport edge SHALL be rendered by a shared sheet primitive under `apps/web/src/design-system/components/`. Its edge, its open state and its dismissal SHALL be typed props. A caller SHALL NOT reproduce the pattern by writing its own translate transform, scrim element and `open` class.

The behavior already exists once, correctly, as `.nav-drawer` and `.nav-scrim` in `apps/web/src/app/styles/shell.css`: a translate transform, an opacity fade on the scrim, a `prefers-reduced-motion` arm that removes both, and `env(safe-area-inset-bottom)` padding so the footer clears the home indicator. Written a second and third time by hand, the reduced-motion arm and the safe-area padding are exactly the parts that get dropped, and neither omission is visible to a reviewer reading the diff.

This follows the rule the variant primitives already establish: a repeated visual pattern becomes typed props with a single application point, so a mistake is a type error rather than an element that renders wrong.

#### Scenario: A new overlay pane is added

- **WHEN** a surface needs to slide in over the app from an edge
- **THEN** it renders through the sheet primitive rather than declaring its own transform, scrim and open class

#### Scenario: Reduced motion is requested

- **WHEN** the operating system reports a reduced-motion preference
- **THEN** every sheet appears and disappears without a transition, without each caller opting in

#### Scenario: A sheet reaches a device safe area

- **WHEN** a sheet's content extends to the bottom edge on a device with a home indicator
- **THEN** the primitive supplies the safe-area padding, without the caller handling it

#### Scenario: A sheet's stacking order is chosen

- **WHEN** a sheet renders above the existing nav drawer and scrim layers
- **THEN** its stacking position is declared as part of the shared layer order rather than as an ad-hoc higher value at the call site

### Requirement: A centered dialog is a primitive, not a scrim with a click handler

A pane that opens centered over the app behind a scrim SHALL be rendered by a
shared modal primitive under `apps/web/src/design-system/components/`. A caller SHALL NOT
reproduce the pattern by writing its own backdrop element, dismissal handler and
panel container.

The primitive SHALL trap focus while open, mark the background inert, lock page
scroll, and dismiss on `Escape` as well as on the scrim.

This is the same requirement the sheet primitive above carries, for the other
half of the same pattern. The sheet case was covered because the omissions were
named; the centered case was not, and the omissions were the predicted ones.
`.cv-modal-back` was a `div` with an `onClick`: about ten surfaces — the
reference entity editor, material assets, the catalog libraries — opened a
dialog that did not trap focus, did not mark what was behind it inert, and could
not be dismissed from the keyboard. None of that was visible in a diff, and none
of it failed a test.

#### Scenario: A new centered dialog is added

- **WHEN** a surface needs to open a pane centered over the app
- **THEN** it renders the modal primitive rather than declaring its own backdrop, dismissal handler and panel

#### Scenario: A dialog opens

- **WHEN** a modal is open
- **THEN** keyboard focus is confined to it, the content behind it is inert, and the page behind it does not scroll

#### Scenario: The operator presses Escape

- **WHEN** a modal is open and `Escape` is pressed
- **THEN** it closes, without the caller wiring a key handler

#### Scenario: A hand-rolled backdrop is reintroduced

- **WHEN** a module under `components/` or `pages/` renders its own scrim-and-panel pair rather than the primitive
- **THEN** the structural check fails and names the file

### Requirement: Overlay components are app-owned; overlay mechanics are not reimplemented

Overlay components the web app renders — the edge sheet, the centered modal, the
image lightbox — SHALL live under `apps/web/src/design-system/components/`. Each SHALL take
its stacking order, focus ownership, key routing, background inertness and scroll
lock from `@maleo/vui/dom`, and SHALL NOT implement any of those five itself.

The split is between the JSX and the four hard questions underneath it. The JSX
is app-shaped: a reference entity editor is not editor chrome, and moving it into
a renderer-neutral video editor library inverts the dependency the workspace map
sets. The four questions are not app-shaped at all, and they are answered once in
`@maleo/vui/dom` as plain functions with no React and tests that need no
renderer.

Application routing concerns stay above the mechanism. The shared history entry
that makes the phone back button close a sheet is one: a library that manipulates
its consumer's history repeats the mistake that VUI's theme file already refuses
to make when it declines to declare tokens on `:root`.

#### Scenario: A new overlay component is written

- **WHEN** an overlay component is added to the web app
- **THEN** it registers with the shared overlay stack and uses the shared focus trap and scroll lock, rather than tracking open panes itself

#### Scenario: Two overlays are open at once

- **WHEN** a sheet is open above a modal and `Escape` is pressed once
- **THEN** only the innermost closes

#### Scenario: An app overlay orders itself against an editor overlay

- **WHEN** an app modal opens above a VUI sheet
- **THEN** their painting order comes from the shared registry rather than from which one mounted first

#### Scenario: An overlay component tracks its own stack

- **WHEN** a component under `design-system/components/` keeps its own list of open overlays, its own focus save-and-restore, or its own body scroll lock
- **THEN** the structural check fails and names it

#### Scenario: The back button closes a sheet

- **WHEN** a sheet is open on a phone and the operator presses the system back button
- **THEN** the sheet closes and the route is unchanged, and that behaviour is implemented in the app rather than in the package

### Requirement: VUI editor chrome is a typed primitive

Repeated video editor chrome for preview, transport, timeline, gutter, inspector rail, range bars, and mobile sheets SHALL be expressed through VUI typed primitives rather than copied app-local class conventions.

The primitives SHALL preserve the existing Maleo visual language while moving reusable structure into the VUI package. VUI SHALL provide default styles, and the app SHALL customize them through VUI tokens and slot hooks rather than by depending on private package DOM. App-specific theming, project media panels, and domain inspector content SHALL remain outside VUI.

#### Scenario: A new VUI-backed editor surface is added

- **WHEN** a new editor surface needs preview, timeline, and inspector chrome
- **THEN** it composes VUI primitives rather than copying `tl2-studio-*` or content editor markup into a new local shell

#### Scenario: Domain-specific content is rendered

- **WHEN** an inspector section needs Maleo-specific project, media, reference, or template fields
- **THEN** the consuming app supplies those fields as adapter content instead of adding Maleo imports to VUI

#### Scenario: Visual parity is checked

- **WHEN** existing editor surfaces are converted to VUI primitives
- **THEN** desktop visual behavior remains intentionally equivalent except for changes explicitly listed in this OpenSpec change

#### Scenario: Maleo overrides VUI defaults

- **WHEN** the web app consumes VUI primitives
- **THEN** it maps Maleo theme tokens into VUI custom properties instead of editing package default styles in place

### Requirement: Maleo video editors reuse VUI mechanics through adapters

Content editor, video-template editor, and custom-element/Motion Studio editor SHALL compose equivalent workspace, preview-stage, transport, inspector, modal/fullscreen, mobile-sheet, keyboard-ownership, and timeline mechanics from `@maleo/vui` rather than maintaining app-local copies.

App adapters SHALL retain domain schemas, persistence, validation, media, project references, generation, render submission, and renderer-specific content. When a surface needs behavior VUI does not expose, implementation SHALL add a neutral extension point or record why behavior is domain-specific; it SHALL NOT copy shared infrastructure under a new class vocabulary.

#### Scenario: Shared editor chrome changes

- **WHEN** workspace header, footer, transport, inspector rail, or mobile sheet behavior changes
- **THEN** all three editor surfaces receive equivalent behavior through one VUI implementation

#### Scenario: Motion Studio renders custom keyframes

- **WHEN** Motion Studio needs curve and keyframe visuals absent from default ranges
- **THEN** it supplies extension renderers to shared timeline mechanics rather than recreating ruler, gutter, playhead, scrolling, selection, and pointer lifecycle

#### Scenario: Content timeline keeps domain commands

- **WHEN** content editor moves, trims, reorders, or selects a clip
- **THEN** Maleo document writers remain mutation authority while VUI supplies reusable geometry and gesture events

#### Scenario: Duplicate infrastructure appears

- **WHEN** Maleo introduces a second app-local implementation of VUI-owned chrome or mechanics
- **THEN** structural reuse check fails and identifies duplicated owner

### Requirement: VUI adoption preserves renderer parity and domain ownership

Adopting VUI SHALL NOT create a second preview renderer or change persisted video-template, custom-element, timeline, storyboard, media, or project-reference contracts. Maleo Remotion previews SHALL continue to mount render components and props equivalent to export path.

#### Scenario: Template preview renders

- **WHEN** operator edits video template through VUI workspace
- **THEN** preview uses existing final-render composition and adapter-owned template projection

#### Scenario: Custom element saves

- **WHEN** operator edits and saves custom element through VUI workspace
- **THEN** existing composition schema, validation, and save API remain authoritative

#### Scenario: Content editor persists

- **WHEN** operator commits VUI gesture in content timeline
- **THEN** existing document command and persistence path receives mapped domain mutation

### Requirement: App styling uses VUI public theming contract

Maleo SHALL map app tokens onto documented VUI root custom properties and public slots. App styles SHALL NOT rely on undocumented VUI descendants or redefine package-owned structural layout except through supported mode and slot hooks.

#### Scenario: Maleo theme changes

- **WHEN** app color, spacing, typography, or elevation token changes
- **THEN** VUI-backed editors update through token mapping without editing package stylesheet

#### Scenario: App needs domain-specific decoration

- **WHEN** an editor range or inspector section needs Maleo-specific appearance
- **THEN** adapter uses documented renderer, slot, or class hook rather than private DOM selector

### Requirement: A repeated concept has one name

Where one visual concept is expressed by more than one class vocabulary, the web
client SHALL express it as a single primitive under
`apps/web/src/design-system/components/`, and the cluster-local spellings SHALL be retired
rather than kept as aliases.

Four spellings of a labelled form control are live: `cv-field` (33 sites),
`tl2-field` (29), `fc-cap-field` (20) and `settings-field`. Three of an advisory
line: `settings-note` (20), `tl2-dsec-note` (11), `settings-field-warn`. Three of
a small inline tag: `pill` (17), `fc-quickchip` (13), `fc-em-chip` (10).

Three more were named as members of those sets and turned out not to be, which is
the third scenario below doing its job rather than an exception to it.
`cv-provider-warning` has padding, a border and a background — a status banner,
not an advisory line. `tl2-ref-chip` is a grid with an avatar column and a
`.dropped` state — a reference card. `sc-flag` has no box at all — an advisory
line, so Note's family rather than Chip's. Each stayed where it was.

None of these is a variant of the others; they are the same component authored
repeatedly, in whichever cluster happened to need it next. The cost is that a
change to the concept is four or five edits, any of which can be missed with
nothing failing — which is the same failure mode the variant-as-a-prop
requirement already addresses one level down. A misspelled variant fails the
build today; a missed fourth copy of the whole component does not.

Retirement matters as much as the primitive. A cluster class kept as an alias
leaves the second way to write the component available and discoverable, and the
next author uses it.

#### Scenario: A concept is found under several names

- **WHEN** the census shows one visual concept expressed by more than one class vocabulary
- **THEN** it becomes one primitive, and the other spellings are removed rather than aliased

#### Scenario: A retired spelling is reintroduced

- **WHEN** a module writes a retired cluster class into a `className`
- **THEN** the structural check fails and names the file and the class

#### Scenario: Two spellings turn out to be two concepts

- **WHEN** two candidate spellings have genuinely different metrics or behaviour
- **THEN** they stay two primitives, rather than becoming one primitive with a variant that reproduces the split

### Requirement: Candidate membership is derived, not asserted

The repository SHALL maintain a re-runnable census reporting, for every class:
its defining stylesheet, its call-site count, and the set of source directories
that consume it. A class consumed by a directory outside its declaring cluster
SHALL be either promoted to a primitive or renamed to say where it belongs.
The census SHALL identify candidates; presence, call count, and cross-cluster
consumption SHALL NOT imply design-system approval.

Prefixes name where a component was born, not who uses it, and the three largest
have long since stopped being local: `cv-` ("create-content") is consumed by
seven directories and defines 569 rules; `tl2-` ("timeline v2") by six, defining
954; `fc-` by six, defining 472. Nothing reported that as it happened, so each is
now a shared vocabulary that reads as a private one — and a shared vocabulary
nobody is allowed to treat as shared gets copied instead of imported.

A count is not the test. `settings-` (115 rules) and `sc-` (73) are consumed only
by the directories that declare them and are correctly local; a smaller
cross-cluster class is the one that needs attention. The census reports the
directory set precisely so that promotion is decided on consumption rather than
on size.

The census SHALL fail when it finds no stylesheets, following the existing
collision scan: a scan that silently matches nothing is worse than one that
errors.

#### Scenario: A class spreads beyond its cluster

- **WHEN** a class defined in one cluster's stylesheet is used by a module in another cluster
- **THEN** the census reports it, and it is promoted or renamed rather than left

#### Scenario: A class is busy but local

- **WHEN** a class has many call sites, all within its declaring cluster
- **THEN** it is not a promotion candidate, because consumption rather than count is the test

#### Scenario: The census is asked which components are candidates

- **WHEN** candidate membership is questioned
- **THEN** it is answered by re-running the census, not by reading a document written when it last ran

#### Scenario: A widely used candidate is not yet approved

- **WHEN** the census reports a component across many directories
- **THEN** it enters candidate inventory but remains unapproved until `web-design-system-convergence` accepts its contract and representative-surface proof

#### Scenario: The census finds nothing

- **WHEN** the census scan discovers zero stylesheets or zero call sites
- **THEN** it exits with an error naming what it searched, rather than reporting a clean result

### Requirement: A component's appearance lives in classes and tokens

A component under `components/` or `pages/` SHALL express its appearance through
classes reading the token layer, and SHALL NOT write a literal colour into an
inline `style` object.

An inline style is not a formatting preference; it is a component that was never
named, and the consequence is that no check can reach it. The dead-rule check,
the dead-token check, the cluster-prefix check and the variant-class check all
read CSS or read `className`, so a `style` object is invisible to all four.

**Only the colour is enforced, and that is deliberate rather than a shortfall.**
A colour written outside the token layer is a defect — it cannot participate in
the palette and no check can see it. Spacing, radius and typography in a style
object are worth moving but are not wrong in the same way, and a rule that failed
on all of them would have to fail on 451 existing objects at once, which makes it
a rule nobody can land. The colour rule is enforced as a per-file debt list that
may only shrink: 18 literal colours across 7 files at the time of writing.

The remaining inline style objects are a standing number reported by the census,
not a solved problem. Reducing them is ordinary work, not a gate.

A computed value that cannot be a class remains legitimate — a measured width, a
`transform` from a drag position, a token name selected at runtime. Geometry
needs no explicit carve-out: the rule looks for colours, and a transform never
contains one.

#### Scenario: A component sets a literal colour inline

- **WHEN** a module writes a literal colour into a `style` object beyond its recorded debt
- **THEN** the structural check fails and names the file

#### Scenario: A component sets a computed geometric value

- **WHEN** a module sets a position, size or transform computed at runtime
- **THEN** the inline style is accepted, because no class can express it

#### Scenario: A primitive is written

- **WHEN** a component is added under `design-system/components/`
- **THEN** its appearance is a class in a stylesheet, so the ownership, liveness and token checks apply to it

### Requirement: A nesting hierarchy stays a hierarchy

Where the census finds several classes sharing a prefix, the web client SHALL
determine whether they are one concept or several tiers of a containment
hierarchy before collapsing them, and SHALL promote a hierarchy as separate
primitives.

`tl2-panel`, `tl2-dsec` and `tl2-ctl` share a prefix and read as three names for
"a box with a heading". They are not. `tl2-panel` is the rail container — it
carries `width: var(--tl2-panel-w)`, is a flex column, and becomes a sheet at
phone width through `tl2-panel-sheet`. `tl2-dsec` is a section within a panel
body, with a heading, an icon, a hint and a note. `tl2-ctl` is a single labelled
control — a label row, a value, a range input — with `tl2-ctl-grid`, `-row`,
`-fit` and `-text` arranging groups of them. Collapsing them would flatten a real
structure into one component with three unrelated jobs.

Read from the running DOM rather than from the stylesheets, the containment is a
hierarchy with **two entry points** rather than one chain. Section contains
Control, always. Section is NOT always inside Panel: the docked clip inspector
(`tl2-clippanel`) is a sibling of `tl2-panel`, because the editor renders the
inspector while the panel host renders the panel. The rail panels reach Section
through Panel; the inspector reaches it directly. That makes promoting three
members more clearly right, not less — these are not three sizes of one thing,
and they are not even reliably nested.

Conversely, a shared prefix is not evidence of kinship. `tl2-ctlpop` is a
popover; it shares four characters with `tl2-ctl` and nothing else, and SHALL be
renamed. Prefix similarity is what performs grouping in this codebase, so a name
that groups two unrelated things is a defect in the same way a wrong prefix is.

#### Scenario: Several classes share a prefix

- **WHEN** classes sharing a prefix are considered for promotion
- **THEN** their containment relationship is read from the stylesheets and the markup before they are merged

#### Scenario: The classes form a containment hierarchy

- **WHEN** one class contains another
- **THEN** each tier becomes its own primitive, whether or not every tier is reached through the same parent

#### Scenario: A name implies kinship that does not exist

- **WHEN** a class shares a prefix with an unrelated component
- **THEN** it is renamed, because the prefix is what the tooling and the reader group by

### Requirement: Stacked editor properties

The web editor SHALL place each PropertyRow label above its values at desktop and phone widths. Style and Project settings scan rows SHALL use the same label-above-value hierarchy while retaining source, inheritance and detail actions. Adjacent property actions SHALL remain outside wrapping labels and reachable by keyboard and touch.

#### Scenario: Narrow compound property

- **WHEN** an operator opens an inspector at 320px
- **THEN** labels appear above values, controls remain inside the pane, and adjacent actions wrap with touch targets of at least 44px

#### Scenario: Reset beside enabled property

- **WHEN** a navigation action is disabled but its value remains editable
- **THEN** the property remains enabled and its reset remains available

### Requirement: Filled text field surface

All ordinary text inputs, textareas and search fields SHALL use canonical filled field styling with the same resting semantic surface as numeric value inputs. Size SHALL affect density without selecting a different background. Composite search and prompt controls SHALL paint their wrapper and retain transparent internal entry.

#### Scenario: Consistent text entry

- **WHEN** an operator uses text, multiline, search and numeric fields in either theme
- **THEN** their resting backgrounds match the semantic filled value surface while labels, focus, disabled states and native editing remain available
