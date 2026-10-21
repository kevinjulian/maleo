## ADDED Requirements

### Requirement: A TTS provider declares where its voices come from

A TTS provider's metadata SHALL state whether the voices it can speak are
declared in the repository or supplied by the workspace as clones.

Conformance SHALL require a non-empty declared voice list from a provider whose
voices are declared, because such a provider with no catalogue is selectable and
offers nothing to speak with — a picker with no entries rather than an error.

Conformance SHALL accept an empty declared voice list from a provider whose
voices are cloned, because that provider has no speakers of its own by
construction: its catalogue is the calling workspace's clone library, and an
entry declared here would be a voice it cannot actually speak.

Every other rule on the declared list — unique ids, and an id, name and language
on each entry — SHALL apply to whatever entries are present, whichever kind of
provider declares them.

Absence of the declaration SHALL mean voices are declared, so that a provider
written before this distinction existed keeps the stricter check.

#### Scenario: A declaring provider ships no voices

- **WHEN** a provider whose voices are declared exposes an empty voice list
- **THEN** conformance fails, naming the provider as selectable with nothing to
  speak with

#### Scenario: A cloning provider ships no voices

- **WHEN** a provider whose voices are cloned exposes an empty voice list
- **THEN** conformance passes, because its voices live in the workspace's clone
  library rather than in its metadata

#### Scenario: An existing provider is unchanged

- **WHEN** a provider makes no voice-source declaration
- **THEN** it is treated as declaring its voices, and the non-empty requirement
  applies to it exactly as before

#### Scenario: Entry rules apply regardless of source

- **WHEN** any provider declares voice entries
- **THEN** duplicate ids, or an entry missing an id, name or language, fail
  conformance whichever kind of provider declared them
