# timeline-elements-menu

## Purpose

A unified timeline sidebar element picker. It lists Text, Motion, and Data (infographic) elements — both built-in and user-authored custom items — in one searchable, type-grouped, filterable panel, and places them on the timeline via click or drag. It replaces the previously separate Text, Motion, and Data rails.

## Requirements

### Requirement: Unified Elements rail

The timeline sidebar SHALL expose a single "Elements" rail that replaces the separate Text and Motion rails. Opening it SHALL show one panel containing the Text, Shapes and Motion groups. The rail button SHALL use a composite icon that represents the merged element types rather than a text-only glyph. The panel SHALL NOT list Data (infographic) elements.

#### Scenario: Open the Elements rail

- **WHEN** the user selects the Elements rail button in the timeline sidebar
- **THEN** a single panel opens listing Text, Shapes and user-created Motion together
- **AND** no separate Text, Motion, or Data rail buttons are shown

#### Scenario: Rail icon represents all element types

- **WHEN** the timeline sidebar renders the Elements rail button
- **THEN** its icon is a composite mark combining box, circle and text motifs
- **AND** it is not the text-only type glyph

#### Scenario: Legacy rails removed

- **WHEN** the timeline sidebar renders
- **THEN** the standalone Text, Motion, and Data rail buttons are absent
- **AND** all supported Text, Shapes and user-created Motion remain reachable through the Elements panel

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

The Elements panel SHALL render one scrollable result region grouped by Text, Shapes and Motion only, with each in-scope group preceded by its header. Text SHALL contain plain-text elements and compatible user variants. Shapes SHALL contain the five supported basic shapes and compatible user variants. Motion SHALL contain user-created compositions only. Entries SHALL appear as preview tiles. Every in-scope group SHALL keep its header when no entries match, with an empty hint beneath it. Plain Text and the five basic shapes SHALL render without waiting for saved records. User records SHALL append when loaded without gating group visibility. There SHALL be no Basic group or stock Motion entries. There SHALL be no Data group.

Text and Shapes SHALL NOT offer an action to create new variants. Compatible variants already saved SHALL remain visible and usable. Motion SHALL retain its create action.

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

#### Scenario: Only Motion offers creation

- **WHEN** Text, Shapes and Motion render in editor or Library Elements
- **THEN** Text and Shapes have no New variant action
- **AND** Motion retains New motion
- **AND** compatible saved variants remain available

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

Each element tile SHALL support click-to-add and drag-onto-timeline. Placement SHALL route by kind: plain text adds a text clip, shapes add a shape clip, and user motion uses the existing composition placement flow. Dropped elements SHALL land at the drop position and track.

#### Scenario: Click to add

- **WHEN** the user clicks an element tile
- **THEN** the corresponding overlay is added to the timeline

#### Scenario: Drag to a timeline position

- **WHEN** the user drags an element tile onto a timeline lane and drops it
- **THEN** the corresponding overlay is placed at the drop's time position and track
- **AND** retained primitive values and user composition layers are preserved

### Requirement: Contextual create for custom elements

The Elements panel SHALL offer creation of user Motion only. Text and Shapes SHALL have no new-variant action under any active filter. Existing compatible saved variants SHALL retain right-click Edit and Delete.

#### Scenario: Create honors the active filter

- **WHEN** All or Motion is active and the operator triggers New motion
- **THEN** the Motion authoring flow opens
- **AND** Text and Shapes expose no create action when their filters are active

#### Scenario: Edit or delete a custom item

- **WHEN** the user right-clicks a saved custom element tile
- **THEN** a menu offers Edit and Delete for that item

### Requirement: Custom elements are library records, and the rail is one view of them

User-authored Motion SHALL be managed as library records inside Library > Elements. The Elements rail SHALL read those records and permit Motion creation. Existing compatible Text and Shape variants SHALL remain listed, placeable, editable and deletable, but neither surface SHALL offer creation of new Text or Shape variants.

The rail and library SHALL share the retained Text, Shapes and user-only Motion definitions. Existing search, preview, placement and library-management behavior SHALL remain available within these three groups.

#### Scenario: A custom element created in the library appears in the rail

- **WHEN** an operator creates Motion from Library > Elements
- **THEN** it appears in the Elements rail alongside the built-in items

#### Scenario: A custom element created from the rail appears in the library

- **WHEN** an operator creates Motion from the rail's create action
- **THEN** it appears under Custom Elements inside Library > Elements

#### Scenario: The rail is not the only surface

- **WHEN** an operator wants to inspect or edit a custom element without opening a project
- **THEN** they can do so from Library > Elements

#### Scenario: Rail behaviour is unchanged

- **WHEN** an operator uses the rail's filters, search, grouping, previews, and placement
- **THEN** their interaction semantics remain available under Text, Shapes and user-only Motion

### Requirement: Library Elements lists all placeable element families

Library > Elements SHALL expose a catalogue view of placeable timeline building blocks. The view SHALL contain exactly Text, Shapes and Motion groups, with plain text, the five basic shapes and compatible user records. Motion SHALL contain user-created compositions only. Camera-motion presets SHALL NOT be listed as element templates. The library view SHALL support search and group filtering across those families without adding anything to a timeline. There SHALL be no Data family, and no custom element of kind `data` SHALL exist.

