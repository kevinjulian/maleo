# ai-text-provider Specification

## Purpose

Text generation as a swappable, user-selected provider: what a provider must expose,
how one is chosen and how that choice fails, and what a caller may depend on.
Every provider is API-backed; coding CLIs reach the product as MCP clients (ADR 0006).

Written because every LLM text call ran through one hardcoded path that spawned a
single CLI. Sixteen call sites could only ever use one runner, the only configuration
was two environment variables read at module load, and the product could not run on a
machine where that CLI was absent. Extends the content-provider seam (ADR 0002) from
the media domain to the text domain; see ADR 0004.

## Requirements

### Requirement: Text generation runs behind one provider seam

The system SHALL route every LLM text generation through a single provider interface that takes a prompt and returns generated text plus token usage. A call site SHALL NOT spawn a runner process, construct a model request, or name a concrete provider.

A provider SHALL be responsible only for generation. Retry policy, tracing, prompt construction, and usage pricing SHALL remain with the caller, because each of those encodes knowledge about the call site rather than about the runner, and duplicating them per provider allows them to drift.

#### Scenario: A call site does not know which AI ran

- **WHEN** a caller requests text generation
- **THEN** it receives text and usage without any reference to a runner, CLI, or vendor in its code or its types

#### Scenario: Switching providers does not touch call sites

- **WHEN** the configured provider changes from one runner to another
- **THEN** no call site is edited and no prompt is rewritten

#### Scenario: A failed generation reports which provider failed

- **WHEN** a generation fails
- **THEN** the error names the provider that actually ran, not a provider that did not

### Requirement: Provider selection is explicit and never silently substituted

The system SHALL resolve text generation from an explicit run selection when present, then the project conversation selection, then the application default. It SHALL fail visibly when an explicitly chosen provider or model is unknown, unavailable, incompatible, or outside the configured endpoint's model options. Only an unconfigured default MAY fall through to the first ready provider; it SHALL still require a valid model for that endpoint. A custom endpoint SHALL NOT implicitly inherit a model from the built-in price catalog.

Silent substitution is prohibited. Running a different AI than the one a user selected produces plausible output from the wrong model with no signal that it happened.

#### Scenario: A selected provider that is unavailable fails loudly

- **WHEN** a user has selected a provider whose runner is absent or unauthenticated
- **THEN** generation fails with an error naming that provider and its state, and no other provider runs

#### Scenario: A stale selection does not fall back

- **WHEN** persisted configuration names a provider that is no longer registered
- **THEN** generation fails rather than resolving to a different provider

#### Scenario: An unconfigured system picks a ready provider

- **WHEN** no provider has been configured
- **THEN** the system resolves the first registered provider that reports ready
- **AND** it requests a model choice if that endpoint has no valid default

#### Scenario: Conversation model overrides the application default

- **WHEN** a conversation selects `deepseek-flash` while the application default names `gpt-5.5`
- **THEN** the new chat run uses `deepseek-flash`
- **AND** the application default is unchanged

#### Scenario: Saved model is outside the current endpoint options

- **WHEN** the saved selection names `gpt-5.5` and the endpoint offers only DeepSeek models
- **THEN** a new run is refused before generation or tool effects with an actionable model-selection error
- **AND** chat offers its model picker without losing the draft

### Requirement: A provider declares its own models, thinking levels and capabilities

Each provider SHALL publish metadata describing the models it can run, the thinking levels it can honor, whether it supports schema-constrained output, its maximum safe concurrency, and a health check. Any surface that offers these choices SHALL read them from that metadata.

A model list, thinking-level list, or provider name SHALL NOT appear as a literal in UI code. Runners genuinely differ in what they expose, so a hardcoded union is wrong for every provider individually and goes stale whenever a runner adds a model.

#### Scenario: Settings offer only what a provider supports

- **WHEN** a user selects a provider in settings
- **THEN** the model and thinking-level choices shown are exactly those the provider declares

#### Scenario: Adding a model requires no UI change

- **WHEN** a provider gains a new model
- **THEN** it appears in settings without any edit to UI code

#### Scenario: An unsupported thinking level is rejected

- **WHEN** configuration requests a thinking level the selected provider does not declare
- **THEN** the request fails rather than running at a different level

### Requirement: Thinking level is normalized across providers

The system SHALL express reasoning effort as one normalized scale, and each provider SHALL map that scale onto its own native control. Configuration SHALL NOT store a provider-specific effort string.

#### Scenario: One setting means the same thing across runners

- **WHEN** a user selects a thinking level and then changes provider
- **THEN** the selected level carries over as the equivalent level on the new provider, or is rejected if that provider does not offer it

### Requirement: Concurrent generation is bounded per provider

The system SHALL limit concurrent in-flight generations to the maximum each provider declares.

Subprocess-backed providers spawn one process per call with timeouts up to several minutes, and the agent loop issues a decision call per step. Unbounded spawning exhausts the machine.

#### Scenario: Burst of generations does not exhaust the machine

- **WHEN** more generations are requested at once than the selected provider's declared maximum
- **THEN** the excess wait for capacity rather than starting concurrently

#### Scenario: A slow generation is bounded in time

- **WHEN** a generation exceeds its timeout
- **THEN** it is terminated, its resources are released, and it surfaces as a failure

### Requirement: Provider selection is configurable at the application level

The system SHALL persist the chosen provider, model, and thinking level as application-level configuration editable from settings, and SHALL make the selection structurally extensible to finer-grained routing without a configuration migration.

