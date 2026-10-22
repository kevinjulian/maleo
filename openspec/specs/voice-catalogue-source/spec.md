# Voice Catalogue Source

## Purpose

Where the list of selectable voices comes from, and why there is exactly one of
it. Voice ids, names, descriptions and display colour resolve from a single
catalogue, so no two surfaces can present the same voice differently.

Which voices a surface offers follows from what that surface DOES with one. A
surface that BINDS a voice into a stored document gets the provider that will
actually perform the synthesis, so it cannot offer a voice that will not be
spoken. A surface that only BROWSES or AUDITIONS gets every registered provider's,
because both are reading — restricting it hides voices that are installed,
healthy and already baked, and makes hearing one clip cost a change to what every
project renders with.

This exists because there were four lists. Two canonical ones (each provider's
real speaker ids) and two derived copies that drifted from them: one served a
single provider's voices whatever provider was configured, and one was
hand-written in the client with its own colours and a missing voice. The colour in
particular had two derivations, so one voice drew differently in a library listing
than in a storyboard export.

A fifth copy outlived those. The module that resolved the catalogue held a
ternary over the two provider names it knew and imported each provider's voice
constant by name, so the set of providers was restated here as well — and adding
one meant editing this file, the wire types, the sample bake, and three arrays in
the web app. Voices now arrive as metadata on whichever providers are registered.
The rule the whole capability rests on is therefore stronger than "one list":
a provider's voices belong to that provider, and nothing outside the registry
names them.

## Requirements

### Requirement: One catalogue is the source for every voice-bearing surface

The system SHALL resolve the list of selectable voices from a single catalogue.
That catalogue SHALL be the metadata each provider declares alongside its
implementation, unioned with the calling workspace's stored voice clones for
that provider. A provider's declared voices SHALL live with that provider, so
adding a TTS provider adds its voices and nothing outside the registry names
them.

The two halves of that union SHALL be disjoint by construction: a
provider-declared voice is never a stored clone, and a clone is never declared
in the registry. Neither half is a copy of the other, which is what keeps the
union a single source rather than two lists that can disagree.

Because clones are workspace-scoped, the catalogue SHALL be resolved for a
workspace. An endpoint serving it SHALL resolve the tenant the way every other
scoped surface does — an absent workspace resolves to the default tenant, and an
unregistered one is refused — rather than inventing a second rule for voices. A
workspace with no clones SHALL receive exactly the provider-declared list.

Every surface that lists, selects, or displays a voice — the voice catalogue
endpoint, the TTS status payload, the library's voice surface, the scene and
project pickers, the speech lab, the sample bake, and storyboard display — SHALL
read that catalogue rather than carrying its own copy of voice ids, names, or
descriptions.

A hardcoded voice list outside a provider's own metadata SHALL NOT exist, and no
package outside the provider registry SHALL import a specific provider's voice
constant. A voice that the configured provider can synthesize SHALL be listable,
and a voice that appears in a list SHALL be one the configured provider can
synthesize.

#### Scenario: A surface cannot drift from the catalogue

- **WHEN** a voice is added to or removed from a provider's catalogue
- **THEN** every voice-bearing surface reflects the change without a second edit,
  because no surface holds its own list

#### Scenario: A listed voice is a synthesizable voice

- **WHEN** an operator selects any voice offered by any surface
- **THEN** synthesis with that voice reaches the provider that offers it

#### Scenario: A provider's voices arrive with the provider

- **WHEN** a TTS provider is registered
- **THEN** its voices are available to every voice-bearing surface through its
  metadata, with no voice list added anywhere else

#### Scenario: No consumer names a provider's voice constant

- **WHEN** a package outside the provider registry needs a provider's voices
- **THEN** it reads them from provider metadata rather than importing that
  provider's own catalogue constant

#### Scenario: A workspace's clones appear alongside declared voices

- **WHEN** a workspace holds clones for a provider and a surface lists that
  provider's voices
- **THEN** the declared voices and that workspace's clones are listed together as
  one catalogue, each identified for what it is

#### Scenario: A workspace with no clones sees no change

- **WHEN** a workspace holds no clones
- **THEN** every voice-bearing surface receives exactly the provider-declared
  list it received before clones existed

#### Scenario: One workspace's clones do not leak into another's catalogue

- **WHEN** the catalogue is resolved for a workspace
- **THEN** it contains that workspace's clones and no other workspace's

#### Scenario: A catalogue request naming no workspace

- **WHEN** a catalogue endpoint is called with no workspace
- **THEN** it resolves the default tenant, exactly as every other scoped surface
  does, and serves that tenant's catalogue

#### Scenario: A catalogue request naming an unregistered workspace

- **WHEN** a catalogue endpoint is called with a workspace the registry does not
  know
- **THEN** it refuses, rather than falling back to the default tenant's
  catalogue under the name the caller asked for

#### Scenario: The declared catalogue is readable with the service down

- **WHEN** a provider's service is unreachable
- **THEN** its declared voices are still listable, because the catalogue is read
  from the registry and the database rather than fetched from the service

### Requirement: The catalogue is resolved for the effective provider

What a surface offers SHALL follow from what that surface DOES with the voice it
lists, and there are two kinds.

