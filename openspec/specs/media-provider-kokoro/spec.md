# media-provider-kokoro Specification

## Purpose

The second self-hosted TTS provider: what configures it, what it reports for
health, where its voices come from, and the service it dials.

Written because three of its properties are ones a reader cannot infer from the
code alone. Its voice catalogue is STATIC — declared in the repository rather
than fetched — so a surface can list its voices with the service down, which
means the catalogue and the service can silently disagree and something has to
keep them honest. Its language and gender are ENCODED IN EACH VOICE ID and
derived rather than restated, so an id whose prefix is unknown has to be an error
rather than a guess. And its deploy path lives in a platform's database OUTSIDE
this repository, where no gate here can observe it.

## Requirements

### Requirement: Kokoro Readiness Is Its Service URL

The Kokoro provider SHALL report `ready` for the `tts` capability when
`MALEO_KOKORO_URL` is configured, and SHALL report `unconfigured` otherwise. It
SHALL NOT report `ready` on the basis of any other provider's configuration.

An unset URL is the ordinary state of a deployment that has not stood the service
up. Reporting `unconfigured` rather than throwing is what lets first-ready
selection skip Kokoro and reach a provider that can actually synthesize, and what
lets a settings surface list Kokoro as an available-but-unconfigured choice.

#### Scenario: The service URL is unset

- **WHEN** `health("tts")` is called with `MALEO_KOKORO_URL` unset
- **THEN** it resolves to `unconfigured`, and first-ready selection skips Kokoro

#### Scenario: The service URL is set

- **WHEN** `MALEO_KOKORO_URL` names the deployed service
- **THEN** `health("tts")` resolves to `ready`

#### Scenario: Kokoro is selected while unconfigured

- **WHEN** an operator or env var explicitly selects `kokoro` for `tts` with no
  service URL configured
- **THEN** selection fails loudly naming Kokoro as unconfigured, rather than
  substituting a different provider's voice

#### Scenario: An undeclared capability is asked about

- **WHEN** `health(capability)` is called for a capability Kokoro does not declare
- **THEN** it resolves to `unconfigured`

### Requirement: Kokoro Synthesizes Through The Shared OpenAI-Speech Client

The Kokoro provider SHALL implement the `tts` capability by calling the deployed
service's OpenAI-compatible speech endpoint through the same client Supertonic
uses, configured with Kokoro's model name, health probe path, and supported
response formats. A second copy of that client SHALL NOT exist.

Both services speak the same request contract and differ only in those three
values. A duplicated client is how one contract comes to be understood two ways,
and this repository has already paid for one duplicate.

#### Scenario: Speech is synthesized

- **WHEN** the Kokoro TTS implementation is invoked with text and a voice id
- **THEN** it writes a playable audio file to the media cache and returns its path

#### Scenario: The same text is synthesized twice

- **WHEN** synthesis is requested again with the same voice and text
- **THEN** the cached file is returned and `fromCache` is true

#### Scenario: Voice changes

- **WHEN** the same text is synthesized under a different voice
- **THEN** a distinct cache entry is produced, so one voice's output is never
  served for another

#### Scenario: A format the service cannot produce is requested

- **WHEN** synthesis is requested in a response format the provider does not
  declare as supported
- **THEN** the request is refused at the client boundary rather than at the
  service

#### Scenario: The service is unreachable

- **WHEN** the configured service does not answer its health probe path
- **THEN** the provider reports itself as not live and synthesis fails with a
  message naming the service, rather than returning silence or fabricated audio

#### Scenario: Conformance runs against Kokoro

- **WHEN** the shared provider conformance suite runs
- **THEN** Kokoro declares `tts`, ships an implementation for it, and passes

### Requirement: Kokoro Ships A Static Catalogue Of All Its Voices

The Kokoro provider SHALL declare, as provider metadata, a static catalogue of
every voice the deployed model offers. The catalogue SHALL be readable without
contacting the service, so an unconfigured provider can still be listed and the
sample bake can plan its work before dialing anything.

#### Scenario: The catalogue is read with the service down

