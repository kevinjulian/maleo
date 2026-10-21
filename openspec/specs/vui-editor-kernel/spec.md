# vui-editor-kernel Specification

## Purpose

TBD - created by syncing change rebuild-vui-video-editor-library. Update Purpose after archive.

## Requirements

### Requirement: The kernel runs with no host

The kernel entry graph SHALL import no React, no React DOM, no Remotion, no browser global, no `fetch`, no persistence or filesystem API, no Bun API, and no Maleo package. It SHALL be importable and exercisable in a plain non-browser process.

A kernel that can reach a host API will eventually reach one, and every such reach is a place a consumer cannot substitute their own environment.

#### Scenario: The kernel is imported without a DOM

- **WHEN** the built kernel entry point is imported by a process with no `window`, no `document`, and neither React nor Remotion installed
- **THEN** the import succeeds and the kernel's reducers, geometry, and operations are callable

#### Scenario: A host import is introduced into the kernel

- **WHEN** a source file in the kernel entry graph imports a browser global, a host runtime API, or an Maleo package
- **THEN** the dependency gate fails and names the file and the import

### Requirement: State changes through a reducer, and effects are described rather than performed

Kernel state SHALL change only by applying an event to a reducer of the form `(state, event) => { state, effects }`. The kernel SHALL NOT perform side effects; it SHALL return them as serializable descriptions for a host layer to interpret.

Two owners on one pointer, and several imperative writers on one derived value, are the two structural failures this replaces. Both become unrepresentable when there is exactly one writer and exactly one interpreter.

#### Scenario: A gesture requests pointer capture

- **WHEN** the reducer accepts a gesture-begin event
- **THEN** it returns a `capturePointer` effect description rather than calling `setPointerCapture`

#### Scenario: An effect description is inspected

- **WHEN** any effect returned by the reducer is serialized
- **THEN** it round-trips through JSON without loss, and carries no function and no DOM reference

### Requirement: A derived value has exactly one writer

Each derived kernel value, including the viewport, SHALL be produced by exactly one reducer path. Inputs that influence it — scroll, resize, zoom, pan — SHALL be dispatched as events and SHALL NOT publish the derived value themselves.

The kernel SHALL NOT publish a derived value whose fields are equal to the currently published one.

The previous implementation had four publishers for the viewport, each constructing a fresh object; a resize observer re-armed on every publish and republished an equal value, producing an unbounded loop in which a zoom could be overwritten by a later scroll.

#### Scenario: An input produces no change

- **WHEN** an event resolves to a viewport whose start, end, and scale all equal the published viewport
- **THEN** no publication occurs and no subscriber is notified

#### Scenario: Two inputs arrive in one frame

- **WHEN** a scroll event and a zoom event are dispatched in the same frame
- **THEN** the published viewport reflects both, and neither overwrites the other with a value computed from a stale input

### Requirement: An interaction is a transaction that commits once or rolls back

The kernel SHALL model an interaction as a transaction with `begin`, `update`, and exactly one terminal `commit` or `rollback`. During the transaction it SHALL expose a projection that is not persisted. It SHALL reject a second terminal phase for the same transaction.

`commit` SHALL produce an operation. `rollback` SHALL produce none, and the projection SHALL be discarded.

#### Scenario: A transaction is cancelled

- **WHEN** a transaction receives `rollback`
- **THEN** no operation is emitted and the state observable to a consumer equals the state before `begin`

#### Scenario: A terminal phase is delivered twice

- **WHEN** a transaction that has already committed receives a second `commit` or a `rollback`
- **THEN** the kernel rejects it, emits no second operation, and reports the rejection

#### Scenario: A projection is read mid-transaction

- **WHEN** a transaction is between `begin` and its terminal phase
- **THEN** the projection reports the in-flight geometry and is distinguishable from committed state

### Requirement: Operations are serializable and invertible

Every operation the kernel emits SHALL be serializable, and SHALL carry enough information to produce its own inverse without consulting the document.

Undo, replay, and any future collaboration transport all depend on this, and it cannot be added later without redesigning every operation.

#### Scenario: An operation is inverted

- **WHEN** an operation is applied and then its inverse is applied
- **THEN** the resulting state equals the state before the operation was applied

#### Scenario: An operation crosses a process boundary

- **WHEN** an operation is serialized, transferred, and deserialized
- **THEN** applying it produces the same result as applying the original

### Requirement: Gesture engagement is an injectable policy

The kernel SHALL accept a recognizer that decides when a pointer gesture has engaged, and SHALL NOT hardcode a single engagement rule. The kernel SHALL supply default recognizers, and a consumer SHALL be able to supply a recognizer that requires distance AND duration, distance OR duration, or any other predicate over the observed samples.

The kernel SHALL NOT infer pixel distance from a time delta.

The previous contract could express only "threshold or hold", so the one consumer needing "threshold and hold" ran a second dead zone of its own, and two gates decided one question.

#### Scenario: A consumer requires distance and duration together

- **WHEN** a recognizer requiring both is supplied, and a pointer crosses the distance threshold before the hold elapses
- **THEN** the gesture is not engaged, and no `update` is reported to the consumer

#### Scenario: A sample carries no pixel distance

- **WHEN** a gesture event arrives without pixel evidence
- **THEN** it contributes zero distance, and engagement does not vary with the current zoom

### Requirement: Geometry answers with three boxes

For any item the kernel SHALL compute a `timeBox` describing its duration, a `paintBox` describing what is drawn, and a `hitBox` describing what is interactive. The `paintBox` SHALL carry a flag when it is wider than the `timeBox`. The `hitBox` SHALL meet a configured minimum and SHALL grow inward from the item's own edges, never overlapping a neighbour.

Geometry SHALL be pure, and SHALL be defined for zero duration, negative input, a viewport narrower than one item, and nested rows.

#### Scenario: An item is shorter than the interactive minimum

- **WHEN** an item's duration is smaller than the configured minimum hit size
- **THEN** its `hitBox` is expanded to the minimum, its `timeBox` is unchanged, and its `paintBox` reports that it is padded

#### Scenario: Two adjacent items each expand their hit area

- **WHEN** two items share an edge and both expand their hit boxes
- **THEN** neither hit box crosses the shared edge, and each item retains a reachable region that belongs to it alone

### Requirement: Capability is data, and the library renders no declined affordance

The kernel SHALL project, for each item, which interactions are available. A host layer SHALL NOT render an affordance whose capability is declined, and SHALL NOT rely on styling to hide one.

An affordance hidden with `display: none` retains its hit area and takes the press meant for the item beneath it. This was found twice in the previous implementation, on trim handles and on narrow clips.

#### Scenario: An item declines trimming

- **WHEN** an item's capability projection declines both resize edges
- **THEN** no handle element exists for that item, and a press at either edge reaches the item body

#### Scenario: A locked item is inspected

- **WHEN** an item's track is locked
- **THEN** every editing capability is declined, selection remains available, and the item reports itself read-only

### Requirement: Subscription is by slice

The kernel SHALL expose a store that notifies subscribers per slice, so that a change to one slice does not notify a subscriber of an unrelated slice. The store SHALL be usable from React without the kernel importing React.

#### Scenario: An unrelated slice changes

- **WHEN** a subscriber selects the current-time slice and an inspector-only value changes
- **THEN** the subscriber is not notified

#### Scenario: A selected slice changes

- **WHEN** the current-time slice changes
- **THEN** its subscriber is notified exactly once for that change
