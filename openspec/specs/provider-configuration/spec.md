# provider-configuration Specification

## Purpose

How a provider declares the configuration it needs, how that declaration
becomes a form, and how a candidate configuration is tested before it is saved.

Written because a form hand-written per provider is the surface this replaced,
one abstraction higher — and because a test built on a readiness check reported
success for a service URL that pointed at nothing.

## Requirements

### Requirement: A Provider Declares The Configuration It Needs

A provider SHALL declare its configuration as data on its metadata: for each
value, a key, a human label, a kind, and whether it is required. The settings
surface SHALL build the provider's form from that declaration.

A form hand-written per provider is the surface this change replaces, one
abstraction higher: the provider knows what it needs, so anywhere else that
knowledge is a copy that drifts from the implementation reading it.

#### Scenario: A provider's form is generated

- **WHEN** a provider declaring configuration fields is opened in settings
- **THEN** its form shows one input per declared field, labelled and marked
  required as declared

#### Scenario: A provider declaring no configuration

- **WHEN** a provider declares no configuration fields
- **THEN** its page renders without a form rather than failing, because a provider
  configured entirely by other means is a valid provider

#### Scenario: Adding a provider adds its settings

- **WHEN** a provider is added to a registry with a configuration declaration
- **THEN** its settings form exists with no change to the web surface

### Requirement: A Field's Kind Determines Its Input, Its Masking, And Its Store

Each declared field SHALL carry a kind. The kind SHALL determine how the value is
entered, whether it is masked, and whether it is stored as a secret.

A field marked as a secret SHALL be stored through managed secret storage. Every
other kind SHALL be stored as a plain application setting.

Deciding secrecy at the declaration removes the failure where a credential is
stored in plaintext because whoever wrote the form forgot which field it was.

#### Scenario: A secret field

- **WHEN** a field is declared as a secret
- **THEN** its input masks entry, its stored value is never returned to the
  client, and it is written through managed secret storage

#### Scenario: A non-secret field

- **WHEN** a field is declared as a URL, text, or a choice
- **THEN** its value is readable back to populate the form, because an endpoint is
  not a credential

#### Scenario: A choice field

- **WHEN** a field is declared as a choice
- **THEN** its declared options are offered, and a value outside them is refused

### Requirement: A Configuration Can Be Tested Before It Is Saved

The system SHALL let an operator test a candidate configuration and see the
result before saving it, evaluated against the submitted values rather than
against currently stored state.

The test SHALL ATTEMPT A CONNECTION where the provider can make one, and SHALL
NOT report success on the strength of a configuration check alone. A provider
that cannot be probed without doing chargeable work SHALL report that nothing was
contacted, rather than presenting "configured" as "connected".

Readiness and reachability are different questions and only one of them may touch
the network: readiness is evaluated on every render of the settings surface, so a
request there would make the page as slow as the slowest endpoint. Answering the
test with readiness alone is what made a service URL pointing at nothing report
"Connection succeeded" — worse than offering no test, because it tells an operator
their configuration is good and defers the failure to a generation hours later.

An operator who cannot test learns their key is wrong when a generation fails
later, with nothing connecting the failure to what they typed.

#### Scenario: Testing a working configuration

- **WHEN** an operator tests a candidate configuration that the provider can use
- **THEN** the surface reports the provider as reachable, and the values are still
  unsaved

#### Scenario: Testing a broken configuration

- **WHEN** the candidate configuration is wrong or the service is unreachable
- **THEN** the surface reports the failure with the provider's own reason, and the
  stored configuration is unchanged

#### Scenario: An endpoint that nothing answers

- **WHEN** a candidate names a reachable-looking endpoint that no service answers
- **THEN** the test fails, because a value being present is not a service being
  there

#### Scenario: A provider that cannot be probed

- **WHEN** a provider offers no way to check reachability without chargeable work
- **THEN** a passing test says the configuration looks complete and that nothing
  was contacted, never that a connection succeeded

#### Scenario: Testing does not change what is running

- **WHEN** a test completes, whatever its result
- **THEN** the active provider for every capability is what it was before, and no
  value has been persisted

### Requirement: A Candidate Configuration Is Scoped To One Call

The system SHALL be able to evaluate a provider against configuration values that
are not stored, for the duration of one call, without changing what any other
call resolves.

Testing before saving is impossible if a provider can only read stored state. Two
obvious approaches fail: adding a configuration argument to `health()` and every
generation path makes each caller responsible for obtaining configuration, which
is the coupling the resolver seam exists to remove; and swapping the process-wide
source around the call is a race, because two operators testing at the same moment
would each observe the other's unsaved values.