A surface that BINDS a voice — writes it into a project, a scene, or any stored
document that a later synthesis will read — SHALL offer only the voices of the
provider that will actually perform that synthesis. It SHALL NOT serve one
provider's voices while a different provider is configured. A voice bound from a
provider that will not run is a failure deferred to render time, which is the
invisible substitution this capability exists to prevent.

A surface that only BROWSES or AUDITIONS — lists the catalogue, plays a sample,
or synthesizes once without persisting the choice — SHALL offer every registered
provider's voices, and SHALL identify which provider each voice belongs to.
Restricting such a surface to the effective provider hides voices that are
installed, healthy, and auditionable, and forces an operator to change what every
project renders with in order to hear one clip.

Where a surface lets the operator choose a provider, it SHALL present that
provider's list, resolved for whichever provider is chosen — for every registered
TTS provider, not a fixed set the surface knows by name. A provider that cannot
serve SHALL be presented as unavailable rather than silently offered.

#### Scenario: A binding surface offers only what will run

- **WHEN** an operator opens a surface that binds a voice into a stored document
- **THEN** only the effective provider's voices are listed, and no other
  provider's are

#### Scenario: A browsing surface offers every registered provider

- **WHEN** an operator opens a surface that lists the voice catalogue without
  binding anything, and a provider is registered and healthy but not the
  effective one
- **THEN** that provider's voices are listed too, each identified by the provider
  it belongs to

#### Scenario: Auditioning a voice does not change what projects render with

- **WHEN** an operator browses or synthesizes once with a provider that is not
  the effective one
- **THEN** the app-wide provider selection is unchanged, and the next project
  render still uses the provider that was selected

#### Scenario: Selecting a provider re-resolves the list

- **WHEN** the operator switches the provider on a surface that offers the choice
- **THEN** the voice list becomes that provider's, and a voice chosen under the
  previous provider is not carried over

#### Scenario: A newly registered provider is offered without a surface change

- **WHEN** a TTS provider is registered and an operator opens a surface that
  offers a provider choice
- **THEN** that provider and its voices are offered, because the surface renders
  the registered providers rather than a list it holds

#### Scenario: A provider that cannot serve is not silently offered

- **WHEN** a registered provider reports itself unconfigured or down on a surface
  that offers a provider choice
- **THEN** it is presented as unavailable rather than as a selectable option

#### Scenario: An unconfigured provider offers no false choice

- **WHEN** no TTS provider is configured
- **THEN** the surface reports that state rather than listing voices that cannot be
  synthesized

### Requirement: A voice's display identity is derived once

A voice's display attributes — its name, description, language, gender, and the
colour it is drawn with — SHALL be derived by one rule from the catalogue, so the
same voice is presented identically everywhere.

Where a provider encodes an attribute in its voice ids, that attribute SHALL be
derived from the id rather than restated per voice, so a catalogue of dozens of
voices cannot disagree with itself.

Two surfaces SHALL NOT compute a voice's colour by different rules. A voice
resolved for display SHALL yield the same colour in a library listing as in a
storyboard export.

#### Scenario: One voice, one colour

- **WHEN** the same voice is shown in the library surface and in a storyboard
  export
- **THEN** both draw it with the same colour

#### Scenario: A derivable attribute is not restated

- **WHEN** a provider's voice ids encode language or gender
- **THEN** those attributes are computed from the id, and the catalogue does not
  carry a second hand-written value that could disagree

#### Scenario: A voice absent from the catalogue degrades to a name

- **WHEN** a stored record names a voice the catalogue no longer offers
- **THEN** the surface shows the stored name without inventing a description, and
  does not fail

#### Scenario: A speaker with an explicit custom voice keeps it

- **WHEN** a speaker carries its own voice description and colour rather than a
  catalogue voice id
- **THEN** those explicit values are used and the catalogue is not consulted

### Requirement: A large catalogue is presented grouped, not flat

Where a surface offers more voices than can be scanned as a single list, it SHALL
group them, and SHALL place the operator's own working language ahead of the
rest.

A surface listing more than one provider SHALL make each voice's provider
visible, and SHALL let the operator narrow the list to one provider without
losing the ability to search across all of them. Two providers may ship voices
with the same display name, so the provider is part of a voice's identity on such
a surface rather than decoration.

The grouping keys are the language and provider already carried by each voice, so
they cost no new per-voice data.

#### Scenario: A provider with dozens of voices is listed

- **WHEN** an operator opens a voice picker for a provider offering dozens of
  voices
- **THEN** the voices are grouped by language rather than presented as one flat run

#### Scenario: A provider with a handful of voices is listed

- **WHEN** the provider offers few enough voices to scan at once
- **THEN** the surface remains readable without forcing a grouping that adds more
  structure than the list needs

#### Scenario: Several providers' voices are listed together

- **WHEN** a browsing surface lists more than one provider's voices
- **THEN** each voice shows which provider it belongs to, and the operator can
  narrow the list to a single provider

#### Scenario: Two providers ship a voice with the same name

- **WHEN** two registered providers each offer a voice with the same display name
- **THEN** both are listed and distinguishable, and neither is dropped as a
  duplicate

#### Scenario: Searching reaches voices of every provider

- **WHEN** an operator searches a browsing surface without narrowing to a provider
- **THEN** matching voices from every registered provider are returned
