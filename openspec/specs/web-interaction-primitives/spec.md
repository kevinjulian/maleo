# Web Interaction Primitives Specification

## Purpose

Defines the shared behavior, styling boundary, overlay ownership, and verification expected when Maleo web controls adopt Base UI and shadcn recipes.

## Requirements

### Requirement: Generic controls use Base UI through Maleo components

The web client SHALL use Base UI behavior and shadcn styled recipes for generic controls mapped by the replacement inventory. Feature call sites SHALL import typed Maleo components from `design-system/components/`; generated source SHALL obey app icon and import rules. The app SHALL add only recipes with mapped consumers.

#### Scenario: A generic control is replaced

- **WHEN** a menu, select, tab, popover, slider, switch, checkbox or tooltip is migrated
- **THEN** its Maleo component composes the Base UI-backed recipe and retains keyboard, focus, ARIA and dismissal behavior

#### Scenario: A recipe has no consumer

- **WHEN** a recipe is proposed without a mapped surface and call site
- **THEN** it is not installed

### Requirement: Styling reads one canonical token source

Colour, type, spacing, radius, elevation, motion and responsive values SHALL have one editable Maleo source. Tailwind/shadcn semantic aliases SHALL reference it and SHALL be retained only when rendered components use them. Component census and token checks SHALL account for generated utility classes and alias readers.

#### Scenario: A shadcn semantic token is needed

- **WHEN** an installed recipe uses a semantic class for background, foreground or focus
- **THEN** that class resolves through a live alias to canonical Maleo token in both themes

#### Scenario: An alias or default palette is unused

- **WHEN** a generated token has no rendered consumer or duplicates an independently editable Maleo value
- **THEN** it is removed or affected component is corrected before approval

#### Scenario: Cascade layers interact

- **WHEN** a recipe is installed into app's layered stylesheets
- **THEN** computed normal, hover, focus, disabled and dark states match accepted contract at desktop and phone widths

### Requirement: Every rendered component receives a migration disposition

Before call sites are replaced, the change SHALL record a component-by-component matrix covering shared app components, cluster components and native controls. Each entry SHALL name owner, consumers, target, `replace`/`adapt`/`retain`/`retire` decision, required states, responsive and accessibility proof, and completion status. Historical approval SHALL NOT count as approval of new visual treatment.

#### Scenario: A component is in the running app

- **WHEN** inventory finds a rendered component or native control
- **THEN** matrix contains an entry and reviewed disposition before its surface changes

#### Scenario: A domain widget resembles a recipe

- **WHEN** a timeline or storyboard widget carries product behavior a generic recipe lacks
- **THEN** matrix records `retain` or `adapt`, and behavior stays local

#### Scenario: A previously approved component changes appearance

- **WHEN** a former approved component takes new styling
- **THEN** its purpose, variants, states and representative-surface proof are reviewed again before approval

### Requirement: App overlay mechanics have one owner

Modal, sheet and lightbox stacking, focus ownership, Escape, inertness, history and scroll lock SHALL remain on `@maleo/vui/dom`. Shadcn Dialog, Sheet and Drawer behavior SHALL NOT form a second modal overlay stack. Base UI popovers, selects and menus MAY manage local non-modal dismissal.

#### Scenario: A modal surface is restyled

- **WHEN** its appearance adopts new tokens or composition
- **THEN** its Maleo overlay component and VUI mechanism still own modal behavior

#### Scenario: Nested overlays are open

- **WHEN** a modal and editor sheet are open and Escape or phone Back is used
- **THEN** only top eligible overlay closes and focus returns correctly

### Requirement: Replacement follows complete user surfaces

Shared controls SHALL migrate with affected user surfaces, beginning with shell and Content, followed by Library and Settings, then chat and editor chrome. A surface SHALL preserve navigation, loading, empty, error, disabled, keyboard and phone behavior while presentation changes. Product data and editor document behavior SHALL remain intact.

#### Scenario: A surface migrates

- **WHEN** its components are replaced
- **THEN** visible states and interactive paths pass browser checks before next surface is approved

#### Scenario: A control lacks accessible name or focus indication

- **WHEN** migrated component is checked by keyboard and accessibility tooling
- **THEN** migration fails until accessible name and visible focus state are present

### Requirement: New design earns new baselines

