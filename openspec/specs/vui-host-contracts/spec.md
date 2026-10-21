# vui-host-contracts Specification

## Purpose

TBD - created by syncing change rebuild-vui-video-editor-library. Update Purpose after archive.

## Requirements

### Requirement: The consumer's document is the source of truth

The shared engine SHALL define the canonical versioned editing contract; every controller SHALL operate on that contract through an admitted document and command boundary. Host adapters SHALL convert supported legacy formats losslessly instead of maintaining independently writable mirrored schemas. Hosts SHALL own persistence IO and media resolution. A rejected edit SHALL restore the last accepted state and discard its transient projection.

#### Scenario: A consumer keeps its own schema

- **WHEN** an existing host supplies a supported legacy document through its compatibility adapter
- **THEN** admission and output preserve authored fields without creating a separately writable project model

#### Scenario: The consumer rejects an operation

- **WHEN** admission or execution declines an edit
- **THEN** projection returns to the last accepted document and the failure is reported without persistence or history mutation

### Requirement: The renderer is supplied by the consumer through one adapter

The library SHALL drive playback through a renderer adapter exposing dimensions, duration, timebase, readiness, current time, play state, and the commands to seek, play, and pause, with a subscription for changes. The library SHALL NOT depend on any specific renderer, and no renderer integration SHALL be reachable from the core, DOM, or React entry graphs.

#### Scenario: A consumer supplies a renderer the library has never seen

- **WHEN** a renderer adapter is implemented over a plain `<video>` element, a canvas, or a server-rendered proxy
- **THEN** transport, playhead, and seeking operate through it with no library change

#### Scenario: An integration's peer is absent

- **WHEN** a consumer imports the core, DOM, or React entry points without any renderer integration's peer dependency installed
- **THEN** the import succeeds, and reaching a renderer integration whose peer is missing fails with a diagnostic naming that peer

### Requirement: A controlled seek does not feed itself

The library SHALL prevent a seek it issues from being re-observed as an external time change and re-issued. A single external seek SHALL produce a bounded number of renderer commands and SHALL settle at the requested time.

#### Scenario: One external seek is issued

- **WHEN** a consumer seeks once to a position
- **THEN** the adapter receives one seek command, the final reported time is the requested position, and no feedback loop occurs

#### Scenario: Repeated seeks arrive during playback

- **WHEN** several distinct external seeks are issued while the renderer is reporting time updates
- **THEN** the number of renderer commands does not exceed the number of distinct requested positions

### Requirement: Adapters declare the contract version they implement

Every adapter SHALL declare the contract version it implements. The library SHALL accept a declared supported version and SHALL reject any other with a deterministic diagnostic naming the version it received and the versions it supports.

#### Scenario: An unsupported version is supplied

- **WHEN** an adapter declares a contract version the library does not support
- **THEN** the library refuses it and the diagnostic names both the received and the supported versions

### Requirement: A conformance kit ships, and it is what proves an adapter correct

The library SHALL export executable conformance suites for the renderer adapter and the document adapter. Each suite SHALL exercise the contract's stated behaviour, including its failure paths, against an implementation the consumer supplies.

"Bring your own renderer" without a suite the consumer can run is a claim rather than a contract.

#### Scenario: A consumer verifies their adapter

- **WHEN** a consumer runs the renderer conformance suite against their adapter
- **THEN** it passes only if the adapter satisfies readiness, time reporting, seek clamping, play and pause, subscription, and teardown

#### Scenario: An adapter breaks a rule

- **WHEN** an adapter reports time that does not settle after a seek, or leaks a subscription on teardown
- **THEN** the conformance suite fails and names the rule that was broken

#### Scenario: The first-party adapter is held to the same bar

- **WHEN** the repository's own Remotion adapter is tested
- **THEN** it is tested by the shipped conformance suite rather than by a separate private test

### Requirement: One overlay stack per host document

Web overlay painting order, focus ownership and key routing SHALL resolve through exactly one explicit registry per host document, relocated from VUI into the web-owned DOM mechanism layer. Registration SHALL declare order, modal and key-routing behavior rather than infer priority from mount order. No second overlay list SHALL exist in React presentation or migrated editor surfaces.

#### Scenario: An overlay opens

- **WHEN** any web editor overlay, sheet or workspace mounts
- **THEN** it registers with the shared web stack and uses its declared order

#### Scenario: A second stack is introduced

- **WHEN** a migrated module tracks open overlays independently
- **THEN** the structural gate fails and names that module

#### Scenario: A non-modal overlay is open above a modal one

- **WHEN** the top painted overlay does not take focus
- **THEN** painting order, focus ownership and key delivery are resolved separately

#### Scenario: The package's subpaths are bundled separately

- **WHEN** separately bundled web modules contain copies of the registry mechanism
- **THEN** they resolve to one registry per host document, preserving nested dismissal and focus behavior

### Requirement: A host that is not a VUI root can use the overlay stack

The overlay stack SHALL be usable by an overlay that portals outside
`[data-vui-root]`. Its stacking order SHALL be expressible without requiring the
consumer to adopt VUI's `--vui-z-*` scale for elements VUI does not paint.

The web app's sheets and modals portal to the document body and are styled from
the app's own token layer. If ordering the app's overlays against VUI's required
the app to declare itself a VUI root, the shared registry would buy nothing: the
app would keep its own stack and the two would race.

#### Scenario: An app overlay registers

- **WHEN** an overlay outside a VUI root registers with the stack
- **THEN** it is ordered against VUI's overlays without the host adopting VUI's root attribute or z-index scale

#### Scenario: Only VUI overlays are present

- **WHEN** no consumer overlay is registered
- **THEN** VUI's own overlays behave as they did before the registry was shared

### Requirement: An exported overlay component has a consumer

`@maleo/vui` SHALL NOT export an overlay component that no consumer renders. A
component that is exported, documented and tested but rendered nowhere reads as
the sanctioned way to do the thing, and the next author adopts it alongside
whatever else is already in use.

`VuiDialog` and `VuiSheetPanel` were exported from `react/index.tsx` and covered
by tests with no production call site anywhere in the workspace; they were
removed rather than left standing. This is the dead-surface failure the
repository already names for CSS rules and for design tokens, at the level of a
component: a dead export is worse than an absent one, because it is
discoverable.

#### Scenario: An overlay component has no renderer

- **WHEN** an exported overlay component is rendered by no module outside its own tests
- **THEN** it is either adopted by a consumer or removed, rather than left exported

#### Scenario: A mechanism has no component

- **WHEN** a `dom/` module has no React component wrapping it
- **THEN** it is not reported — the mechanism layer is deliberately renderer-free and is justified by the components that call it, wherever they live
