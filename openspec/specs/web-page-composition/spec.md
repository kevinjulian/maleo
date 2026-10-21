# web-page-composition Specification

## Purpose

TBD - created by archiving change restructure-web-role-first. Update Purpose after archive.

## Requirements

### Requirement: Every screen has a page module

The web client SHALL hold every screen it serves as a module under `apps/web/src/pages/`, and the set of files in that directory SHALL be the set of screens. A screen SHALL NOT be introduced by adding it inside a component cluster.

A page SHALL serve one route. The earlier allowance for one page over several routes existed for a single case — `create.tsx` served `/create` and `/content/:id` — and the reason was not that they were one screen but that preset-seeded editor state was not persisted at creation, so it survived only because React preserved the component instance across the navigation. Once that state is written with the project, the allowance is no longer earned. A flow that feels continuous to an operator is not evidence that it is one screen.

#### Scenario: A reader asks what screens exist

- **WHEN** someone opens `apps/web/src/pages/`
- **THEN** the filenames enumerate every screen the client serves, without opening a component or reading the router

#### Scenario: A new screen is added

- **WHEN** a screen is reachable by its own URL
- **THEN** it has a module in `pages/`, and the routing module maps a path to it

#### Scenario: Two routes share a component

- **WHEN** two routes render the same component because the flow between them feels continuous
- **THEN** they are separate pages, and whatever state was crossing between them is persisted or lifted rather than left to survive on the component instance

### Requirement: A page composes and owns route state only

A page module SHALL be limited to reading route parameters, choosing a layout, and composing components. A page SHALL NOT import from `api/`, and SHALL NOT contain business logic, data transformation, or persistence.

A page SHALL NOT mount machinery its screen does not use. The create form collects a type, a title, a description, a format and a preset; rendering it SHALL NOT instantiate the editor's document store, command stack, caption system, chat session, agent loop or autosave. Twelve hooks running unconditionally because the component body executes before it knows which screen it is on is the shape this forbids.

#### Scenario: A page needs data

- **WHEN** a page requires data from the api
- **THEN** it renders a component that calls a hook in `hooks/`, rather than calling `api/` itself, and the structural check fails on a direct `api/` import from `pages/`

#### Scenario: A page grows logic

- **WHEN** a page module accumulates transformation or persistence code
- **THEN** that code moves to `models/`, `stores/` or `hooks/` according to its kind, and the page keeps only the composition

#### Scenario: A form page is opened

- **WHEN** the create form renders
- **THEN** the requests it issues are the ones it needs to collect its fields, and no editor subsystem is constructed

### Requirement: Which screen is open is stored once, in the route

The web client SHALL derive the identity of the open screen from the route alone, resolved by the single routing module. Path-to-view mapping is pure string work and SHALL live in `apps/web/src/models/core/routing.ts`; the hook that syncs it to browser history SHALL live with its consumer. It has exactly one — the shell — so the one-consumer rule places it at `apps/web/src/app/history-sync.ts` rather than in a hooks cluster invented to hold it. `app` is not a clustered role, so a module at its root needs no new exemption. A component SHALL NOT hold a state variable that selects between screens, and SHALL NOT restate a fact the route already carries.

Routing is split because it was two kinds in one file. `services/routing.ts` exported `viewToPath` and `pathToView`, which take a string and return a value, alongside `useHistorySync`, which subscribes to `popstate` — and it sat outside every cluster rule by a named exception precisely because it matched no single kind. The pure half earns `models/core/` on its own merits: three clusters across three roles import `LibraryType` from it.

The route is already correct: `View` carries `{ kind: "content-edit"; id }` at `/content/:id`, and the shell passes that id into the editor. The defect is duplication, not absence — `CreateContent.tsx` holds `useState<Screen>` over `launch | setup | work | done` with five transition sites, encoding "the editor is open" a second time. The copies can disagree: `screen` initialises to `"launch"` whether or not the route supplied a project, and is corrected asynchronously.

#### Scenario: A route supplies a project

- **WHEN** the client renders a route that carries a project identifier
- **THEN** the editor is the screen from the first render, with no intermediate launcher state to correct afterwards

#### Scenario: A path is mapped without a browser

- **WHEN** a test converts a path to a view or a view to a path
- **THEN** it imports the mapping from `models/core/routing.ts` and runs without a DOM, a renderer or a history stub

### Requirement: A page delegates rather than accumulates

A page module SHALL stay under 200 lines. A page approaching that limit SHALL be reduced by moving composition into a component, not by raising the limit.

#### Scenario: A page exceeds the limit

- **WHEN** a module under `pages/` exceeds 200 lines
- **THEN** the structural check fails and names it, before it becomes the thing the page layer was introduced to break up
