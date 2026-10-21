# vui-editor-package Specification

## Purpose

TBD - created by archiving change create-vui-package. Update Purpose after archive.

## Requirements

### Requirement: VUI exposes renderer-agnostic editor primitives

The successor shared editor engine SHALL expose host-free time, duration, playhead, timeline, selection, edit and command contracts. It SHALL NOT import client UI, browser APIs, provider IO, persistence IO or app routes. Canonical project types SHALL be independent of platform paths and UI objects. Web presentation SHALL live in the web app; it SHALL consume shared mechanics through an explicit binding rather than becoming the engine owner.

#### Scenario: Core VUI is imported in a non-React module

- **WHEN** a non-browser runtime loads the successor shared engine
- **THEN** its editing and time contracts are callable without React, Remotion, browser, network or persistence dependencies

#### Scenario: A domain object is edited

- **WHEN** a surface edits a scene, template range or motion layer
- **THEN** the host maps its interaction into shared commands and retains domain-specific behavior without importing its UI into the engine

### Requirement: VUI React workspace composes preview, timeline, inspector, and mobile sheets

The web-owned editor workspace SHALL compose preview, transport, timeline, gutter, inspector rail and mobile sheets through typed slots. Content, template and custom-element editors SHALL share composition while supplying domain timing, controls and preview adapters. Appearance SHALL follow current web editor patterns rather than former VUI default styles.

#### Scenario: The template editor uses VUI workspace

- **WHEN** the template editor opens after presentation migration
- **THEN** it uses the web-owned workspace with template timing and inspector controls

#### Scenario: The custom element editor uses VUI workspace

- **WHEN** Motion Studio or the custom-element editor opens after presentation migration
- **THEN** it uses the same web-owned composition with layer, keyframe and sublane behavior

### Requirement: Renderer integration is an adapter

VUI SHALL represent preview rendering through an adapter interface rather than requiring a specific renderer in core or React workspace primitives. The Maleo Remotion adapter SHALL provide preview component mounting, duration, dimensions, frame-to-second synchronization, playback controls, and seek updates.

#### Scenario: Maleo previews a video editor surface

- **WHEN** an Maleo VUI-backed editor previews content
- **THEN** the Remotion adapter supplies the mounted player and time synchronization while VUI supplies workspace, transport, and timeline mechanics

#### Scenario: A non-Remotion renderer is used

- **WHEN** a consumer supplies a renderer adapter that is not Remotion
- **THEN** VUI can still render the workspace and timeline as long as the adapter supplies preview rendering and time synchronization

### Requirement: VUI package has no app persistence authority

The VUI package SHALL NOT read or write Maleo project persistence, runtime data, editor state JSON, storyboard JSON, local databases, or media artifacts. Save/load and validation SHALL remain owned by the consuming editor surface.

#### Scenario: A range is resized

- **WHEN** the operator resizes a timeline range through VUI
- **THEN** VUI reports the proposed timing change and the consuming adapter decides how to clamp, validate, persist, or reject it

### Requirement: VUI avoids whole-editor rerenders on high-frequency state

VUI SHALL isolate high-frequency state updates so playhead ticks, pointer moves, timeline scrubs, range drags, and sheet state changes do not rerender unrelated preview, timeline, inspector, or adapter content.

The package SHALL expose state subscription or callback boundaries that allow consumers to subscribe by slice. Gesture-local transient state SHALL remain local to the primitive that owns the gesture unless another component must render it.

#### Scenario: Playback is running

- **WHEN** the playhead updates every frame during preview playback
- **THEN** only playhead-dependent surfaces update, and inactive inspector fields and unrelated editor panes do not rerender

#### Scenario: A range is dragged

- **WHEN** the operator drags or resizes a timeline range
- **THEN** VUI updates gesture visuals without rebuilding unrelated lanes, preview adapter props, or inactive inspector sections on every pointer move

#### Scenario: A sheet opens

- **WHEN** a mobile sheet opens or closes
- **THEN** VUI updates sheet chrome without forcing timeline lane projection or preview renderer remount

### Requirement: VUI supports mobile-scale timeline rendering

VUI SHALL provide rendering seams for large timelines, dense keyframe tracks, and long inspector panels so mobile surfaces can avoid mounting work the operator cannot see.

At minimum, VUI SHALL support collapsed/inactive inspector sections, memoized lane/range projection, and extension points for lane or keyframe virtualization when a surface has many tracks.

#### Scenario: A motion composition has many keyframes

- **WHEN** the custom element editor displays many layers or keyframe tracks
- **THEN** inactive sections and offscreen-heavy content can stay collapsed, lazy, or virtualized without changing the motion adapter's data model

#### Scenario: The template editor has many settings

- **WHEN** the template inspector contains many field groups on mobile
- **THEN** only the active or expanded groups need to mount interactive controls