The provider part of that selection SHALL be written through the one shared capability-provider endpoint, naming the `text` capability, rather than through a route belonging to text generation alone. Model and thinking level remain text-specific configuration and are written with the provider they belong to.

#### Scenario: A user changes the AI from settings

- **WHEN** a user selects a different provider, model, or thinking level in settings
- **THEN** subsequent generations use that selection with no restart and no environment change

#### Scenario: Provider and model stay consistent

- **WHEN** a user changes provider
- **THEN** the stored model and thinking level are updated together with it, never left pointing at the previous provider's catalog

#### Scenario: Selection goes through the shared endpoint

- **WHEN** a text provider is selected
- **THEN** it is written through the capability-provider endpoint naming `text`, and no text-specific provider selection route exists

### Requirement: Provider behavior is verified per provider before it is selectable

The system SHALL verify each provider against the existing generation outcome, parity, and failure-mode suites, and SHALL treat a provider that has not passed as unsupported.

Prompts and reply parsing were tuned against one model. Reply formatting differs across models, so transparency of the seam does not imply equivalence of output.

#### Scenario: An unverified provider is not the default

- **WHEN** a provider has not passed the verification suites
- **THEN** it is not the default, and selecting it is understood as unsupported

#### Scenario: Provider differences surface as test failures

- **WHEN** a provider returns a differently shaped reply for a generation the suites cover
- **THEN** the suites fail for that provider rather than the difference reaching production

### Requirement: Tests can generate without a runner

The system SHALL provide a deterministic provider that returns scripted replies with no subprocess and no network.

#### Scenario: Suites run offline

- **WHEN** tests exercise a path that generates text
- **THEN** they run deterministically with no CLI installed and no network access

### Requirement: Text-provider implementation lives with its sole host

Text-provider interfaces, registry, selection, adapters, and usage estimation SHALL live under API while retaining one provider seam for all API text generation. Workspace SHALL NOT retain standalone `@maleo/ai-provider` package.

#### Scenario: API generates text

- **WHEN** any API call site requests text generation
- **THEN** it uses API-owned provider seam without naming concrete provider
- **AND** selected provider, model, thinking, health, concurrency, usage, and error behavior remain unchanged

#### Scenario: Workspace topology is checked

- **WHEN** current source, manifests, lockfile, tests, and docs are scanned
- **THEN** `packages/ai-provider` and `@maleo/ai-provider` are absent outside historical artifacts

### Requirement: Text providers reuse shared configuration contracts

API-owned text providers SHALL use shared provider configuration resolver and field contracts rather than maintain a duplicate copy for an artificial package boundary.

#### Scenario: Operator tests unsaved provider configuration

- **WHEN** settings tests candidate text-provider values before saving
- **THEN** call-scoped override reaches provider health/reachability code without leaking into concurrent requests

### Requirement: Text generation uses API-backed models only

Every text generation, the internal agent's turns and single-shot call sites alike, SHALL run on an API-backed model. Project-chat runs SHALL use their captured selection; text generation outside a chat run SHALL use provider settings. No local CLI runner SHALL be a text provider. Coding-agent CLIs such as Codex CLI and Claude Code SHALL interact with the product only as MCP clients.

#### Scenario: Only API-backed providers are offered

- **WHEN** settings list the text providers
- **THEN** only API-backed providers and the internal scripted test provider are registered, and no CLI runner is offered

#### Scenario: A persisted CLI selection after upgrade

- **WHEN** the stored text selection names a removed CLI provider
- **THEN** generation fails visibly naming the removed provider and the settings to change, and no other provider is substituted

#### Scenario: A nested text call belongs to chat

- **WHEN** a chat run invokes a planning stage that generates text
- **THEN** that stage uses the run's captured selection rather than the application default

### Requirement: An unconfigured provider degrades rather than crashes

The system SHALL report a provider whose credentials or endpoint are missing as unconfigured through its health check and SHALL remain able to start, serve settings, and generate through any other ready provider.

#### Scenario: The product runs without a configured API provider

- **WHEN** no API-backed text provider has credentials or a reachable endpoint
- **THEN** the system starts normally and shows the text capability as unconfigured with a reason

### Requirement: Model options belong to the configured endpoint

The system SHALL obtain model options from the configured API endpoint and operator-declared model identifiers. A built-in price catalog SHALL NOT be treated as evidence that a custom endpoint supports those models. Authenticated project members SHALL receive only non-sensitive model options, availability, and discovery status. Model discovery SHALL use server-held credentials and SHALL NOT expose credentials, endpoint configuration, or raw upstream responses.

#### Scenario: DeepSeek endpoint lists its models

- **WHEN** the configured endpoint lists `deepseek-flash` and `deepseek-v4-pro`
- **THEN** chat offers those models without adding unrelated GPT or Claude price-catalog entries
- **AND** adding an extra model alone does not change an active conversation selection

#### Scenario: Endpoint does not implement discovery

- **WHEN** model discovery is unsupported and the operator declared model identifiers
- **THEN** those identifiers remain selectable and are identified as operator-declared rather than discovered
- **AND** the UI does not claim a generation succeeded

#### Scenario: Discovery fails

- **WHEN** discovery times out, returns an invalid response, or fails authentication
- **THEN** chat reports discovery failure with Retry and retains the draft and saved selection
- **AND** it does not replace the selected model or present the failure as an empty successful model list

#### Scenario: Endpoint configuration changes

- **WHEN** the effective endpoint or credentials change
- **THEN** model discovery is refreshed for that configuration before it is presented as current
- **AND** model options from the prior endpoint are not treated as current support
