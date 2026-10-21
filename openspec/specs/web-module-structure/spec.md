# web-module-structure Specification

## Purpose

How `apps/web/src` is organised, and why the organisation is checked rather than
agreed. It names the four layers a module can belong to, the direction imports
may point, the boundary between features, the rule that a shared concern has one
home, and the size ceiling for a file.

These are enforced by `apps/web/scripts/check-layers.ts`, because none of them
are visible to the type checker or the test suite: a `domain` module importing a
component is legal TypeScript that passes every test.

## Requirements

### Requirement: Every web module belongs to one named layer

The web client SHALL organise `apps/web/src` into nine top-level role directories with fixed meanings: `app` holds the shell (entry, server, root component, global chrome, global stylesheets); `pages` holds one module per route; `components` holds React components; `hooks` holds React hooks; `stores` holds `useSyncExternalStore` stores and their write surfaces; `api` holds HTTP wiring and the modules that compose it; `controllers` holds interaction mechanics that drive the browser without React, such as the gesture surface, the effect interpreter, the overlay stack, keyboard routing, focus and scroll writing; `services` holds long-lived browser capabilities without React, one capability per cluster, such as the media summary pipeline and canvas paint; `models` holds pure TypeScript with no React import and no network call. A module SHALL sit in exactly one role directory, and the first path segment under `src/` SHALL be that role's name.

Every role name SHALL state a kind. There SHALL NOT be a role whose meaning is "none of the others": the earlier `services` held hooks, stores, HTTP wiring and nine unclassified modules at once, and both of the structural check's workarounds — the longest-prefix rank rule and the role-root exception set — existed only to keep that arrangement legal. `services` returns with one checkable meaning instead: a module in it imports no React, no `hooks`, `stores`, `api` or `controllers`, and each cluster names the one capability it provides. `controllers` and `services` are split because an interaction mechanism reacts to input and may use a capability, while a capability never reacts to input; the same split is used by OpenCut's `controllers` and `services`.

A module SHALL export one kind. A module that exports a pure transform beside a network call, beside a hook, or beside a React component SHALL be split along that boundary rather than filed under whichever kind is larger. Five such modules existed in `services/` when this requirement was written, one of which recorded the mix in its own header comment; `components/editor/mention-textarea.tsx` is the same defect in the component layer, exporting five pure string-and-array functions beside the textarea that calls them.

`hooks`, `components`, `models`, `controllers` and `services` SHALL group their modules into a second level named by domain noun (for example `timeline`, `references`, `clip-templates`, `storyboard`, `editor`, `overlay`, `media`), and SHALL NOT hold source modules at their root. `api` and `stores` SHALL be flat: their contents are uniform and already named by domain, so a directory per module would restate the filename. This is the same exemption that keeps `models/clip-templates/` flat at 41 files.

#### Scenario: A pure function has a home outside the component tree

- **WHEN** a module computes a result from its arguments without React or fetch, such as clip layout or caption timing
- **THEN** it lives under `models/<cluster>/` and its file is importable by a test that renders nothing

#### Scenario: A module that mixes layers is split before it lands

- **WHEN** a single file both issues a request and renders a component
- **THEN** the request moves to `api/` and the file that remains in `components/` imports it

#### Scenario: A module exports two kinds

- **WHEN** one module exports both a pure function and a hook, both a pure function and a network call, or both a pure function and a React component
- **THEN** it is split so each export sits in the role matching its kind, rather than the whole file being filed under one of them

#### Scenario: A pure rule is only testable through a renderer

- **WHEN** a rule such as mention matching or reference filtering can only be exercised by mounting the component that calls it
- **THEN** the rule moves to `models/` and is tested directly, because needing a renderer to test a string function is evidence of the misplacement, not a property of the rule

#### Scenario: A layer's location is readable from the path

- **WHEN** a reader opens any file under `apps/web/src/`
- **THEN** the first path segment names the role that file belongs to, and for a clustered role the second names its cluster

#### Scenario: A module is dropped at a clustered role root

- **WHEN** a source module is added directly under `components/`, `models/`, `hooks/`, `controllers/` or `services/` without a cluster directory
- **THEN** the structural check fails and names the file, because a role root with loose modules is how an unclassified bucket starts

#### Scenario: A module is added to a flat role

- **WHEN** a source module is added directly under `api/` or `stores/`
- **THEN** the structural check accepts it, because those roles are flat by declaration rather than by omission

#### Scenario: A browser mechanism has a home

