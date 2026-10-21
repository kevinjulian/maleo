## ADDED Requirements

### Requirement: A cloned voice is an identified record, not an audio file passed around

The system SHALL represent an operator-supplied voice as a stored record with a
stable id, a label, a language, the provider that can speak it, and the location
of the reference audio it was created from.

That id SHALL be the voice identity everywhere a voice identity already travels
— selections, stored documents, cache keys, staleness hashes, and the speech
ledger. No surface above the provider boundary SHALL carry the reference audio
location alongside the voice.

Changing which audio a voice is based on SHALL produce a different clone with a
different id. A record's reference audio SHALL NOT be replaced in place, because
a voice whose sound changes while its id does not would leave every cache entry
and every staleness hash naming it silently wrong.

#### Scenario: A clone is chosen like any other voice

- **WHEN** an operator selects a clone on any surface that selects a voice
- **THEN** the clone's id is stored exactly as a provider-declared voice id would
  be, with no additional field

#### Scenario: Re-recording produces a new voice

- **WHEN** an operator supplies different audio for a voice they already created
- **THEN** a new clone with a new id results, and material rendered with the
  previous clone continues to name the previous id

#### Scenario: Cached audio is not reused across clones

- **WHEN** the same text is synthesized under two clones
- **THEN** each synthesis produces its own audio, because the voice identity
  differs

#### Scenario: Regeneration follows a changed voice

- **WHEN** a scene's voice is changed from one clone to another
- **THEN** the scene's audio is considered stale and regenerated, because the
  voice recorded in its staleness hash changed

### Requirement: A clone belongs to one workspace

The system SHALL scope every clone to the workspace that created it. A clone
SHALL be listable, selectable, and removable only within that workspace.

The workspace SHALL be derived from the authoritative record of ownership rather
than accepted from a request body, matching how workspace ownership is
determined everywhere else in the system.

#### Scenario: A clone is listed in its own workspace

- **WHEN** an operator lists voices in the workspace that created a clone
- **THEN** that clone appears

#### Scenario: A clone is invisible to another workspace

- **WHEN** an operator lists voices in a different workspace
- **THEN** that clone does not appear, and naming its id does not synthesize with
  it

#### Scenario: The workspace is not taken from the caller

- **WHEN** a request to create or use a clone names a workspace in its body
- **THEN** the body's value does not determine ownership

### Requirement: A clone belongs to the provider that can speak it

Every clone SHALL record the provider it was created for, and SHALL be offered
only under that provider.

A stored selection naming a clone that the effective provider cannot speak SHALL
be reported as unusable rather than substituted with another voice. A voice
silently swapped for a different one is the invisible substitution the voice
catalogue already refuses when a provider is unconfigured.

#### Scenario: A clone is offered under its own provider

- **WHEN** an operator browses voices for the provider a clone was created for
- **THEN** the clone is listed among that provider's voices

#### Scenario: A clone is not offered under another provider

- **WHEN** an operator browses voices for a different provider
- **THEN** the clone is not listed

#### Scenario: A selection is invalidated by a provider change

- **WHEN** a stored selection names a clone and the effective provider is changed
  to one that cannot speak it
- **THEN** the surface reports that the selected voice cannot be used, and does
  not silently synthesize with a different voice

### Requirement: Creating a clone is an explicit act with a named result

The system SHALL let an operator create a clone by supplying reference audio, a
label, and the provider it is for, and SHALL reject audio it cannot use rather
than accepting it and failing at synthesis time.

A created clone SHALL be immediately selectable on every surface that lists
voices for its provider, with no further step.

#### Scenario: An operator creates a clone

- **WHEN** an operator uploads reference audio with a label
- **THEN** a clone is created in their workspace and appears in that provider's
  voice list

#### Scenario: Unusable audio is refused at upload

- **WHEN** the supplied file is not audio the provider can take as a voice prompt
- **THEN** creation is refused with the reason, and no clone is created

#### Scenario: A new clone needs no second step

- **WHEN** a clone has just been created
- **THEN** it is selectable wherever that provider's voices are listed, without a
  rebake, a restart, or a manual refresh of any list

### Requirement: Removing a clone does not make past spend unattributable

Removal SHALL hide a clone from every list while preserving the record that
past syntheses name, matching how generated media is removed elsewhere in the
system. A metered, billed synthesis SHALL remain attributable to the voice that
produced it after the library is tidied.

#### Scenario: A removed clone leaves the lists

- **WHEN** an operator removes a clone
- **THEN** it no longer appears on any surface that lists voices

#### Scenario: Past syntheses stay attributable

- **WHEN** a ledger entry names a clone that has since been removed
- **THEN** that entry still resolves to the voice it was synthesized with

#### Scenario: A removed clone cannot be used again

- **WHEN** a synthesis names a removed clone
- **THEN** it is refused rather than served from a cache entry or resurrected

### Requirement: Reference audio is a recording of a person and is handled as such

The system SHALL store reference audio within the workspace that owns it, under
the existing upload path rules, and SHALL make it removable by the operator.

The system SHALL NOT claim to verify consent, identity, or that the speaker in
the audio is the operator supplying it. Deployments serving third parties need
controls beyond what this capability provides, and this requirement exists so
that absence is recorded rather than assumed to be settled.

#### Scenario: Reference audio is scoped to its workspace

- **WHEN** reference audio is stored for a clone
- **THEN** it is reachable only through that workspace's clone, under the same
  path safety rules as every other upload

#### Scenario: An operator removes the audio they supplied

- **WHEN** an operator removes a clone
- **THEN** the reference audio is removable with it rather than retained
  indefinitely with no way to withdraw it
