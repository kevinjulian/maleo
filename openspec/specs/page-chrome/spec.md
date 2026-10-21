# page-chrome Specification

## Purpose

Keeps the chrome around every page consistent: one shared page heading, list surfaces that stay usable at phone widths, key-and-value settings edited as records, and navigation entries that lead where their label says and mark only where the operator actually is.

## Requirements

### Requirement: One page heading, built once

Every top-level page SHALL render its heading through one shared component. A page
SHALL NOT hand-roll its title, its supporting text, or their spacing.

The heading SHALL carry a title, optional supporting text, and an optional action
area for the controls that belong to the page as a whole.

Page identity SHALL come first. Current-surface controls, such as search and
filters, SHALL come before optional page-local navigation between sibling
surfaces. A surface that carries its own navigation between sibling surfaces —
library scope navigation, for example — SHALL NOT render that navigation above
the shared heading or above the current surface's search toolbar. Two competing
headers is what placing navigation above the title produces, and burying search
below sibling navigation makes route switching more prominent than the current
task.

A page's heading SHALL NOT restate the breadcrumb rendered immediately above it.

#### Scenario: Every page heading matches

- **WHEN** an operator moves between the content list, a library surface, video,
  settings, and the images surface
- **THEN** each page's title, supporting text, and action area share one size,
  weight, spacing and alignment

#### Scenario: A page with page-level controls

- **WHEN** a page has a primary action or a count that describes the whole page
- **THEN** they sit in the heading's action area, aligned with the title

#### Scenario: A surface with sibling navigation

- **WHEN** a library surface renders scope navigation between sibling library surfaces
- **THEN** the navigation sits below a heading that is otherwise identical to every other page's
- **AND** it does not appear above the page's search toolbar when that page has search

#### Scenario: The title is not said twice

- **WHEN** a page renders beneath the breadcrumb bar
- **THEN** its heading does not repeat the breadcrumb's text

### Requirement: List surfaces stay usable at phone widths

A list of records SHALL remain fully readable at the narrowest supported viewport.
No field that the surface presents as part of a record SHALL become unreachable
because of viewport width.

Where a record's fields cannot sit side by side, they SHALL reflow rather than
overflow. A layout whose minimum width exceeds the viewport SHALL NOT be used,
because the application clips horizontal overflow rather than scrolling it — the
content does not merely move offscreen, it becomes unreachable.

#### Scenario: The content list on a phone

- **WHEN** an operator opens the content list on a 375px-wide viewport
- **THEN** each row shows its title, type, creation time and last-edit time, and the
  row's title remains the control that opens the editor

#### Scenario: No horizontally clipped record

- **WHEN** any list surface renders at the narrowest supported width
- **THEN** no field is cut off, and the page does not scroll horizontally

#### Scenario: Wide viewports keep their density

- **WHEN** the same list renders on a desktop viewport
- **THEN** a record occupies a single line, with its metadata legible at a glance

### Requirement: Key-and-value settings are edited as records, not as a table

Settings that present a named value with an editor and a per-row action SHALL be
laid out as one record per setting, at every viewport width.

Such a surface SHALL NOT be laid out as a data table. Its rows are independently
edited forms, not rows of a dataset to be compared or scanned across, and a table
forces long identifiers and an input field into competition for width that neither
can win on a phone.

#### Scenario: Editing a key on a phone

- **WHEN** an operator opens the environment settings on a narrow viewport
- **THEN** each key shows its name, its current masked value and source, and an input
  wide enough to type into, without truncation or horizontal clipping

#### Scenario: The blank-means-unchanged contract survives

- **WHEN** a key's input is left blank and changes are saved
- **THEN** that key's stored value is unchanged, and removing a key remains a distinct
  explicit action

### Requirement: A navigation entry leads where its label says

A navigation destination SHALL be the same for a given label regardless of which
navigation surface the operator used.

The state that marks a destination as current SHALL be derived from where the
operator actually is. A destination SHALL NOT be highlighted as current by a
surface that does not lead there.

A navigation entry MAY lead to a surface that carries navigation of its own. In
that case the entry SHALL be marked current for every panel of that surface,
and the inner navigation SHALL mark only the panel in view.

The workspace surface is reached from the workspace switcher menu in the
sidebar header, not from a sidebar section of its own. While the operator is on
any panel of the workspace surface, the workspace switcher SHALL indicate it.

#### Scenario: Images means the same thing everywhere

- **WHEN** an operator selects "Images" from the mobile navigation
- **THEN** they arrive at the same destination the desktop navigation's "Images" leads to

#### Scenario: A different page does not claim the tab

- **WHEN** an operator opens the References library
- **THEN** the "Images" navigation entry is not shown as current

#### Scenario: References is still reachable on a phone

- **WHEN** an operator on a phone wants the References library
- **THEN** it remains reachable from the navigation drawer

#### Scenario: A surface with its own navigation

- **WHEN** an operator is on the members panel of the workspace surface
- **THEN** the workspace switcher indicates the workspace surface is open, and the inner navigation marks Members rather than the surface's first panel

#### Scenario: A grouped section on a phone

- **WHEN** an operator on a phone wants the workspace surface
- **THEN** it is reachable from the workspace switcher in the navigation drawer, like every other destination

### Requirement: Project records use consistent Projects terminology

Project navigation, page headings, search labels, status messages, accessible labels, and creation actions SHALL use Projects, Project, and New project consistently instead of Content when referring to project records. Existing project links and authorization SHALL remain compatible. Generated content inside a project SHALL retain its appropriate content terminology.

#### Scenario: Desktop and phone navigation

- **WHEN** operator opens project inventory from desktop navigation or phone drawer
- **THEN** both show Projects and lead to the same authorized project inventory

#### Scenario: Create project

- **WHEN** operator selects New project
- **THEN** existing project creation workflow opens and its project-facing labels use Project terminology

### Requirement: Project inventory supports clear list and grid views

Projects SHALL provide thumbnail-led list/grid views with search, existing type filters, stable ascending/descending name and modified-date sorting, and a New project action. Each record SHALL expose title, type, creation and modification timestamps, existing actions, and video duration when known. Missing thumbnails SHALL use a truthful fallback and unknown duration SHALL NOT be fabricated. Views SHALL preserve query and order when switched, distinguish loading/error/empty states, and remain readable and operable at compact widths.

#### Scenario: Sort and switch views

- **WHEN** operator searches projects, sorts by modified date, and switches list/grid
- **THEN** matching records retain deterministic order and title opens the correct project

#### Scenario: Phone project row

- **WHEN** project inventory is opened at 320px width
- **THEN** thumbnail, title, required metadata, and existing actions remain reachable without horizontal clipping

#### Scenario: Non-video or unknown duration

- **WHEN** project has no applicable or known video duration
- **THEN** inventory avoids displaying an invented duration