- **WHEN** a module drives the browser without React, such as pointer capture on the timeline surface or the registry deciding which overlay owns `Escape`
- **THEN** it lives under `controllers/<cluster>/`, and a React component or hook that needs it imports it rather than reimplementing it

#### Scenario: A service imports React or app state

- **WHEN** a module under `services/` imports React, or anything under `hooks/`, `stores/`, `api/` or `controllers/`
- **THEN** the structural check fails and names the import, because a capability that reaches app state or input handling is no longer one capability

### Requirement: Layer dependencies point one direction

The web client SHALL allow imports only in the direction
`pages -> components -> design-system -> hooks -> stores -> api -> controllers -> services -> models`. A `models` module SHALL NOT import from any other role. A `services` module SHALL NOT import from any role but `models`. A `controllers` module SHALL NOT import from `api`, `stores`, `hooks`, `design-system`, `components`, or `pages`. An `api` module SHALL NOT import from `stores`, `hooks`, `components`, or `pages`. A `stores` module SHALL NOT import from `hooks`, `components`, or `pages`. A `hooks` module SHALL NOT import from `components` or `pages`. A `components` module SHALL NOT import from `pages`. The repository SHALL enforce this direction with a check that runs outside the reviewer's judgement.

Rank SHALL be resolved by the first path segment alone. The previous longest-matching-prefix rule existed solely to rank `services/api` below the rest of `services`; once `api` is a role, the rule has nothing left to resolve and is removed rather than kept for a case that no longer exists.

`controllers` and `services` rank below `api` and `stores` so that a browser mechanism cannot read application state or issue a request: what it needs arrives as arguments, which is what keeps it usable by every editor surface rather than one.

Separating `stores` from `hooks` makes an existing property checkable rather than incidental. No store imported a hook at the time this requirement was written, and nothing would have caught that becoming false.

#### Scenario: A domain module cannot reach upward

- **WHEN** a `models/` file adds an import from `api/`, `stores/`, `hooks/`, `components/`, or `pages/`
- **THEN** the layering check fails and names the offending import

#### Scenario: A component cannot reach a page

- **WHEN** a module under `components/` imports from `pages/`
- **THEN** the layering check fails, because a component that knows its page is not reusable across pages

#### Scenario: HTTP wiring cannot reach a hook

- **WHEN** a module under `api/` imports from `hooks/` or `stores/`
- **THEN** the layering check fails, because that is the cycle the api/state split exists to prevent

#### Scenario: A store cannot reach a hook

- **WHEN** a module under `stores/` imports a `use-*` module from `hooks/`
- **THEN** the layering check fails, because a store that depends on a hook can only be read from inside a render

#### Scenario: The check runs without a reviewer

- **WHEN** the repository's verification commands run
- **THEN** the layer-direction check is one of them, and a violation fails it rather than producing advice

#### Scenario: A controller reaches application state

- **WHEN** a module under `controllers/` imports from `stores/`, `api/` or `hooks/`
- **THEN** the layering check fails, because a mechanism that reads app state stops working for the surface that holds different state

#### Scenario: A controller uses a capability

- **WHEN** a module under `controllers/` imports a module under `services/`
- **THEN** the check accepts it, and the reverse import fails

### Requirement: Imports resolve through stable aliases

The web client SHALL define TypeScript path aliases `@app/*`, `@pages/*`, `@components/*`, `@design-system/*`, `@hooks/*`, `@stores/*`, `@api/*`, `@controllers/*`, `@services/*` and `@models/*` and SHALL use them for any import that crosses a top-level directory. A cross-directory relative import chain SHALL NOT appear in source. An alias SHALL NOT be declared for a directory that does not exist.

The alias table SHALL have one home. `tsconfig.json` declares the paths and the bundler resolves them from that declaration; a second alias table SHALL NOT be introduced, because two tables drift and only one of them is type-checked.

#### Scenario: A module moves between directories

- **WHEN** a file is relocated to a different cluster or role
- **THEN** its importers keep working because they referenced an alias, and only the moved file's own relative imports change

#### Scenario: The bundler agrees with the type checker

- **WHEN** the web server builds and serves the client
- **THEN** the aliases resolve identically in the bundler and in `bun run typecheck`, because both read the same declaration

#### Scenario: An alias outlives its target

- **WHEN** a path alias in `tsconfig.json` resolves to a directory that does not exist under `src/`
- **THEN** the alias is deleted rather than left in place, because a resolver entry with no target silently accepts imports that can never load

### Requirement: Tests sit beside the module they cover

The web client SHALL colocate each test with its subject as
`<module>.test.ts` or `<module>.test.tsx` in the same directory. A test SHALL
move together with the module it covers. A test file SHALL have exactly one subject module.

