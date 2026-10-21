# defaulter-library-surfaces Specification

## Purpose

TBD - created by archiving change defaulter-element-provenance. Update Purpose after archive.

## Requirements

### Requirement: Every family of defaulters is viewable from the library

The library SHALL offer user-facing surfaces for Project Presets and Video Templates as default-producing records. Project Presets SHALL be presented as reusable starting bundles of Project Materials plus Video Template. Video Templates SHALL be presented as reusable video structure and timing policy.

Materials SHALL be presented as generation context and may be reusable. Fixture Materials SHALL be visible as read-only shipped Materials when they are used by shipped Project Presets. Elements SHALL be presented as placeable timeline building blocks. Custom Elements SHALL be presented as user-authored Elements, not as a defaulter family and not as a default source.

A default-producing record SHALL NOT be reachable only from inside an editor panel. An operator SHALL be able to list, inspect, and fork editable copies of fixture Project Presets, Materials, and Video Templates without opening a project.

#### Scenario: Project presets have a library surface

- **WHEN** an operator opens the library
- **THEN** Project Presets are listed there as Materials plus Video Template bundles
- **AND** fixture presets are visible as read-only shipped rows

#### Scenario: Materials have a library surface

- **WHEN** an operator opens Library > Materials
- **THEN** reusable user-owned Materials and read-only fixture Materials are listed according to their role and scope

#### Scenario: Video templates have a library surface

- **WHEN** an operator opens the library
- **THEN** Video Templates are listed there as reusable video structures
- **AND** fixture templates are visible as read-only shipped rows

#### Scenario: Elements include custom elements but are not defaults

- **WHEN** the library presents Elements
- **THEN** it describes them as placeable timeline building blocks
- **AND** user-authored Custom Elements appear as one group of Elements
- **AND** it does not describe Elements or Custom Elements as default sources

#### Scenario: Library top-level concepts are clear

- **WHEN** the library navigation is presented
- **THEN** the top-level creative surfaces are Project Presets, Materials, Video Templates, Elements, References, and Voices

### Requirement: The editor and the library present a defaulter through one implementation

A defaulter's editing surface SHALL be one implementation, presented both as a library page and,
where the editor offers in-place editing, as a panel or drawer inside the editor.

The system SHALL NOT maintain a separate editor-only implementation of a defaulter's fields.

#### Scenario: Editing in the editor and in the library agree

- **WHEN** an operator edits a defaulter from inside the editor and then opens the same defaulter in the library
- **THEN** both surfaces present the same fields with the same values

#### Scenario: A field added once appears in both places

- **WHEN** a field is added to a defaulter's editing surface
- **THEN** it appears in both the library page and the editor drawer without being implemented twice

### Requirement: A defaulter reports its usage and its divergence

An opened defaulter SHALL report how many projects draw values from it, and how many of those have
overridden at least one element it supplies.

The report SHALL be derived from stored provenance at read time, and SHALL NOT be maintained as a
denormalised counter.

The diverged projects SHALL be inspectable, naming the element that diverges and both values.

#### Scenario: Usage and divergence are shown

- **WHEN** an operator opens a defaulter that twelve projects draw from, three of which have overridden one of its elements
- **THEN** the surface reports twelve using and three diverged

#### Scenario: Divergence detail names the element and both values

- **WHEN** an operator expands the diverged list
- **THEN** each entry names the project, the diverging element, the defaulter's value, and the project's value

#### Scenario: The count is computed, not stored

- **WHEN** a project overrides an element supplied by a defaulter
- **THEN** the defaulter's diverged count reflects it on the next read
- **AND** no counter is written to the defaulter's record

### Requirement: Saving a shared defaulter reports its blast radius

Before committing a change to a defaulter that more than one project draws from, the system SHALL
report how many projects the change affects.

#### Scenario: Save states how many projects are affected

- **WHEN** an operator saves a defaulter that twelve projects draw from
- **THEN** the confirmation states that twelve projects are affected

#### Scenario: A defaulter used by nothing saves without a warning

- **WHEN** an operator saves a defaulter that no project draws from
- **THEN** no blast-radius warning is shown

### Requirement: An element links to the defaulter that supplied it

From an element in the editor, an operator SHALL be able to open the default source that supplied
its value.

The system SHALL NOT present a default source name on an element, group header, or row-level source
without making that source reachable from it.

#### Scenario: Operator opens the supplying defaulter

- **WHEN** an operator acts on the default source name shown against an element
- **THEN** that default source's editing surface opens

#### Scenario: A named defaulter is always reachable

- **WHEN** an element displays the name of the default source that supplied it
- **THEN** that default source can be opened from the element

#### Scenario: Multiple-default row sources are reachable

- **WHEN** a group header says "Multiple defaults"
- **AND** a row displays its row-level default source name
- **THEN** that row-level source can be opened from the row or its detail

### Requirement: Default library surfaces use product vocabulary

User-facing library and panel links SHALL describe reusable value sources as Project Presets, Materials, Video Templates, or Elements according to their role. The word "defaulter" SHALL remain an internal specification or implementation term only and SHALL NOT appear in visible UI copy.

