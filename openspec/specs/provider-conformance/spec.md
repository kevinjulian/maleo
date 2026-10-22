# provider-conformance Specification

## Purpose

The contract every content provider satisfies, and the shared suite that proves
it. Providers live behind one seam (`ContentProvider`) and are chosen through one
registry, so the invariants the registry depends on have to hold for all of them,
not only for the ones whose own package remembered to test them.

Written because the registry's selection requires a capability to be both
declared and implemented. A provider that declares a capability it does not
implement is therefore silently invisible rather than broken — the failure mode a
contract test exists to catch.

## Requirements

### Requirement: Shared Provider Conformance Suite

The media package SHALL export a reusable conformance suite that asserts the
`ContentProvider` contract, and every registered provider SHALL pass it.

#### Scenario: New provider is added

- **WHEN** a provider package adds its tests
- **THEN** one call to the exported conformance suite asserts every contract
  invariant, so the package does not have to guess which invariants matter

#### Scenario: Provider is registered without its own test

- **WHEN** a provider is added to the registry
- **THEN** a registry-level conformance run covers it anyway

#### Scenario: Registry ids collide

- **WHEN** two registered providers declare the same `meta.id`
- **THEN** conformance fails, because `providerById` would silently drop one

### Requirement: Capability Declaration Matches Implementation

A provider's declared capabilities and its implementations SHALL agree in both
directions.

#### Scenario: Declared capability has no implementation

- **WHEN** a provider lists a capability in `meta.capabilities` but ships no
  implementation for it
- **THEN** conformance fails, because `providersFor` filters the provider out
  silently and it appears registered while never being offered

#### Scenario: Implementation is not declared

- **WHEN** a provider ships an implementation for a capability absent from
  `meta.capabilities`
- **THEN** conformance fails, because the registry will never route to it

#### Scenario: Model names a capability the provider does not have

- **WHEN** `meta.models` names a capability outside `meta.capabilities`
- **THEN** conformance fails

### Requirement: Health Reports Absence Rather Than Throwing

A provider's `health()` SHALL resolve to a known state when its external
dependency is unavailable, and SHALL NOT throw.

#### Scenario: Dependency is entirely absent

- **WHEN** `health()` is called with no session, credential, or binary present
- **THEN** it resolves to `ready`, `unconfigured`, or `down`, because those
  states exist so that absence is a value rather than an exception

#### Scenario: Health is asked about each declared capability

- **WHEN** `health(capability)` is called for every capability the provider
  declares
- **THEN** each call resolves to one of the known states

#### Scenario: Conformance runs without external services

- **WHEN** the conformance suite runs in continuous integration
- **THEN** it passes with no browser session, API key, or provider binary
  available

### Requirement: Image reference support is declared

Every registered image provider SHALL declare its image reference support mode in provider metadata.
The mode SHALL be one of native reference input, text-only reference fallback, or no reference
support. When support depends on a configured model, metadata SHALL report the effective mode for
that model.

#### Scenario: Registered image provider declares reference mode

- **WHEN** conformance checks a registered provider with image capability
- **THEN** provider metadata names a valid image reference support mode

#### Scenario: Model-specific provider reports effective mode

- **WHEN** an image provider's reference support depends on its configured model
- **THEN** metadata reports the mode for the model that generation would run

### Requirement: Reference metadata governs generated request shape

The media worker SHALL use provider reference metadata to decide whether native reference URLs are
passed to the provider and how references are described in the prompt. Provider adapters SHALL NOT
silently reinterpret a reference mode differently from their metadata.

#### Scenario: Native provider receives urls

- **WHEN** an image provider declares native reference support and an image intent includes references
- **THEN** the generated provider request includes ordered reference URLs

#### Scenario: Text-only provider receives no urls

- **WHEN** an image provider declares text-only reference support and an image intent includes references
- **THEN** the generated provider request includes no reference URLs and the provider prompt contains a textual reference brief

#### Scenario: Conformance detects invalid mode

- **WHEN** a provider declares image capability with missing or invalid reference metadata
- **THEN** provider conformance fails

### Requirement: Conformance Covers The Implementation, Not A Wrapper

Every registered provider SHALL be asserted by the shared conformance suite from
the directory that holds its implementation, with no adapter layer between the
suite and the code under test.

The suite exists to catch a provider whose declared capabilities and shipped
implementations disagree. When metadata lives beside a wrapper and the
implementation lives in another package, the two can diverge in ways the suite
observes only through the wrapper — which is the seam whose correctness it was
written to prove.

#### Scenario: A provider's tests run

- **WHEN** a provider's test file calls the conformance suite
- **THEN** it imports the provider from its own directory in the media package

#### Scenario: A provider is registered

- **WHEN** the registry-level conformance run enumerates providers
- **THEN** every registered provider is covered, including any whose own
  directory has no additional tests

#### Scenario: A provider ships no test file of its own

- **WHEN** a provider directory contains no test
- **THEN** the registry-level run still asserts its contract, so consolidation
  cannot quietly drop coverage that a package's own suite used to provide

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