#### Scenario: A module is relocated

- **WHEN** a module moves to a new role or cluster directory
- **THEN** its test moves in the same commit and still resolves its subject by a relative import

#### Scenario: A test reaches across layers

- **WHEN** a `models/` test needs a React renderer or a network stub to run
- **THEN** the module under test is misplaced and moves to `hooks/`, `stores/`, `api/` or `components/` according to its kind

#### Scenario: One test file covers several modules

- **WHEN** a test file imports subjects from more than one module
- **THEN** it is split so each subject has a test beside it, because a test that names one module and covers five gives no signal about where a failure lives

### Requirement: New files stay under the size ceiling

The web client SHALL keep every source file at or under 800 lines, stylesheets
included. There SHALL be no exception list: the mechanism that allowed one was
deleted along with its last entry, because an exception list with nothing in it
is an invitation to add one.

A file over the ceiling SHALL be decomposed along its layer or ownership
boundary rather than by arbitrary line count, and the decomposition SHALL
preserve behaviour.

Ownership, not props, decides where a boundary falls. A region is separable
when the state it needs can travel with it; what remains crossing the boundary
SHALL be the values the rest of the module derives, and shared stores SHALL be
read directly rather than threaded through. A component that would take sixty
props has been renamed, not decomposed.

The structural check SHALL report the files closest to the ceiling alongside its
success result, in the same way it reports the cross-cluster count. A limit that
only speaks at 801 lines is a trailing indicator: it fires while someone is doing
unrelated work, and the decomposition then competes with whatever change is in
flight. `timeline-editor.tsx` was found at 796 and `timeline-tracks.tsx` at 740 —
both by hand, and the first with four lines to spare. Reporting the headroom
makes the next one visible before it is urgent, without failing a build for a
file that is merely large.

#### Scenario: A file lands over the ceiling

- **WHEN** a source file exceeds 800 lines
- **THEN** the structural check fails, naming the file and its line count, and the author splits it — there is no list to add it to

#### Scenario: A file approaches the ceiling

- **WHEN** the structural check passes
- **THEN** it reports the files nearest the ceiling and their headroom, so the next split is chosen deliberately rather than forced by an unrelated edit

#### Scenario: An editor screen is decomposed

- **WHEN** a component such as the timeline editor is split
- **THEN** panels, hooks and pure computation move to their layers, and the visible behaviour is verified in the running app before the split is accepted

#### Scenario: A region's state is read elsewhere

- **WHEN** a candidate region depends on state the rest of the module also reads
- **THEN** that state stays where it is and is passed in, rather than moving down and being published back up; the timeline's zoom stayed with the editor for exactly this reason, while its hover cursor and marquee moved

#### Scenario: A prop bag is typed

- **WHEN** an extracted component takes a bag of actions or derived values
- **THEN** the entries are typed from the source that produces them, not by restating the signature, because a hand-copied signature is a second source of truth that drifts without failing anything

### Requirement: Editor chrome lives in a store, not in component state

A surface whose panels need many small pieces of chrome — which rail is open, which mode is showing, what the save state is, whether a menu is expanded — SHALL hold them in a `useSyncExternalStore` store with per-field subscription, and its components SHALL read what they need rather than receive it.

The reasoning is already recorded in `stores/editor-chrome-store.ts`: threading that state as props produces a component signature that is the same coupling with more typing, and a single context re-renders every consumer on any change. What the timeline learned applies to the shell above it, which still holds eighteen `useState` calls and therefore cannot give any region away without handing it twenty props.

Transient per-gesture state — a drag in flight, a hovered element, an open context menu — SHALL NOT go in the store. It dies with the interaction, nothing else reads it, and storing it only widens what can notify.

#### Scenario: A region is extracted from a large component

- **WHEN** a region is pulled out of a container and would need more than a handful of chrome values to work
- **THEN** those values move to the chrome store and the extracted component subscribes, rather than the values becoming props

#### Scenario: Chrome is added

- **WHEN** a new piece of chrome state is introduced on a surface that has a store
- **THEN** it goes in the store, so the next extraction does not have to move it

#### Scenario: A gesture holds state

- **WHEN** state exists only for the duration of a pointer interaction
- **THEN** it stays local to the component that owns the gesture and does not enter the store

#### Scenario: A stylesheet is split

- **WHEN** a stylesheet is split into more than one file
- **THEN** the parts are combined through a single entry sheet whose `@import` order is explicit, because separate `<link>` tags do not guarantee the relative order the cascade depends on

#### Scenario: A rule shares a selector with another rule

