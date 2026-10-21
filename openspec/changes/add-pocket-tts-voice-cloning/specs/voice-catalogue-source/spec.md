## MODIFIED Requirements

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
