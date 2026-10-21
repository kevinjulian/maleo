# provider-settings-surface Specification

## Purpose

How the settings surface is navigated: sections as tabs over a capability,
provider and setup hierarchy, every level addressable by route, and how it
collapses from three columns to one.

Written because the surface it replaces hardcoded one card per service, so a
provider added to a registry appeared nowhere, and kept its tabs in component
state, so one went uncovered while 297 green snapshots reported success.

## Requirements

### Requirement: Settings Is Organised By Capability, Not By Provider

The settings surface SHALL present providers grouped by the application capability
they serve, and SHALL show each capability's readiness without the operator
opening it. Provider-backed acquisition capabilities SHALL use the same hierarchy
as generation capabilities.

An operator's question is "can this app make images yet", not "how is Cloudflare
doing". A provider-keyed list forces someone with no image provider configured to
read every provider to discover that none of them serve images.

#### Scenario: Capabilities are listed with their state

- **WHEN** an operator opens settings
- **THEN** each provider-backed application capability is listed with a readiness state and the
  name of the provider currently serving it

#### Scenario: A capability with no configured provider

- **WHEN** a capability has no provider that reports ready
- **THEN** it is listed as not configured rather than omitted, and selecting it
  leads to the providers that could serve it

#### Scenario: A capability with no providers at all

- **WHEN** a capability has no registered provider implementing it
- **THEN** it is still listed, as not configured with an empty provider list,
  because omitting it makes the surface's completeness depend on state and leaves
  an operator unable to tell an unsupported capability from a configured one

#### Scenario: A provider added to a registry

- **WHEN** a provider is added to a registry and declares the capabilities it
  implements
- **THEN** it appears under each of those capabilities with no change to the web
  surface

### Requirement: Stock Setup Uses Consumer Capabilities

Settings SHALL list `Stock visuals` for image and video search through documented
Pexels API and `Sound effects` for sound-effect search through documented
Freesound API. It SHALL NOT describe API access itself as granting a content
license, and SHALL NOT combine disjoint jobs under one `Stock assets` capability.

Freesound SHALL remain not ready for commercial use until operator explicitly
records suitable commercial API permission. Curated background-music library
SHALL NOT appear as setup capability while it has no consumer credential or
provider choice.

#### Scenario: Operator needs stock images or video

- **WHEN** operator selects Stock visuals
- **THEN** Pexels is shown as provider whose setup controls image and video search
- **AND** setup links official API/usage terms without claiming all results share
  one license

#### Scenario: Operator needs sound effects

- **WHEN** operator selects Sound effects without confirmed commercial permission
- **THEN** Freesound setup states free API is non-commercial and provider is not
  commercially ready

#### Scenario: Operator confirms Freesound permission

- **WHEN** operator records suitable commercial API permission and credentials
- **THEN** Freesound may become ready while asset-specific license and attribution
  remain visible

#### Scenario: Operator inspects capabilities

- **WHEN** Stock visuals and Sound effects are present
- **THEN** no overlapping Stock assets capability is shown

#### Scenario: Operator uses built-in background music

- **WHEN** curated Maleo music library needs no consumer configuration
- **THEN** Settings does not present Background music as provider setup capability

#### Scenario: Curated background music is unavailable

- **WHEN** published Maleo music library cannot be found
- **THEN** editor reports current library publish state and does not offer retired
  Jamendo key or provider fallback

### Requirement: Stock Setup Does Not Become Stock Browsing

Settings SHALL show stock-provider readiness, configuration, and diagnostics only. Stock results SHALL remain searchable from the editor's Stock surface, and selecting or testing a provider in Settings SHALL NOT admit media to a project or create global library records.

#### Scenario: Operator configures a stock provider

- **WHEN** the operator opens Pexels or Freesound setup in Settings
- **THEN** credentials and diagnostics are shown without stock search results

#### Scenario: Operator searches for stock

- **WHEN** the operator wants to find an image, video, music bed, or sound effect
- **THEN** the existing editor Stock surface provides that search rather than Settings

#### Scenario: Operator tests a stock provider

- **WHEN** a provider connection test succeeds
- **THEN** no project asset, timeline clip, or global Library record is created

### Requirement: One Endpoint Selects The Provider For Any Capability

Activating a provider for a capability SHALL go through one endpoint that takes
the capability and the provider id. A capability SHALL NOT carry its own
selection route.

Three routes doing one thing is why the surface needed three hooks and three
status shapes; a fourth capability would have added a fourth of each.

#### Scenario: Activating a provider

- **WHEN** an operator activates a registered, ready provider for a capability
- **THEN** the selection is persisted and every path resolving that capability
  resolves to it

#### Scenario: Activating a provider that cannot serve the capability

- **WHEN** the named provider does not implement the named capability
- **THEN** the write is refused and the stored selection is unchanged

#### Scenario: Activating an unconfigured provider

- **WHEN** the named provider is registered but reports `unconfigured`
- **THEN** the write is refused with a message naming the missing configuration,
  rather than persisting a choice that fails at every later request