The catalogue SHALL adapt the same retained primitive and user-composition source models used by the editor Elements rail. It SHALL NOT maintain a parallel hardcoded list of placeable element definitions that can drift from rail behavior.

An element's definition and its preview SHALL be renderable without a timeline, a
playhead, a selected clip, or a project brand palette. Where a preview currently
requires project-scoped inputs, those inputs SHALL become optional with a neutral
fallback rather than forcing the library to supply a stand-in project.

#### Scenario: Elements library shows built-in and custom families

- **WHEN** an operator opens Library > Elements
- **THEN** Text, Shapes and Motion are visible as groups in one surface
- **AND** Custom Elements are not the only listed family

#### Scenario: Elements library does not place items

- **WHEN** an operator opens Library > Elements outside a project editor
- **THEN** element records can be browsed, inspected, edited where supported, copied, or forked where supported
- **AND** no item is placed onto a timeline from that page

#### Scenario: Search spans element families

- **WHEN** an operator searches Library > Elements
- **THEN** matching records remain visible under their groups across Text, Shapes and user Motion
- **AND** non-matching records are hidden

#### Scenario: Library and rail share element source models

- **WHEN** retained primitive or user motion definitions change for the editor Elements rail
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

The Elements panel SHALL provide icon-free category tabs `All`, `Text`, `Shapes` and `Motion`. Selecting a category other than `All` SHALL restrict visible groups to that category. `All` SHALL be the default. Text SHALL contain plain text. Shapes SHALL contain Circle, Rectangle, Triangle, five-point Star and plus-sign Cross. Motion SHALL contain user-created compositions only. Shape entries SHALL appear once in All and SHALL NOT also appear in Text or Motion. There SHALL be no Basic category.

#### Scenario: Default shows all types

- **WHEN** the Elements panel first opens
- **THEN** All is active and Text, Shapes and Motion groups are visible

#### Scenario: Categories use text labels

- **WHEN** category tabs render
- **THEN** each has an accessible text label without a type icon

#### Scenario: Filter to a single type

- **WHEN** the operator selects Motion
- **THEN** only Motion is shown and other groups are hidden

#### Scenario: Filter to Shapes

- **WHEN** the operator selects Shapes
- **THEN** Circle, Rectangle, Triangle, Star and Cross appear without text presets
- **AND** returning to All shows each shape once

### Requirement: Compact element preview tiles

Every element SHALL render as a compact square picker tile with a type glyph or renderer-backed preview, an accessible name and a hover/focus hint. Plain Text SHALL use its text glyph. All five shapes SHALL use geometry previews. User compositions SHALL use their authored preview. Retired styled text or stock motion previews SHALL be absent. Tiles SHALL omit persistent captions and subtitles. Built-in and saved tiles SHALL share this treatment, with at least a 44px touch target. Editor animated previews SHALL loop, while reduced motion SHALL use a stable arrived frame.

#### Scenario: Tile shows appropriate preview

- **WHEN** any of the five basic shapes renders in Elements
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

Editor Elements and Library Elements SHALL expose Shapes from the same definitions, search labels, counts and previews. Shape placement SHALL create a new Circle, Rectangle, Triangle, Star or Cross at the click or drop destination without replacing an existing selection. Existing shape clips SHALL retain identity, authored values, undo history behavior and save/load compatibility. Library browsing SHALL NOT place clips.

A newly placed shape SHALL keep its preview proportions at the project's output aspect ratio. Circle, Triangle, Star and Cross SHALL start in square visible bounds. Rectangle SHALL start in a four-to-one visible box. This default SHALL apply to click and drag placement; subsequent authored transforms remain editable.

#### Scenario: Place Circle with another clip selected

- **WHEN** an operator adds Circle from Shapes while another clip is selected
- **THEN** a new Circle is created and the prior clip is unchanged

#### Scenario: Circle placement keeps its geometry

- **WHEN** an operator places Circle in a wide, square or portrait project
- **THEN** its initial preview box has equal visible width and height
- **AND** saving and reloading preserve that layout

#### Scenario: Drag Rectangle

- **WHEN** an operator drops Rectangle at an eligible timeline time and track
- **THEN** a Rectangle is placed at that destination through the existing undoable placement flow

#### Scenario: Library uses the same shapes

- **WHEN** an operator searches or filters Shapes in Library Elements
- **THEN** it shows the same five shape definitions as editor Elements without placing clips

### Requirement: Shapes receive shape-specific inspection

Selecting Circle, Rectangle, Triangle, Star or Cross SHALL identify it as a shape in desktop and phone inspection. Shape content SHALL expose fill, stroke color and stroke width, with corner radius only for Rectangle. Shapes SHALL retain transform, opacity, timing, entrance/exit and ordinary property keyframes where supported. Text content, font and casing controls SHALL be absent. Shape edits SHALL respect track locks, reject invalid numeric values and use existing undo/redo. Saved shape properties SHALL produce the same geometry and color in preview and production render after reload, including transparent and zero-opacity values.

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
