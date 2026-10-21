# web-design-system-convergence Specification

## Purpose

What it takes for a UI component in this repository to be called approved, as
distinct from merely observed. The inventory records what exists; this records
what has been judged, on what evidence, and in what order — foundations before
components, contracts before approval, and representative surfaces driven before
either.

## Requirements

### Requirement: Candidate status does not imply approval

Every UI candidate SHALL have one disposition: candidate, approved,
retained-local, merged, replaced, or deprecated. Cross-cluster consumption and
call-site count SHALL identify review candidates but SHALL NOT approve them.

#### Scenario: Widely used component is inconsistent

- **WHEN** a component has many call sites but incomplete states or conflicting appearance
- **THEN** it remains a candidate until its contract and migration proof pass

#### Scenario: Local component has one domain job

- **WHEN** a component is used by one surface and has no shared product role
- **THEN** it is retained locally rather than expanded into a configurable primitive

### Requirement: Foundations are decided before component approval

The app design system SHALL define palette semantics, typography roles, spacing,
radii, elevation, motion, density, focus treatment, and responsive rules before
approving components that consume them.

#### Scenario: Candidate components disagree because foundations differ

- **WHEN** candidates use different type, spacing, or semantic-color rules
- **THEN** the foundation decision is made before choosing component variants

### Requirement: Approved components have complete contracts

An approved component SHALL define purpose, anatomy, variants, interaction
states, accessibility behavior, responsive behavior, and token usage. A variant
SHALL represent a real product distinction, not preserve an obsolete duplicate.

#### Scenario: Two candidates look similar

- **WHEN** two candidates appear similar but serve different semantics or behavior
- **THEN** their contracts decide whether they remain separate, not visual resemblance alone

#### Scenario: Variant only reproduces legacy styling

- **WHEN** a proposed variant exists only to preserve one duplicated implementation
- **THEN** that implementation is migrated or retained locally instead of becoming a variant

### Requirement: Shared patterns carry hierarchy

Recurring page chrome, form, toolbar, collection, feedback, and overlay structures
SHALL be expressed as documented shared patterns rather than reconstructed from
primitives independently on each surface.

#### Scenario: New collection surface is added

- **WHEN** a surface needs title, actions, search, filters, states, and collection content
- **THEN** it uses the approved collection pattern rather than choosing spacing and hierarchy again

### Requirement: Representative surfaces prove convergence

Settings, Library, and editor surfaces SHALL adopt affected approved foundations,
components, and patterns before approved-kit publication. Proof SHALL cover
desktop and phone widths, keyboard operation, and each affected interactive state.

#### Scenario: Component is proposed for approval

- **WHEN** a candidate is used by representative surfaces
- **THEN** those surfaces render and behave consistently at desktop and phone widths before approval

#### Scenario: Visual appearance changes intentionally

- **WHEN** convergence changes a baseline
- **THEN** the changed capture is grouped by cause, inspected, and recorded before refresh

### Requirement: App and VUI preserve separate ownership

App and VUI SHALL remain separate theming systems. App surfaces SHALL consume VUI
through documented tokens and slots; convergence SHALL NOT move app-specific
panels into VUI or expose VUI styling on global `:root`.

#### Scenario: Editor pattern spans app and VUI

- **WHEN** an editor surface combines app domain content with VUI chrome
- **THEN** app content stays app-owned and visual alignment uses VUI public theming hooks

### Requirement: Common controls use one approved visual grammar

The web client SHALL render common buttons, form controls, navigation controls, and feedback patterns through shared, approved component contracts across shell, Content, Library, Settings, chat, and editor chrome. Each contract SHALL use the canonical app theme and SHALL cover its rendered sizes, variants, disabled and busy states, focus, and phone layout.

#### Scenario: Same control appears on two surfaces

- **WHEN** the same control role appears on two app surfaces
- **THEN** both surfaces use the shared component contract and semantic theme values, with differences expressed by documented variants

#### Scenario: Theme changes

- **WHEN** the app switches between light and dark themes
- **THEN** shared controls retain readable text, borders, focus treatment, and state feedback in both themes

### Requirement: Whole surfaces migrate without duplicate generic vocabularies

The web client SHALL migrate each affected surface as a complete interaction flow before retiring its old generic control styling. A retired generic control class SHALL have no rendered callers. Domain-specific timeline and storyboard controls SHALL retain their product behavior while shared chrome adopts approved app controls.

#### Scenario: Surface migration completes

- **WHEN** a surface is marked migrated
- **THEN** its normal, loading, empty, error, disabled, and interactive states use approved shared controls where those roles exist

#### Scenario: Generic class is retired

- **WHEN** a legacy generic control class is removed
- **THEN** no rendered app control still depends on that class

#### Scenario: Editor control has domain behavior

- **WHEN** a timeline or storyboard control needs specialized gesture or time behavior
- **THEN** that behavior remains available after surrounding chrome adopts shared controls

### Requirement: One editor workspace appearance

The project timeline editor, template editor, and Motion Studio SHALL use the project timeline editor's pane surfaces, borders, spacing, preview housing, and inspector chrome as their common default appearance. Editor-specific content geometry and embedded, modal, and fullscreen housing SHALL remain supported without separate visual themes.

#### Scenario: Desktop editor workspaces

- **WHEN** an operator opens each of the three editors on desktop
- **THEN** their panes use the same surfaces, borders, radii and spacing, and each preview fits its pane without template-specific framing or fixed preview height
- **AND** each editor retains its tools, timeline, inspector and save or close actions

#### Scenario: Phone editor workspaces

- **WHEN** an operator opens each editor at 320px or with a coarse pointer
- **THEN** its preview, timeline, inspector sheet and persistent actions remain reachable without horizontal page overflow
- **AND** focus, dismissal, native scrolling and touch targets remain available

#### Scenario: Timeline geometry remains stable

- **WHEN** an operator resizes the project timeline panes and reloads
- **THEN** saved pane shares and aspect-fit preview behavior remain intact

#### Scenario: Timeline bodies share editor styling

- **WHEN** an operator opens the project, template and motion timelines
- **THEN** rulers, tick labels, gutters, rows, clips and selected states use the project editor's shared timeline styling
- **AND** studio rows use the existing compact density and adjacent clips have distinct filled hues from the shared clip palette
- **AND** template edges remain resizable, Motion keyframes remain editable, and painted row geometry agrees with pointer targeting on desktop and phone

#### Scenario: Inspector icons and sections match

- **WHEN** an operator opens each editor inspector
- **THEN** category icons use the project editor glyph size and rail button size
- **AND** section headers and bodies use the same typography and spacing

#### Scenario: Studio modal housing uses standard chrome

- **WHEN** a template or Motion Studio opens in desktop modal mode
- **THEN** its backdrop, shell geometry, title sizing, header spacing and close control use the canonical Modal appearance, with the editor's media-black housing behind its theme-colored panes and theme-colored header and footer
- **AND** workspace focus containment, Escape/scrim dismissal and opener restoration remain intact
- **AND** compact fullscreen remains edge-to-edge

#### Scenario: Final studio timeline row remains reachable

- **WHEN** studio timeline lanes exceed its modal pane height
- **THEN** the lanes and gutter scroll vertically together with labels and clips aligned
- **AND** the timeline toolbar and ruler remain visible above the scrolling lanes
- **AND** the final row can be brought fully above the footer

#### Scenario: Inspector fields stay concise

- **WHEN** an operator opens a Template or Motion Studio inspector section
- **THEN** labels and controls appear without explanatory hint paragraphs or captions
- **AND** errors and editable fields remain visible
