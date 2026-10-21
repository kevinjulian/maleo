# Clip Animation UX Specification

## Purpose

Make clip entrance, exit and shared-boundary transition editing directly discoverable, explicitly targeted and predictable across pointer, touch, keyboard, persistence and rendering.

## Requirements

### Requirement: Edge and boundary controls have explicit ownership

The editor SHALL NOT render entrance/exit triggers or applied edge indicators on clips. Entrance and Exit SHALL remain reachable through the selected clip's Animation inspector at all widths. A touching same-track visual pair SHALL expose one transition trigger at its shared boundary. Arbitrary overlapping clips on different tracks SHALL NOT form a transition pair. Controls MUST NOT steal trim or move gestures, and locked tracks SHALL refuse edits.

#### Scenario: One connected edge

- **WHEN** a clip has a neighbour at its start and no neighbour at its end
- **THEN** its shared start offers a transition; entrance and exit are edited only in the inspector, with no edge icons or badges on the clip

#### Scenario: Small touch clip

- **WHEN** a selected clip is too narrow or its row is too short for distinct inline touch controls
- **THEN** Animation remains available through its properties without blocking selection or trimming

### Requirement: Inspector edits only the stated target

Selecting Animation properties SHALL edit the selected clip; activating a boundary trigger SHALL select the corresponding visual and open the existing inspector naming the exact clip pair. Entrance and Exit SHALL have separate InspectorSections, each with its own preset and duration controls, rather than an edge button group. Desktop SHALL use its docked inspector and phone SHALL use its existing properties sheet. No animation or transition modal SHALL be opened. Opening and closing the inspector SHALL NOT add an animation. The inspector SHALL expose named visual preset choices and duration controls; replay SHALL use the main production Player, leaving the timeline and preview housing available. preset choice SHALL update immediately and None SHALL remove the selected recognized preset treatment. Sections SHALL start collapsed. Collapsed headers SHALL show the current effect between title and chevron, omitting the value for None and when expanded. No Custom keys tile or Custom keyframes shortcut SHALL appear. Unrecognized custom keys SHALL be identified truthfully and remain editable through ordinary keyframe controls. Clip properties SHALL retain entrance and exit access even at shared boundaries.

#### Scenario: Open empty boundary

- **WHEN** a user opens and dismisses an empty boundary inspector
- **THEN** the document is unchanged

#### Scenario: Collapsed animation summary

- **WHEN** Animation opens with Entrance Fade and no Exit preset
- **THEN** both sections are collapsed, only Entrance shows Fade beside its title, and expanding Entrance hides that summary and reveals its controls

#### Scenario: Fade isolated clip

- **WHEN** a user selects Fade on an isolated clip's exit
- **THEN** that clip fades to transparency during its selected end duration, without requiring another clip

### Requirement: Presets preserve animation authority

Presets SHALL use existing clip-local property tracks and supported element properties. Changes SHALL preserve unrelated tracks, keys outside the edited edge treatment and opposite-edge animation. Duration SHALL be constrained to the clip and avoid overlapping edge treatments. Key edits, save/reload, undo/redo and production preview/export SHALL retain the same values. Fade on audio SHALL change gain; Fade on visuals SHALL reveal underlying composition.

#### Scenario: Both edges and unrelated motion

- **WHEN** an exit Fade is added to a clip with entrance Fade and rotation keys
- **THEN** entrance and rotation stay unchanged and undo removes only the new exit treatment

#### Scenario: Existing custom edge keys

- **WHEN** edge keys do not match a built-in ramp
- **THEN** the collapsed header indicates Custom, without duplicate Custom keys controls, and ordinary property editing preserves unrelated keys

### Requirement: Broken transitions are removed on committed movement

Committing movement that breaks a pair's valid shared boundary SHALL remove its transition and any mirrored rendering treatment. The drag projection SHALL indicate pending removal. Cancellation SHALL preserve the transition. A movement preserving the pair's valid boundary SHALL preserve the transition. Movement and removal SHALL be one undo step; undo/redo and save/reload SHALL restore or remove both consistently.

#### Scenario: Separate linked clips

- **WHEN** one clip is dropped away from its transitioned neighbour
- **THEN** the transition disappears and cannot render through a legacy fallback

#### Scenario: Cancel and undo

