# timeline-elements-menu

## Purpose

A unified timeline sidebar element picker. It lists Text, Motion, and Data (infographic) elements — both built-in and user-authored custom items — in one searchable, type-grouped, filterable panel, and places them on the timeline via click or drag. It replaces the previously separate Text, Motion, and Data rails.

## Requirements

### Requirement: Unified Elements rail

The timeline sidebar SHALL expose a single "Elements" rail that replaces the separate Text and Motion rails. Opening it SHALL show one panel containing all placeable overlay elements. The rail button SHALL use a composite icon that represents the merged element types rather than a text-only glyph. The panel SHALL NOT list Data (infographic) elements.

#### Scenario: Open the Elements rail

- **WHEN** the user selects the Elements rail button in the timeline sidebar
- **THEN** a single panel opens listing Text and Motion elements together
- **AND** no separate Text, Motion, or Data rail buttons are shown

#### Scenario: Rail icon represents all element types

- **WHEN** the timeline sidebar renders the Elements rail button
- **THEN** its icon is a composite mark combining box, circle and text motifs
- **AND** it is not the text-only type glyph

#### Scenario: Legacy rails removed

- **WHEN** the timeline sidebar renders
- **THEN** the standalone Text, Motion, and Data rail buttons are absent
- **AND** all Text and Motion elements remain reachable through the Elements panel

### Requirement: Shared search across all element types

The Elements panel SHALL provide a single search box that filters every element across all types by label and intent. Search SHALL combine with the active filter chip. When a query is present, the search box SHALL expose a clear control that empties the query.

#### Scenario: Search spans all types

- **WHEN** the `All` chip is active and the user types a query matching elements in more than one type
- **THEN** matching elements from each type are shown under their type headers
- **AND** non-matching elements are hidden

#### Scenario: Search combined with a filter chip

- **WHEN** the `Text` chip is active and the user enters a query
- **THEN** only Text elements matching the query are shown

#### Scenario: Clear the query

- **WHEN** a query is present and the user activates the search clear control
- **THEN** the query is emptied
- **AND** the full unfiltered result set for the active chip is shown

#### Scenario: No matches

- **WHEN** a query matches no elements in the active scope
- **THEN** an empty-state message is shown for the affected scope

### Requirement: Type-grouped results with headers

The Elements panel SHALL render one scrollable result region grouped by Basic, Shapes, Text and Motion, with each in-scope group preceded by its header. Built-in presets and available custom items SHALL appear together in their supported groups as preview tiles. Every in-scope group SHALL keep its header when no entries match, with an empty hint beneath it. Built-ins SHALL render without waiting for custom items; custom items SHALL append when loaded without gating group visibility. There SHALL be no Data group.

#### Scenario: Groups render with headers

- **WHEN** All is active
- **THEN** each group appears under its own labeled header followed by tiles

#### Scenario: Custom items grouped with their type

- **WHEN** the operator has saved custom items of a supported type
- **THEN** those custom items appear in their owning group alongside built-ins

#### Scenario: Empty group shows a hint

- **WHEN** a group in the active scope has no matching elements
- **THEN** its header remains visible with an empty hint

#### Scenario: Group visibility does not wait on custom items

- **WHEN** a group has built-ins and its custom items are still loading
- **THEN** built-in tiles render immediately and custom items append when available

### Requirement: Sticky panel controls

The Elements panel SHALL keep the filter chips, the search box, and the currently in-view type group header pinned within the scrollable panel body while the element tiles scroll beneath them. Group headers SHALL pin below the chips-and-search toolbar, not overlapping it.

#### Scenario: Chips and search stay reachable while scrolling

- **WHEN** the user scrolls the Elements panel body
- **THEN** the filter chips and search box remain visible at the top of the panel body
- **AND** the tiles scroll underneath them

#### Scenario: Group header pins below the toolbar

- **WHEN** the user scrolls a type group past the top of the panel body
- **THEN** that group's header pins directly below the chips-and-search toolbar
- **AND** the header does not overlap the chips or search box

### Requirement: Click and drag placement

Each element tile SHALL support click-to-add and drag-onto-timeline. Placement SHALL route by kind: text presets add a text overlay, and motion compositions expand as a composition clip. Dropped elements SHALL land at the drop position and track.

#### Scenario: Click to add

