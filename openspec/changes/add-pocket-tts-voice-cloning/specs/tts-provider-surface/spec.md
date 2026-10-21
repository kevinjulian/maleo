## ADDED Requirements

### Requirement: A voice bound to one provider is not carried to another

Where a stored selection names a voice that belongs to a specific provider — a
clone, which only its own provider can speak — a change of effective provider
SHALL be reported as invalidating that selection.

The system SHALL NOT substitute another provider's voice for it, and SHALL NOT
pass the id through to a provider that does not know it. Both failures surface
at render time as wrong audio or an unexplained error, which is precisely what
provider selection refuses elsewhere.

#### Scenario: Switching providers invalidates a provider-bound voice

- **WHEN** a stored selection names a clone and the effective provider changes to
  one that cannot speak it
- **THEN** the surface reports the selected voice as unusable under the new
  provider and asks for a choice

#### Scenario: No silent substitution

- **WHEN** a synthesis would run with a voice the resolved provider does not know
- **THEN** it fails with a message naming the voice and the provider rather than
  synthesizing with a different voice

#### Scenario: A provider-declared voice is unaffected

- **WHEN** a stored selection names a provider-declared voice and the provider is
  unchanged
- **THEN** nothing about that selection changes

### Requirement: Synthesis is requested with named arguments

The shared synthesis entry point SHALL take its arguments as a single named
structure rather than as a positional list.

It carries text, voice, provider, language, and the workspace, most of them
optional strings, so position is the only thing distinguishing them and a
transposition is invisible to the type checker. The workspace ceases to be
optional once the voice catalogue is workspace-scoped, and a caller SHALL NOT
have to pass a placeholder through an unrelated parameter to reach it.

#### Scenario: A caller names what it passes

- **WHEN** a caller requests a synthesis
- **THEN** each argument is named at the call site, and no placeholder is passed
  to reach a later one

#### Scenario: A transposition is caught

- **WHEN** two arguments of the same type are supplied under the wrong names
- **THEN** it is a type error rather than a synthesis that fails at the provider

#### Scenario: Behavior is unchanged by the conversion

- **WHEN** the conversion lands
- **THEN** every existing caller requests the same synthesis it requested before,
  with no change in resolved provider, voice, or output