The override SHALL therefore be scoped to the calling execution, and SHALL NOT
persist anything.

#### Scenario: A provider evaluated against candidate values

- **WHEN** a provider's health is evaluated inside a candidate configuration
- **THEN** it resolves the candidate values in place of the stored ones

#### Scenario: Keys the candidate does not carry

- **WHEN** the candidate supplies only some of a provider's keys
- **THEN** the remaining keys resolve normally through the installed source

#### Scenario: Nothing outside the call is affected

- **WHEN** the call completes, whatever its result
- **THEN** later resolution returns the stored values, and nothing was persisted

#### Scenario: Two candidates at once

- **WHEN** two candidate configurations are evaluated concurrently for the same
  key
- **THEN** each observes only its own values

### Requirement: A Provider May Contribute An Action Beyond Its Form

A provider's page SHALL be able to offer an action that is not a configuration
field, such as installing a local dependency.

Not every capability is configured by typing a value. Local captions is installed,
not credentialed, and forcing it into a form would either distort the form model
or push that capability out of the surface that claims to list every capability.

#### Scenario: A provider whose setup is an action

- **WHEN** a provider's setup requires running an installation rather than
  entering values
- **THEN** its page offers that action, and reports the result against the same
  readiness state every other provider reports

#### Scenario: An action provider is listed like any other

- **WHEN** such a provider is listed under its capability
- **THEN** its row shows the same name, state, and active marker as any other
  provider's row

### Requirement: Stock Providers Use The Shared Provider Configuration Path

Pexels and Freesound SHALL declare their required credentials as secret provider fields owned by the stock provider registry. Their runtime adapters SHALL resolve those same keys through the installed provider configuration source, so configuration displayed as ready in Settings is configuration used by actual stock searches.

Canonical environment values SHALL retain precedence over stored values through that shared source. Stock adapters SHALL NOT read credentials directly or fall back to legacy aliases when the shared source returns no value. `MALEO_PEXELS_API_KEY` SHALL no longer configure Pexels.

#### Scenario: Pexels is configured in Settings

- **WHEN** `PEXELS_API_KEY` is stored through Pexels setup and no environment value overrides it
- **THEN** Stock visuals reports ready and real image and video searches use the stored credential

#### Scenario: Freesound is configured in Settings

- **WHEN** `FREESOUND_API_KEY` is stored through Freesound setup and no environment value overrides it
- **THEN** Sound effects reports ready and real sound-effect searches use the stored credential

#### Scenario: Canonical environment configuration already exists

- **WHEN** a stock credential is present in the process environment
- **THEN** existing stock searches remain configured without requiring a stored copy

#### Scenario: Environment shadows a stored stock credential

- **WHEN** the canonical environment key and a stored value both exist
- **THEN** the environment value is used and Settings reports that the stored value is shadowed

#### Scenario: Legacy Pexels environment key exists alone

- **WHEN** `MALEO_PEXELS_API_KEY` is set and canonical `PEXELS_API_KEY` is absent
- **THEN** Pexels reports unconfigured because no legacy credential fallback remains

#### Scenario: Shared configuration has no stock credential

- **WHEN** neither a stored value nor the canonical environment key resolves through the shared provider configuration source
- **THEN** the stock provider reports unconfigured without consulting a second credential path

### Requirement: Stock Provider Tests Are Read-Only And Candidate-Scoped

Testing Pexels or Freesound SHALL contact a minimal authenticated read endpoint using the submitted candidate credential. A valid authenticated response SHALL pass independently of result count. The test SHALL NOT save the candidate, change provider selection, or admit, download, or place media.

#### Scenario: Valid credential returns no matches

- **WHEN** the provider accepts the candidate credential but the probe response contains no media results
- **THEN** the test succeeds because authentication and reachability were verified

#### Scenario: Candidate credential is invalid

- **WHEN** the provider rejects the submitted credential
- **THEN** the test fails with the provider response reason and stored configuration remains unchanged

#### Scenario: Provider is unreachable

- **WHEN** the authenticated read request times out or the provider cannot be reached
- **THEN** the test fails rather than reporting configuration presence as connection success

#### Scenario: Candidate test completes

- **WHEN** a Pexels or Freesound test finishes with any result
- **THEN** later requests resolve installed configuration, no candidate value persists, and no media or project state has changed