- **WHEN** the user clicks an element tile
- **THEN** the corresponding overlay is added to the timeline

#### Scenario: Drag to a timeline position

- **WHEN** the user drags an element tile onto a timeline lane and drops it
- **THEN** the corresponding overlay is placed at the drop's time position and track
- **AND** custom text params and composition layers are preserved

### Requirement: Contextual create for custom elements

The Elements panel SHALL provide a create action for new custom elements that respects the active type filter, and SHALL keep right-click edit and delete on existing custom items.

#### Scenario: Create honors the active filter

- **WHEN** a specific type chip is active and the user triggers create
- **THEN** the new-custom flow opens for that type

#### Scenario: Edit or delete a custom item

- **WHEN** the user right-clicks a custom element tile
- **THEN** a menu offers Edit and Delete for that item

### Requirement: Custom elements are library records, and the rail is one view of them

User-authored custom elements SHALL be managed as library records inside Library > Elements. The Elements rail SHALL read those records rather than being the only place they can be created, listed, or edited.

The rail's existing listing, filtering, search, grouping, preview, and placement behaviour SHALL be unchanged by this.

#### Scenario: A custom element created in the library appears in the rail

- **WHEN** an operator creates a custom element from Library > Elements
- **THEN** it appears in the Elements rail alongside the built-in items

#### Scenario: A custom element created from the rail appears in the library

- **WHEN** an operator creates a custom element from the rail's contextual create
- **THEN** it appears under Custom Elements inside Library > Elements

#### Scenario: The rail is not the only surface

- **WHEN** an operator wants to inspect or edit a custom element without opening a project
- **THEN** they can do so from Library > Elements

#### Scenario: Rail behaviour is unchanged

- **WHEN** an operator uses the rail's filters, search, grouping, previews, and placement
- **THEN** all behave as they did before custom elements became library-managed

### Requirement: Library Elements lists all placeable element families

Library > Elements SHALL expose a catalogue view of placeable timeline building blocks. The view SHALL include built-in elements, user-authored Custom Elements, Motion compositions, and Motion presets when those definitions are available. The library view SHALL support search and group filtering across those families without adding anything to a timeline. There SHALL be no Data family, and no custom element of kind `data` SHALL exist.

The catalogue SHALL adapt the same built-in text, motion, and custom-template source models used by the editor Elements rail. It SHALL NOT maintain a parallel hardcoded list of placeable element definitions that can drift from rail behavior.

An element's definition and its preview SHALL be renderable without a timeline, a
playhead, a selected clip, or a project brand palette. Where a preview currently
requires project-scoped inputs, those inputs SHALL become optional with a neutral
fallback rather than forcing the library to supply a stand-in project.

#### Scenario: Elements library shows built-in and custom families

- **WHEN** an operator opens Library > Elements
- **THEN** built-in element families and Custom Elements are visible as groups in one surface
- **AND** Custom Elements are not the only listed family

#### Scenario: Elements library does not place items

- **WHEN** an operator opens Library > Elements outside a project editor
- **THEN** element records can be browsed, inspected, edited where supported, copied, or forked where supported
- **AND** no item is placed onto a timeline from that page

#### Scenario: Search spans element families

- **WHEN** an operator searches Library > Elements
- **THEN** matching records remain visible under their groups across built-in, custom and motion families
- **AND** non-matching records are hidden

#### Scenario: Library and rail share element source models

- **WHEN** built-in text or motion definitions change for the editor Elements rail
- **THEN** Library > Elements reads those definitions through the same source model
- **AND** the library catalogue does not require a second hardcoded element list to stay current

#### Scenario: Previews render without project context

- **WHEN** Library > Elements renders a built-in element preview outside any project
- **THEN** the preview renders with a neutral palette
- **AND** the library does not construct a placeholder project, timeline, or selected clip to obtain one

#### Scenario: Stored custom data elements are removed

- **WHEN** the database migrates to the release that removes infographics
- **THEN** every custom element record of kind `data` is deleted
- **AND** custom elements of other kinds are unchanged

#### Scenario: A data element cannot be created

- **WHEN** a client submits a custom element of kind `data`
- **THEN** the request is rejected as invalid input

### Requirement: Type category tabs