Existing component approvals and screenshots SHALL be retained as before evidence, not target appearance. New approved components SHALL have complete contracts and browser proof at desktop and phone widths. New screen baselines SHALL be created only for reviewed intentional changes, one named capture group at a time. Approved kit SHALL be published from accepted components; candidate inventory SHALL remain separate.

#### Scenario: A screenshot changes intentionally

- **WHEN** migrated surface differs from old capture
- **THEN** change names cause, inspects affected states and refreshes only named baselines

#### Scenario: Motion or initial mount changes

- **WHEN** replacement changes animation or first-render behavior
- **THEN** reduced-motion and first-render states are driven in browser before baseline is accepted

#### Scenario: Approved kit is regenerated

- **WHEN** replacement inventory marks a component approved
- **THEN** component has reviewed contract and cited representative-surface proof before kit entry

### Requirement: VUI remains renderer-neutral

`@maleo/vui` SHALL NOT gain Base UI, shadcn or Tailwind runtime dependency. App SHALL style VUI-backed editor surfaces through documented tokens and slots.

#### Scenario: Editor chrome is migrated

- **WHEN** app controls around VUI timeline use shadcn styling
- **THEN** VUI dependencies and renderer-neutral behavior remain unchanged

### Requirement: Option selection has custom responsive presentation

Single-choice dropdown controls SHALL use Maleo option presentation rather than native browser option menus. Desktop SHALL show an anchored popup; phone layouts SHALL show a bottom sheet. Both presentations SHALL share labels, option ordering, selected state, disabled state and value behavior. Options MAY include icons, descriptions and groups. Long lists SHALL scroll within available viewport space without hiding selection or dismissal controls. Editor phone presentation SHALL follow the editor's existing layout boundary; app presentation SHALL follow the app's phone boundary.

#### Scenario: Desktop aspect selection

- **WHEN** an operator opens aspect ratio at desktop width
- **THEN** an anchored popup shows options and current selection
- **AND** choosing a different enabled option updates the existing setting once and closes the popup

#### Scenario: Phone selection

- **WHEN** an operator opens a dropdown in phone layout
- **THEN** a labeled bottom sheet shows the same options with visible selection and touch-sized targets
- **AND** no native browser option menu appears

#### Scenario: Disabled or empty options

- **WHEN** options are disabled or the list has no available values
- **THEN** disabled values cannot be selected and the unavailable state is clear without silently committing another value

### Requirement: Custom option controls preserve accessible selection and forms

Option controls SHALL expose an accessible label, expanded state and selected option. Keyboard users SHALL be able to open, navigate, use typeahead, select and dismiss. In an active editor, Space SHALL follow transport ownership and Enter SHALL remain available for selection. Selection SHALL notify once; canceling SHALL preserve value. Controls SHALL preserve field sizing, required/invalid/disabled states and consumed form submission/reset contracts. If a committed value is absent from current options, the control SHALL disclose it without silently selecting a replacement.

#### Scenario: Keyboard selection

- **WHEN** a keyboard user opens a dropdown, navigates to an enabled option and presses Enter
- **THEN** that option becomes selected once and focus returns to the trigger

#### Scenario: Form reset

- **WHEN** an operator resets a form containing an option control
- **THEN** its value follows the form's established default/reset behavior and submitted data reflects the current value

#### Scenario: Unavailable stored value

- **WHEN** a provider or option list no longer contains the committed value
- **THEN** the control exposes that value as unavailable and does not mutate it without explicit user selection

### Requirement: Responsive option overlays respect parent ownership

Option overlays SHALL use the application's existing focus, stacking and dismissal ownership. Escape, outside dismissal, explicit Close or phone Back SHALL dismiss only the eligible top overlay and preserve the parent surface. Dismissal SHALL restore appropriate trigger focus. Changing responsive presentation while open SHALL preserve value and leave one active overlay without duplicated history or scroll locks.

#### Scenario: Dropdown inside phone properties

- **WHEN** an operator opens a dropdown inside the phone properties sheet and presses Back
- **THEN** the option sheet closes, the properties sheet remains open and focus recovers to the dropdown trigger

#### Scenario: Resize an open dropdown

- **WHEN** an open dropdown crosses its phone layout boundary
- **THEN** exactly one responsive presentation remains open and the selected value is unchanged
