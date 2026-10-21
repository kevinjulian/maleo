## ADDED Requirements

### Requirement: The provider is registered without displacing any existing default

The system SHALL register `pocket-tts-id` as a TTS provider appended after
`kokoro` in the registry, so that no capability's existing default changes when
it is added.

The provider SHALL declare Indonesian (`id`) as the only language it serves. An
Indonesian-only model that became the default for every language would narrate
English content through an Indonesian phonemizer, which fails as audio rather
than as an error.

#### Scenario: The default TTS provider is unchanged

- **WHEN** the provider is registered and no TTS provider is explicitly selected
- **THEN** synthesis still resolves to the provider that served it before, and
  `pocket-tts-id` is never chosen by absence of a choice

#### Scenario: The provider is selectable

- **WHEN** an operator selects `pocket-tts-id` on a surface that offers a
  provider choice
- **THEN** it is offered like any other registered provider, with its own
  readiness and its own voices, and no surface names it in code to do so

#### Scenario: The provider declares one language

- **WHEN** a surface groups or filters voices by language
- **THEN** every voice this provider offers reports `id`, and none reports
  another language

### Requirement: The service URL is configuration, not environment wiring

The provider SHALL declare its service URL as a `ProviderConfigField`, so the
value is entered in Settings, stored in the database, and distributed to the
media worker through the existing configuration service. The repository SHALL
NOT require an entry in the root `.env` for the provider to work.

An unset URL SHALL make the provider report `unconfigured` rather than throw, so
an unconfigured provider is a state a surface renders rather than an error a
synthesis raises.

#### Scenario: An operator configures the provider

- **WHEN** an operator enters the service URL in the provider settings surface
- **THEN** the value is persisted and the worker resolves it without a redeploy
  or a process restart

#### Scenario: The provider is unconfigured

- **WHEN** no service URL has been set
- **THEN** the provider reports `unconfigured`, is presented as unavailable, and
  offers no voices on a binding surface

#### Scenario: No environment file is required

- **WHEN** the repository is checked out and the stack is started
- **THEN** no root `.env` entry is needed for this provider, and its absence
  produces `unconfigured` rather than a failure at startup

### Requirement: Reachability is a real connection, distinct from configuration

The provider SHALL implement `reachable` as an actual request to the deployed
service's health path, separate from `health`, which SHALL remain offline and
cheap.

A URL that is set but points at nothing SHALL report unreachable with the
service's own reason attached, never a success.

#### Scenario: Test-before-save against a live service

- **WHEN** an operator tests a configured URL and the service answers its health
  check
- **THEN** the test reports success

#### Scenario: Test-before-save against a URL pointing at nothing

- **WHEN** an operator tests a URL where no service is listening
- **THEN** the test reports failure with the reason, rather than reporting
  success because a URL was set

#### Scenario: Health does not touch the network

- **WHEN** a settings surface renders and asks every provider for its health
- **THEN** this provider answers from configuration alone, with no request to
  the service

### Requirement: A reference voice reaches the service with the request

The provider SHALL accept an optional reference-audio location on its synthesis
input and send that audio to the service alongside the text. The service SHALL
hold no voice library: a voice prompt SHALL be supplied per request.

Synthesized audio SHALL be cached on a key that includes the voice identity, so
that two syntheses differing only in voice do not share a cache entry.

#### Scenario: Synthesis with a cloned voice

- **WHEN** synthesis runs with a voice whose reference audio has been resolved
- **THEN** the service receives both the text and that audio, and returns speech
  in that voice

#### Scenario: Two voices do not share a cache entry

- **WHEN** the same text is synthesized under two different voices
- **THEN** each produces and caches its own audio, and neither is served the
  other's

#### Scenario: The service holds no state between requests

- **WHEN** the service is restarted
- **THEN** no voice is lost, because no voice was stored there

### Requirement: The deployed service is pinned and self-contained

The deployable under `apps/pocket-tts-id` SHALL bake the model weights and
configuration into the image at build time, pinned to a published revision
rather than a moving reference.

The service SHALL expose a health path on its documented port. Port and health
path are contract: the client and the deploy platform's healthcheck both depend
on them.

#### Scenario: A cold start serves immediately

- **WHEN** the container is restarted
- **THEN** it becomes healthy without downloading model weights

#### Scenario: An unrelated push cannot change the model

- **WHEN** a push to the repository triggers a rebuild of this service
- **THEN** the image is built from the same pinned model revision as the previous
  build

#### Scenario: The deploy platform observes health

- **WHEN** the platform runs its configured healthcheck against the container
- **THEN** the service answers on the documented port and path

### Requirement: The provider states the input its model cannot speak

The provider SHALL make the model's input limitations visible rather than
silently mangling text: digits must be written as words, and exclamation marks
are unsupported.

#### Scenario: Text containing digits

- **WHEN** text containing numeric digits is submitted
- **THEN** the constraint is applied or reported, and the result is never audio
  that silently omits or mispronounces the number with no signal to the caller