Library surfaces SHALL preserve the distinction between Project Presets, Video Templates, Materials, and Elements. Custom Elements SHALL be named as user-authored records inside the Elements surface, not as the whole library family. Fixture status SHALL be presented as shipped/read-only source state, not as a separate top-level library family.

#### Scenario: Operator opens a preset source from the panel

- **WHEN** an operator opens a source named in a material or template row
- **THEN** the destination UI labels it as a Project Preset, Material, or Video Template
- **AND** visible UI copy does not say "defaulter"

#### Scenario: Fixture status does not create a new family

- **WHEN** the library presents fixture Project Presets, Materials, or Video Templates
- **THEN** each row remains inside its product family
- **AND** the library does not add a top-level Fixtures family

#### Scenario: Custom elements are grouped under Elements

- **WHEN** an operator opens Library > Elements
- **THEN** custom saved blocks are grouped as Custom Elements inside that surface
- **AND** the library navigation does not expose Custom Elements as a separate top-level family

### Requirement: Library surfaces share hierarchy and controls

Every Library surface SHALL present page identity before current-surface controls. The title, blurb, count, and page action SHALL appear before the shared Library toolbar. Search SHALL appear in that toolbar on every searchable Library surface. Group filters SHALL appear in the same toolbar when a surface has meaningful groups.

Library pages SHALL NOT render page-local sibling navigation above the search toolbar. When the app shell or global Library navigation already exposes References, Voices, Project Presets, Materials, Video Templates, and Elements, page-local sibling navigation MAY be omitted. If a page-local sibling switcher is retained, it SHALL render below the toolbar.

#### Scenario: Page title precedes library navigation

- **WHEN** an operator opens any Library menu
- **THEN** the page title and blurb are presented before any page-local library scope navigation

#### Scenario: Search precedes page-local sibling navigation

- **WHEN** an operator opens References, Voices, Project Presets, Materials, Video Templates, or Elements
- **THEN** no page-local Library scope navigation is rendered above the search toolbar
- **AND** any retained page-local Library scope navigation is below the toolbar

#### Scenario: Search placement is consistent

- **WHEN** an operator opens any searchable Library menu
- **THEN** the search box appears in the shared Library toolbar below the page heading
- **AND** the surface does not render a second search box elsewhere

#### Scenario: An embedded browser does not bring its own search

- **WHEN** a Library surface embeds a browser that carries its own search control outside the library
- **THEN** that embedded search is suppressed in the library context
- **AND** the shared Library toolbar's query drives the embedded browser's filtering

#### Scenario: Group filters share the toolbar

- **WHEN** a Library menu supports grouped content
- **THEN** its group filter appears in the shared Library toolbar
- **AND** filtering by group combines with the active search query

### Requirement: Top-level library pages use catalogue presentation

Top-level Library pages SHALL present records as catalogue rows or tiles. They SHALL NOT expose editor-only panel chrome, placement controls, close buttons, or selected-item controls that have no meaning outside an open project. Shared editor implementations MAY be opened from catalogue rows for create, inspect, edit, copy, or fork flows.

#### Scenario: Video templates render as catalogue records

- **WHEN** an operator opens Library > Video Templates
- **THEN** templates are presented as catalogue records with inspect or edit actions
- **AND** no project-only selection control is shown

#### Scenario: Elements render as catalogue records

- **WHEN** an operator opens Library > Elements
- **THEN** element definitions are presented as catalogue records grouped by element family
- **AND** no placement control is shown because no timeline or playhead is active

#### Scenario: A catalogue body uses the page's width

- **WHEN** a Library page renders its records on a desktop viewport
- **THEN** the catalogue body uses the page's content width
- **AND** it is not constrained to an editor panel's fixed column width

### Requirement: Library surfaces work at phone widths

Every Library surface SHALL remain fully usable at the narrowest supported viewport.
The shared Library toolbar's search and group controls SHALL reflow rather than
overflow, and every group filter SHALL be reachable without horizontal panning.

Library scope navigation SHALL keep every scope reachable at the narrowest supported
viewport. Where the scope list cannot fit on one line, it SHALL reflow or expose an
explicit affordance for the scopes that are off-screen; a silently clipped scope is
an unreachable one.

Catalogue rows and tiles SHALL reflow to the viewport rather than holding a fixed
column count that forces a record to be cut off.

#### Scenario: Every library scope is reachable on a phone

- **WHEN** an operator opens any Library menu at a 320px-wide viewport
- **THEN** every library scope is reachable
- **AND** no scope is clipped without an affordance that reveals it

#### Scenario: Toolbar controls reflow on a phone

- **WHEN** the shared Library toolbar renders at a 320px-wide viewport
- **THEN** the search box and every group filter remain visible and operable
- **AND** the page does not scroll horizontally

#### Scenario: Catalogue records reflow on a phone

- **WHEN** a Library catalogue renders rows or tiles at a 320px-wide viewport
- **THEN** each record's fields remain readable
- **AND** no record is cut off by a fixed column count
