# tts-provider-surface Specification

## Purpose

How a TTS provider is resolved, chosen, and reported — one resolution path, and a
provider set that no surface restates.

Written because there were two paths. The durable worker resolved TTS through the
provider registry like every other capability, while the synchronous route and
the chat agent resolved it from an environment string and branched on the value,
so which provider answered depended on which surface asked. That branch existed
for one provider — Canvas TTS, an enqueue-and-poll call into a different service
that could not satisfy the `TtsProvider` interface — and everything downstream
inherited its shape: a readiness boolean named after each provider on the wire, a
provider ternary in the voice catalogue, and three hardcoded provider arrays in
the web app. Adding a provider meant editing all of them.

Removing Canvas removed the reason for the second path, which is what let TTS
adopt the shape the image capability already had: a list derived from the
registry, and a stored choice a settings surface can both see and write.

The stored choice is a deployment decision about what every project renders with.
Hearing what a provider sounds like is not, so a surface that persists nothing can
name its own provider for one synthesis without touching it.

## Requirements

### Requirement: TTS Resolves Through The Provider Registry Everywhere

Every path that synthesizes speech — the synchronous TTS route, the chat agent's
voiceover tool, and the durable media worker — SHALL resolve its provider through
the shared provider selection, with the same
`project → workspace/global → env → first-registered` precedence every other
capability uses. A second provider-resolution path for TTS SHALL NOT exist.

The media worker already resolved TTS this way while the route and the agent
resolved it from an environment string. Two dispatchers meant the provider that
answered depended on which surface asked, and it was the string dispatcher that
forced every downstream surface to name providers as literals.

#### Scenario: The route and the worker agree

- **WHEN** the same workspace synthesizes through the synchronous route and
  through the durable worker with the same selection
- **THEN** both resolve to the same provider

#### Scenario: The chat agent synthesizes

- **WHEN** the chat agent's voiceover tool synthesizes speech
- **THEN** it resolves its provider through the same selection, not through its own
  branch

#### Scenario: A provider is added

- **WHEN** a TTS provider is added to the registry
- **THEN** it becomes selectable from every synthesis path and every surface
  without an edit outside the registry

### Requirement: No Surface Enumerates TTS Providers By Name

The TTS status payload SHALL carry a list of providers derived from the registry,
each entry naming its id, its display label, and its health. The payload SHALL
NOT carry a per-provider readiness field. No route logic and no client SHALL hold
a hardcoded list of provider ids, provider labels, or a branch per provider id.

A per-provider field and a hardcoded client array both make adding a provider an
edit in every package that renders one. The provider list is the payload.

#### Scenario: A provider is added and appears unchanged

- **WHEN** a TTS provider is registered
- **THEN** it appears in the status payload and in every provider-choosing surface
  with its label and health, with no client change

#### Scenario: A provider is removed and disappears

- **WHEN** a TTS provider is removed from the registry
- **THEN** it stops appearing in every surface, and no client retains its name

#### Scenario: A client renders provider labels

- **WHEN** a surface displays the name of a TTS provider
- **THEN** the label comes from the payload, not from a lookup table in the client

#### Scenario: Readiness is reported per provider in the list

- **WHEN** one TTS provider is configured and another is not
- **THEN** each is listed with its own health, and the payload carries no
  field named for a specific provider

### Requirement: The TTS Provider Selection Is Persisted And Reported

The system SHALL persist an app-wide TTS provider selection, and SHALL expose
reading and writing it on the same terms as every other capability's selection —
through the one shared capability-provider endpoint, not a route of its own. The
status it reports SHALL distinguish the provider that was selected from the
provider that will actually run, and SHALL state where the selection came from.

An operator who selected a provider that has since become unreachable needs to
see both facts. Reporting only the effective provider hides that a choice was
made; reporting only the selection hides that it is not being honoured.

"On the same terms" was written when TTS, image and text each had their own
selection route and the phrase described an intended symmetry. It is now literal:
one endpoint takes the capability and the provider id, so a capability added later
inherits selection rather than adding a fourth route and a fourth status shape.

#### Scenario: Reading the selection

- **WHEN** the TTS provider setting is read
- **THEN** it reports the selected provider, the effective provider, the source of
  the selection, and the registry-derived provider list

#### Scenario: Selecting a provider

- **WHEN** an operator selects a registered, ready TTS provider
- **THEN** the selection is persisted and every synthesis path resolves to it

#### Scenario: Selecting a provider that is not registered

- **WHEN** a selection names a provider that does not implement `tts`
- **THEN** the write is refused and the stored selection is unchanged