- **WHEN** a selector is defined more than once in a sheet and the later definition is the one that renders
- **THEN** both definitions move together, in their original order, into the same sheet; splitting the pair across two sheets swaps which one wins

### Requirement: The structure document tracks the structure

The web client SHALL keep `apps/web/src/AGENTS.md` describing the role vocabulary, the cluster list, and the dependency direction that the code actually has. A change that moves modules SHALL update that document in the same pass.

#### Scenario: Ownership documentation drifts from the tree

- **WHEN** a directory named in the ownership or child-index section no longer exists
- **THEN** the document is corrected in the change that moved it, not in a later cleanup

### Requirement: Source file names use one convention

The web client SHALL name every source module in kebab-case (`timeline-editor.tsx`, not `TimelineEditor.tsx`), matching the directory and stylesheet naming already in use. The structural check SHALL enforce this.

A convention that lives only in reviewers' heads is decided per file by whoever writes it; the client currently holds 23 PascalCase modules and roughly 60 kebab-case ones, several pairs of them in the same directory.

#### Scenario: A new component is added

- **WHEN** a module is added whose filename contains an uppercase letter
- **THEN** the structural check fails and names the file

#### Scenario: A component name differs from its filename

- **WHEN** `components/timeline/timeline-editor.tsx` exports a component named `TimelineEditor`
- **THEN** that is correct and unchanged; the convention constrains filenames, not identifiers

### Requirement: A shared module earns its place by having more than one consumer

The web client SHALL place a module in a cluster owned by its consumers wherever one exists. A module SHALL live in `models/core/` only when at least two other clusters import it. A `models/core/` module whose importers all belong to a single cluster SHALL move into that cluster.

The same test governs `components/`. A component read by two or more clusters belongs in `design-system/components/`; a component read by one cluster belongs in that cluster, whichever cluster it was first written next to. A feature cluster SHALL NOT hold a module that feature does not use: `components/editor/clip-canvas.tsx` had five importers under `components/timeline/` and none under `components/editor/`, and `atoms.tsx` served three clusters from a feature directory while `design-system/components/` held three files.

A module SHALL NOT be named for the size or generality of its contents. `atoms` and `shared` are the same kind of name — they describe how big a thing is rather than what it is, so nothing is ever wrong to add to them, which is the property that makes a bucket. A module is named for what it is; a directory of six primitives is six modules.

This replaces the withdrawn `shared/` requirement with a checkable condition. `shared/` failed not because the idea was wrong but because it had no membership test, and three of its modules — the router, the billing client, and the asset-url resolver — ended up outside every enforced rule.

There SHALL be no standing exception for a module that has no cluster. The structural check previously exempted `services/routing.ts` and `services/credits.ts` by name; on inspection they were not one kind needing an exception but two different kinds needing classification — `credits.ts` issues requests and belongs in `api/`, while `routing.ts` mixed a pure path mapping with a history-syncing hook and splits between `models/core/` and the shell that is its only consumer. An exception list that names modules is evidence they were never classified.

#### Scenario: A helper is used by one cluster

- **WHEN** a module in `models/core/` is imported only by modules under `models/timeline/` and `hooks/timeline/`
- **THEN** it moves into the timeline cluster, because a single-consumer module in a shared bucket is a coupling nobody declared

#### Scenario: A component is read by two clusters

- **WHEN** a component under `components/<feature>/` is imported by two or more clusters
- **THEN** it moves to `design-system/components/`, because the feature directory is not where a shared primitive lives — it is only where its first caller was

#### Scenario: A component is read only by a cluster that is not its own

- **WHEN** every importer of a module under `components/<feature>/` sits outside that feature
- **THEN** it moves to the cluster that reads it, because a feature directory holding a module the feature never imports is a bucket forming

#### Scenario: A module escapes classification

- **WHEN** a module sits at the root of a clustered role directory rather than in a cluster
- **THEN** the structural check fails, because that is exactly how `shared/asset-url.ts`, `shared/credits.ts` and `shared/history-sync.ts` came to sit outside all three import rules

#### Scenario: A module has no obvious cluster

- **WHEN** a new module does not fit any existing cluster in its role
- **THEN** it is classified by kind and given a cluster, and SHALL NOT be added to an exception list — the check carries no list of exempt module names

### Requirement: Cross-cluster coupling is counted

The structural check SHALL report the number of imports that cross a second-level cluster boundary within the same role, and SHALL NOT fail on them. An import that crosses a ROLE boundary SHALL NOT be counted: a downward role import is the layering the direction rule requires, not coupling the count exists to expose.