- **WHEN** a breaking drag is cancelled
- **THEN** original position and transition remain unchanged
- **WHEN** a breaking drag is committed and then undone
- **THEN** both original position and transition are restored

#### Scenario: Move both clips

- **WHEN** both clips move together and their boundary remains valid
- **THEN** their transition remains unchanged

### Requirement: Selected keyframe curves belong in the inspector

Selected keyframes SHALL expose easing/curve controls in the existing inspector beside the animated property controls. The timeline toolbar SHALL NOT contain a curve or easing editor. Single-property key selection SHALL edit only that key; selected moments SHALL edit all selected keys together. Mixed easing SHALL be represented truthfully. Locks SHALL refuse changes, and one easing change SHALL be one undo step that survives save/reload.

#### Scenario: Selected moment

- **WHEN** a user selects a keyframe moment on the timeline
- **THEN** the corresponding clip property category and Curve section are available in its inspector
- **WHEN** Ease in/out is chosen
- **THEN** selected keys receive that easing, and one undo restores their former values

#### Scenario: Selection switches

- **WHEN** another clip is selected
- **THEN** old keyframe and animation controls cannot edit the previous clip or pair

### Requirement: Basic elements start static

Elements and Library SHALL share static Text, Rectangle and Circle definitions. Basic SHALL contain plain Text; Shapes SHALL contain Rectangle and Circle. Placement of these static elements by click or drag SHALL add a normal editable clip with no automatic animation tracks. Plain text and shapes SHALL render unchanged from their first through last visible frame in production preview/export until a user adds keyframes or an edge preset. Motion templates SHALL remain available separately. Existing animated documents SHALL retain their behavior.

#### Scenario: Add basic text or shape

- **WHEN** a user adds Text, Rectangle or Circle with another text clip selected
- **THEN** a new static clip is added without replacing the selected clip; layout and style remain editable and the same values survive save/reload

### Requirement: Text animation uses ordinary keyframes

Text clip properties SHALL NOT expose a separate Animate editor. Existing numeric/color property keyframe controls and timeline lanes SHALL remain available and existing keys SHALL survive inspector selection, save/reload and undo. Motion Studio composition editing remains independent.

#### Scenario: Text with existing keys

- **WHEN** a user opens a keyed text clip's properties
- **THEN** ordinary property key controls can edit its keys and no duplicate Animate section appears

### Requirement: Elements tools use compact picker tiles

The Elements tool SHALL show built-in and saved elements as compact square preview tiles with accessible names and hover hints, without large cards, captions or description blocks. Tiles SHALL retain the 44px target floor. Search/filtering, keyboard/click placement, drag placement and saved-item context actions SHALL remain available.

#### Scenario: Browse and place from compact tiles

- **WHEN** a user filters Elements and activates or drags a tile
- **THEN** only matching tiles are listed and placement uses the same normal clip/document path

### Requirement: Catalogue defaults do not depend on selection

Every built-in catalogue preview and insertion SHALL use the preset's default content/parameters independently of the selected clip. Choosing an element SHALL create a new clip, preserving the selected clip and its authored keys.

#### Scenario: Add styled text with an existing text clip selected

- **WHEN** a user selects an edited text clip and chooses Title from Elements
- **THEN** the catalogue shows default Title content and adds a new default Title, leaving the existing clip unchanged

### Requirement: Category tab bar follows search

Elements tools SHALL place an icon-free category tab bar below search, using the shared design-system bar variant and accessible tab/panel associations. Arrow keys, Home and End SHALL navigate categories. Motion and Data SHALL show their scoped New action at the right of their category heading.

#### Scenario: Browse categories and create

- **WHEN** a user selects Motion or Data through the category tab bar
- **THEN** its heading shows a right-aligned New action opening the existing studio or data creation flow

### Requirement: Catalogue previews autoplay

Built-in and saved catalogue previews SHALL autoplay and loop through production renderers in Elements tools and Library. Static basic elements SHALL remain visually static. Reduced-motion preference SHALL show an arrived still rather than automatic playback.

#### Scenario: Preview motion and data

- **WHEN** a user browses animated elements with normal motion preference
- **THEN** preview pixels change over time without clicking a play control
- **WHEN** reduced motion is enabled
- **THEN** previews display a stable arrived frame