#### Scenario: Selecting a provider that is unconfigured

- **WHEN** a selection names a registered provider that reports `unconfigured`
- **THEN** the write is refused with a message naming the missing configuration,
  rather than persisting a choice that fails at every synthesis

#### Scenario: Clearing the selection

- **WHEN** the selection is cleared
- **THEN** resolution falls back to the env default, and then to the first
  registered provider reporting ready

#### Scenario: A selected provider becomes unreachable

- **WHEN** the persisted provider stops reporting ready
- **THEN** the status reports the selection, reports that resolution failed, and
  states why — rather than silently synthesizing through a different provider

#### Scenario: Selection goes through the shared endpoint

- **WHEN** a TTS provider is selected
- **THEN** it is written through the capability-provider endpoint naming `tts`,
  and no TTS-specific selection route exists

### Requirement: A Retired Provider Id Does Not Break A Stored Selection

When a stored provider selection names a TTS provider that is no longer
registered, the system SHALL recover to the default rather than failing
synthesis, on every surface that stores one.

An id stored before a provider was retired is stale configuration, not operator
error: the configuration did not change, the code did.

#### Scenario: A global selection names a retired provider

- **WHEN** the persisted app-wide TTS provider is not in the registry
- **THEN** resolution falls through to the registry default and the surface
  reports the provider that actually ran

#### Scenario: A creative setting names a retired provider

- **WHEN** a stored project or scene voice-provider setting names a provider that
  no longer exists
- **THEN** it is treated as unset and the effective provider is used, rather than
  rejecting the stored document

### Requirement: TTS Provider Selection Is Not Configured By An Environment Switch

A dedicated environment variable naming the TTS provider by product name SHALL
NOT exist. Provider choice SHALL go through the persisted selection or the shared
per-capability env default that every capability uses.

A product-named switch is a second selection mechanism with its own precedence,
invisible to the settings surface that claims to report what is selected.

#### Scenario: The retired switch is left set

- **WHEN** a deployment still carries the removed environment variable
- **THEN** nothing reads it, and the reported selection reflects only the
  mechanisms that are live

#### Scenario: Choosing a provider by environment

- **WHEN** an operator wants to fix the TTS provider without a stored setting
- **THEN** the shared per-capability env default is the mechanism, the same one
  the image and text capabilities use

### Requirement: Trying A Provider Is Separable From Selecting One

A surface that synthesizes without persisting the result into a stored document
SHALL let the operator name the provider for that synthesis alone. Doing so SHALL
NOT write the app-wide selection, and SHALL NOT change which provider any later
synthesis resolves to.

The app-wide selection is a deployment decision about what every project renders
with. Hearing what a provider sounds like is not, and requiring the first in
order to do the second means an operator changes production to run an experiment.

The per-call provider SHALL be honoured with the same precedence and the same
failures as any explicit choice: an id naming no registered provider, or one that
cannot serve, SHALL fail loudly rather than falling back to another provider.

#### Scenario: A one-off synthesis names its provider

- **WHEN** an operator synthesizes on a surface that persists nothing, choosing a
  registered ready provider that is not the effective one
- **THEN** that provider performs the synthesis

#### Scenario: The app-wide selection is untouched

- **WHEN** that synthesis completes
- **THEN** the stored selection and the effective provider are what they were
  before it ran, and the next synthesis elsewhere resolves unchanged

#### Scenario: The chosen provider cannot serve

- **WHEN** the named provider is unconfigured or unregistered
- **THEN** the synthesis fails naming that provider, rather than being served by
  a different one

#### Scenario: The record names the provider that ran

- **WHEN** a one-off synthesis is recorded
- **THEN** the record names the provider that actually performed it, not the
  app-wide selection

### Requirement: A Surface Offering A Provider Choice Shows Which Can Serve

A surface that offers a choice of TTS provider SHALL present each registered
provider's readiness, and SHALL NOT present a provider that cannot serve as a
selectable option.

A choice that fails at the point of use is worse than a choice withheld: the
operator has already written the text and picked the voice before learning the
provider was never reachable.

#### Scenario: An unconfigured provider is offered

- **WHEN** a registered TTS provider reports itself unconfigured on a surface
  offering the choice
- **THEN** it is shown as unavailable and cannot be selected

#### Scenario: Switching provider clears a voice the new one cannot speak

- **WHEN** the operator changes provider on such a surface
- **THEN** a voice chosen under the previous provider is not carried into the
  request, because a voice id is meaningful only to the provider that offers it

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