Withdrawing the feature boundary removes the mechanism that kept clusters apart. Counting the coupling makes its growth visible before it is load-bearing, so reintroducing a boundary — or extracting a cluster into a package — stays an informed decision rather than an archaeology exercise.

The check SHALL compare clusters only after establishing that both sides share a role. Comparing qualified `role/cluster` names as strings counts `components/timeline -> design-system/components` and `models/timeline -> models/core` identically, which is what the same-role scope already excluded in words but not in code: 532 of 796 reported edges crossed a role. A number two thirds composed of legal layering cannot support the decision it exists to inform.

#### Scenario: The check runs

- **WHEN** `bun run check:layers` completes without violations
- **THEN** it prints the same-role cross-cluster import count alongside its success result

#### Scenario: A downward role import is not coupling

- **WHEN** a module under `hooks/timeline/` imports a module under `stores/` or `models/core/`
- **THEN** the count does not increase, because the import crosses a role in the permitted direction

#### Scenario: Coupling grows

- **WHEN** a change raises the same-role cross-cluster count
- **THEN** the build still passes, and the number is available to the reviewer as evidence rather than as an opinion

#### Scenario: A recorded baseline is comparable

- **WHEN** the counted scope changes
- **THEN** the change that alters it records the new baseline and the reason in `AGENTS.md`, so a later reader does not compare two numbers that measured different things

### Requirement: State with no reader is deleted, not suppressed

A `useState` whose value is never read SHALL be removed, together with the calls
that write it. It SHALL NOT be retained behind a `void` statement or an
equivalent suppression.

`timeline-tracks.tsx` declared `hoveredClipId`, wrote it from every clip's
`onPointerEnter`, and read it nowhere — the line after the declaration was
`void hoveredClipId;`. The suppression is the whole problem: the unused-value
warning is the one signal that distinguishes "state about to be used" from
"state that has stopped being used", and silencing it leaves a setter firing on
every pointer crossing, re-rendering a 740-line component to produce a value
nothing consumes.

The rule covers store subscriptions, where it matters more. A component that
writes a chrome field but never renders it SHALL take a setter rather than a
`[value, setter]` pair, because the pair subscribes: `timeline-tracks.tsx` held
four such fields and voided all four, so it re-rendered whenever any surface
opened an edit popover, and `timeline-stage.tsx` held three more. A local
`useState` costs a render when this component writes it; a subscription costs
one when anything anywhere writes it.

A suppression is acceptable only where the value is genuinely required by an API
whose contract the compiler cannot see, and then the reason SHALL be stated at
the site.

#### Scenario: A state value loses its last reader

- **WHEN** the last consumer of a `useState` value is removed
- **THEN** the state and its setters are removed with it, rather than the declaration being kept and voided

#### Scenario: A writer outlives its reader

- **WHEN** a setter is called from an event handler and no code reads the value
- **THEN** both the setter call and the state are deleted, because the write is a render pass bought for nothing

#### Scenario: A component writes a shared field it does not render

- **WHEN** a component sets a store field and never reads it
- **THEN** it takes a setter without subscribing, so it does not re-render when another surface changes that field

#### Scenario: A suppression is genuinely needed

- **WHEN** a value must exist to satisfy an API the compiler cannot verify
- **THEN** the suppression carries a comment naming that API, so a later reader can tell it from an oversight

### Requirement: The design system is a layered boundary

The web client SHALL hold its design system under `apps/web/src/design-system/`, ranked between `hooks/` and `components/` in the import order, with four internal layers: `tokens/` and `icons/` as leaves, `components/` above them, and `patterns/` above components. A module in the design system SHALL NOT import from `components/`, `pages/` or `stores/`, and SHALL NOT import a higher internal layer. A module outside the design system SHALL NOT import a behaviour primitive package (`@base-ui/react`) directly, except for exceptions listed with their reason in the structural check.

#### Scenario: A feature reaches for a behaviour primitive

- **WHEN** a module under `components/` or `pages/` imports from `@base-ui/react`
- **THEN** `bun run check:layers` fails and names the module, unless it is a listed exception

#### Scenario: A component depends on a pattern

- **WHEN** a module under `design-system/components/` imports a module under `design-system/patterns/`
- **THEN** `bun run check:layers` fails and names both modules

#### Scenario: The design system reads application state

- **WHEN** a module under `design-system/` imports from `stores/`
- **THEN** `bun run check:layers` fails and names the module

#### Scenario: A domain control sits with its domain

- **WHEN** a control needs a domain model to render, such as the image provider select
- **THEN** it lives in that domain's cluster under `components/` and composes design-system components