- **WHEN** a surface lists Kokoro's voices while `MALEO_KOKORO_URL` is unset or
  the service is unreachable
- **THEN** the full voice list is returned from provider metadata with no network
  request

#### Scenario: Every voice is offered

- **WHEN** Kokoro's declared catalogue is compared against the voices the deployed
  model ships
- **THEN** every model voice appears in the catalogue, and no catalogue entry
  names a voice the model does not have

### Requirement: A Kokoro Voice's Language And Gender Derive From Its Id

Kokoro voice ids encode their language in the first character and their gender in
the second. The provider SHALL derive a voice's language and gender from its id
by that rule rather than restating them per voice, and SHALL fail at build or
test time on an id whose prefix is not a known language.

Restating a derivable attribute across dozens of entries is how one voice comes
to be grouped under the wrong language. Failing on an unknown prefix is what
keeps a new upstream voice from being silently ungrouped.

#### Scenario: An American English female voice

- **WHEN** the voice id `af_heart` is resolved
- **THEN** its language is US English and its gender is female

#### Scenario: A British English male voice

- **WHEN** the voice id `bm_george` is resolved
- **THEN** its language is British English and its gender is male

#### Scenario: A non-English voice

- **WHEN** the voice id `jf_alpha` is resolved
- **THEN** its language is Japanese and its gender is female

#### Scenario: An unrecognized prefix

- **WHEN** a voice id carries a language prefix outside the known set
- **THEN** it is reported as an error rather than being listed with an absent or
  guessed language

### Requirement: The Declared Catalogue Is Checked Against The Live Service

A test SHALL compare the static catalogue against the voice list the deployed
service reports, and SHALL run whenever the service URL is configured and skip
when it is not.

The catalogue is static so it can be read offline; an upstream image that changes
its voices would otherwise drift from it undetected until an operator picked a
voice that no longer exists.

#### Scenario: The service is configured

- **WHEN** the test runs with `MALEO_KOKORO_URL` set
- **THEN** it asserts the static catalogue and the service's reported voice list
  name exactly the same voices

#### Scenario: The service is not configured

- **WHEN** the test runs without a service URL
- **THEN** it is skipped rather than failing, so a local checkout with no
  deployment still passes

### Requirement: Kokoro Is Appended To The Registry

Kokoro SHALL be registered as first supported self-hosted `tts` provider after
restricted Supertonic removal. Existing explicit Kokoro selections SHALL remain
valid, and stale Supertonic selections SHALL migrate to unselected state so
normal health-aware selection can choose Kokoro when ready.

#### Scenario: No TTS provider is selected

- **WHEN** no project, workspace, environment, or global TTS provider is selected
  and Kokoro is configured
- **THEN** selection resolves to Kokoro

#### Scenario: Kokoro is chosen explicitly

- **WHEN** an operator selects Kokoro, or `MALEO_PROVIDER_TTS=kokoro` is set
- **THEN** synthesis resolves to Kokoro

#### Scenario: Stored Supertonic selection remains

- **WHEN** upgraded workspace contains retired Supertonic provider selection
- **THEN** migration clears stale selection and reports Kokoro readiness without
  silently preserving unsupported provider id

### Requirement: The Kokoro Service Deploys From Its Own `apps/` Directory

The Kokoro TTS service SHALL be built from a directory under `apps/` holding its
build definition and its deploy guidance, and no TypeScript. The client that
dials it SHALL live with the other providers in the media package, wired to the
service by its URL variable alone.

#### Scenario: A reader looks for what gets deployed

- **WHEN** someone asks which directory produces the Kokoro service image
- **THEN** the answer is a directory under `apps/`, and the client code is not in it

#### Scenario: The deploy configuration is recorded

- **WHEN** the deployable directory is introduced
- **THEN** its guidance names the deploy target, the build path, the path-watch
  trigger, the exposed port, and the healthcheck — none of which live in this
  repository and none of which any repository gate can observe

#### Scenario: The deployable directory is moved or renamed

- **WHEN** the directory the deploy target builds from is relocated
- **THEN** the deploy target's build path and path-watch trigger are updated in
  the same operation, before the push that moves the files