The Elements panel SHALL provide icon-free category tabs `All`, `Basic`, `Shapes`, `Text` and `Motion`. Selecting a category other than `All` SHALL restrict visible groups to that category. `All` SHALL be the default. Basic SHALL contain static plain Text; Shapes SHALL contain Rectangle and Circle. Shape entries SHALL appear once in All and SHALL NOT also appear in Basic or Text.

#### Scenario: Default shows all types

- **WHEN** the Elements panel first opens
- **THEN** All is active and Basic, Shapes, Text and Motion groups are visible

#### Scenario: Categories use text labels

- **WHEN** category tabs render
- **THEN** each has an accessible text label without a type icon

#### Scenario: Filter to a single type

- **WHEN** the operator selects Motion
- **THEN** only Motion is shown and other groups are hidden

#### Scenario: Filter to Shapes

- **WHEN** the operator selects Shapes
- **THEN** Rectangle and Circle appear without text presets
- **AND** returning to All shows each shape once

### Requirement: Compact element preview tiles

Every element SHALL render as a compact square picker tile with a type glyph or renderer-backed preview, an accessible name and a hover/focus hint. Basic plain Text SHALL use its text glyph; Rectangle and Circle SHALL use shape previews. Text/Motion presets SHALL use the text-preset renderer, and compositions SHALL use their authored preview. Tiles SHALL omit persistent captions and subtitles. Built-in and saved tiles SHALL share this treatment, with at least a 44px touch target. Editor animated previews SHALL loop, while reduced motion SHALL use a stable arrived frame.

#### Scenario: Tile shows appropriate preview

- **WHEN** Rectangle or Circle renders in Elements
- **THEN** its preview shows its actual geometry and its accessible name identifies the shape

#### Scenario: Consistent tile treatment

- **WHEN** built-in and saved tiles render
- **THEN** they share compact square treatment and accessible naming without captions or subtitles

#### Scenario: Hint on hover or focus

- **WHEN** an operator hovers or focuses a tile
- **THEN** a hint identifies the element and placement action where applicable

#### Scenario: Reduced motion

- **WHEN** reduced motion is enabled
- **THEN** animated tiles show a stable arrived frame instead of looping

### Requirement: Shape catalogue and placement share existing element ownership

Editor Elements and Library Elements SHALL expose Shapes from the same definitions, search labels, counts and previews. Shape placement SHALL create a new Rectangle or Circle at the click or drop destination without replacing an existing selection. Existing shape clips SHALL retain identity, authored values, undo history behavior and save/load compatibility. Library browsing SHALL NOT place clips.

#### Scenario: Place Circle with another clip selected

- **WHEN** an operator adds Circle from Shapes while another clip is selected
- **THEN** a new Circle is created and the prior clip is unchanged

#### Scenario: Drag Rectangle

- **WHEN** an operator drops Rectangle at an eligible timeline time and track
- **THEN** a Rectangle is placed at that destination through the existing undoable placement flow

#### Scenario: Library uses the same shapes

- **WHEN** an operator searches or filters Shapes in Library Elements
- **THEN** it shows the same Rectangle/Circle definitions as editor Elements without placing clips

### Requirement: Shapes receive shape-specific inspection

Selecting Rectangle or Circle SHALL identify it as a shape in desktop and phone inspection. Shape content SHALL expose fill, stroke color and stroke width, with corner radius only for Rectangle. Shapes SHALL retain transform, opacity, timing, entrance/exit and ordinary property keyframes where supported. Text content, font and casing controls SHALL be absent. Shape edits SHALL respect track locks, reject invalid numeric values and use existing undo/redo. Saved shape properties SHALL produce the same geometry and color in preview and production render after reload, including transparent and zero-opacity values.

#### Scenario: Inspect an existing Circle

- **WHEN** an operator selects a saved Circle on desktop or phone
- **THEN** its subject and content controls identify Circle as a shape and no text/font controls appear

#### Scenario: Edit Rectangle styling

- **WHEN** an operator changes Rectangle fill, stroke width or corner radius
- **THEN** the shape preview updates and undo/redo restores the exact prior and edited values

#### Scenario: Locked shape

- **WHEN** an operator inspects a shape on a locked track
- **THEN** its values remain inspectable and all mutating controls refuse edits

#### Scenario: Reload and production output

- **WHEN** an edited shape project is saved, reloaded and rendered
- **THEN** preview and production preserve shape geometry, fill, stroke, radius and authored opacity