### Requirement: The Surface Is Four Levels And Every Level Is Addressable

Settings SHALL be navigable as `settings → capability → provider → provider
setup`, and each level SHALL have its own route. Navigation state SHALL NOT live
only in client-side component state.

An unaddressable level cannot be linked, cannot be returned to by the browser's
back button, and cannot be photographed by visual regression without a synthetic
click — which is how a settings tab went uncovered while 297 green snapshots
reported success.

#### Scenario: Deep-linking to a provider's setup

- **WHEN** a URL naming a capability and a provider is opened directly
- **THEN** that provider's setup is shown, with its capability and provider list
  in their selected state

#### Scenario: Returning from a provider

- **WHEN** an operator navigates into a provider and then goes back
- **THEN** the browser's back button returns to the provider list for that
  capability

#### Scenario: Landing on a level the route did not name, with columns side by side

- **WHEN** a level is opened without naming what to select and the columns are
  side by side
- **THEN** the first item is selected — the default provider where there is one —
  because an unselected column is an empty pane beside two full ones

#### Scenario: Landing on a level the route did not name, one column at a time

- **WHEN** the same address is opened where only one column fits
- **THEN** nothing is selected, because a selected item would BE the screen and
  would replace the list the operator opened it to read

#### Scenario: What a filled-in selection does to the address

- **WHEN** a selection is filled in rather than named by the route
- **THEN** the address is unchanged, so it still names exactly what was asked for
  and the back button has no filled-in step to undo

#### Scenario: Which provider is serving a capability

- **WHEN** an operator looks at a capability's provider list
- **THEN** the one currently serving it is marked as the default, beside every
  sibling that is not — which answers the question for the whole list rather than
  only for whichever row is open

### Requirement: The Surface Collapses By Width Without A Second Model

The surface SHALL render the same navigation tree at every width, varying only
how many levels are visible at once. A narrow viewport SHALL show one level at a
time with a path back to the parent.

Two layouts built from two state models drift. One path rendered at different
depths cannot.

#### Scenario: Wide viewport

- **WHEN** the viewport is wide enough for three panes
- **THEN** capabilities, providers, and the selected provider's setup are visible
  at once

#### Scenario: Narrow viewport

- **WHEN** the viewport is too narrow for three panes
- **THEN** one level is shown at a time, each with a control returning to its
  parent level

#### Scenario: The tree does not change with width

- **WHEN** the same route is opened at any width
- **THEN** the same node is selected, and only the number of visible levels
  differs

### Requirement: A List Row States One Thing

A row in the capability list or the provider list SHALL state its name, its
state, and at most one supporting fact. Configuration detail, diagnostics, and
explanatory prose SHALL live on the provider's own page.

The surface this replaces put installed-binary lists, cache sizes, tool counts and
a six-line safety warning onto shared cards, which made the state — the only thing
a list is read for — the hardest thing on it to find.

#### Scenario: A provider row

- **WHEN** a provider is listed under a capability
- **THEN** the row shows its name, whether it is configured, and whether it is the
  active provider

#### Scenario: Provider detail

- **WHEN** an operator opens a provider
- **THEN** its configuration fields, diagnostics, and any guidance specific to it
  are shown there

#### Scenario: A row does not name an environment variable

- **WHEN** a provider requires configuration
- **THEN** the list row reports that it is unconfigured without naming the
  variable, because a variable named in a list is a form that failed to exist

### Requirement: Settings Reports Configuration Overridden By The Environment

The settings surface SHALL report every stored configuration value that an
environment variable is currently overriding.

Precedence that is implemented but not reported produces the worst failure this
change can cause: an operator sets a value in the UI, an environment variable
shadows it, the change has no effect, and no surface explains why.

#### Scenario: A stored value is shadowed

- **WHEN** a value is stored and the matching environment variable is also set
- **THEN** the surface reports that the environment variable is in effect and the
  stored value is not

#### Scenario: Nothing is shadowed

- **WHEN** no stored value is overridden
- **THEN** the surface reports nothing, rather than an empty warning region

### Requirement: Global settings are instance-owner controls

The global provider selection, credentials, registration, and security actions exposed by Settings SHALL appear under God Mode and SHALL require the instance-owner role on the server. Read endpoints needed for normal editor capability display SHALL return only non-sensitive readiness data to authenticated workspace members. Workspace-specific configuration SHALL remain tied to its workspace and authorized separately. Existing provider hierarchy, secret masking, and environment-override reporting SHALL be preserved.

#### Scenario: Member attempts to change a global provider

- **WHEN** an authenticated non-owner submits a global provider-selection or credential update
- **THEN** the API refuses it and the effective configuration does not change

#### Scenario: Member opens editor readiness

- **WHEN** a workspace member opens an editor that needs provider readiness
- **THEN** it receives the non-sensitive readiness projection without access to admin settings or secret metadata

#### Scenario: Owner edits an overridden setting

- **WHEN** an environment variable overrides a stored global setting
- **THEN** God Mode explains the effective source and does not imply the stored value is active
