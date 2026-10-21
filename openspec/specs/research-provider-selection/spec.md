# research-provider-selection Specification

## Purpose

How a research request resolves to a concrete provider, what a provider must implement, and what
happens when the selected one cannot answer.

Written because retrieval used to be one hardcoded local daemon: grounding worked only on a machine
running BrowserOS, and everywhere else the planner asked for sources, received none, and honestly
marked the plan ungrounded — correct behavior and a useless feature. The failure mode this guards
against is subtler than an outage, though. A provider that keeps working while quietly retrieving
less, or a plan silently grounded by a provider nobody selected, is indistinguishable from a
well-grounded plan at every layer that reads it afterwards.

## Requirements

### Requirement: Research Retrieval Resolves Through One Registry

Every research retrieval SHALL reach its provider through a single registry. A caller SHALL NOT
construct a provider directly, and SHALL NOT branch on which provider is configured.

The registry SHALL resolve in this order: an explicit per-request or per-workspace selection, then
environment configuration, then the first registered provider that is ready. Registration order is
therefore behavior, not presentation.

A provider SHALL be considered ready only when the configuration it needs is present. An
unconfigured provider SHALL be skipped during selection rather than selected and then failed.

#### Scenario: No selection is configured

- **WHEN** no explicit research provider is selected and the leading provider's configuration is
  present
- **THEN** selection resolves to the leading provider

#### Scenario: A provider is missing its configuration

- **WHEN** the leading provider's URL or credentials are absent
- **THEN** it is not selected, and selection continues to the next ready provider

#### Scenario: An explicit selection wins

- **WHEN** a research provider is selected explicitly
- **THEN** that provider is used even when another is registered ahead of it

#### Scenario: A caller does not know which provider answered

- **WHEN** research runs
- **THEN** the calling code is identical regardless of which provider served it

### Requirement: A Research Provider Implements Two Methods And Owns Neither Safety Nor Trust

A research provider SHALL implement exactly search and page-read, and SHALL confine itself to
retrieval. It SHALL NOT classify URLs, cap excerpts, deduplicate, diversify, or validate quotes —
those belong to the shared pipeline, above the seam, so they cannot differ between providers.

Retrieved text SHALL be treated as untrusted data by every provider, never as instructions,
regardless of whether it arrived as a scraped page or as a structured API response.

Where a page read follows a redirect, the provider SHALL report the final URL it actually retrieved,
so the citation names the page whose text was read rather than the page that was requested.

#### Scenario: A provider returns content its API already extracted

- **WHEN** a provider's search or read API returns page text directly
- **THEN** that text still passes through the shared URL classification, excerpt caps and quote
  validation before it can be cited

#### Scenario: A read is redirected to a different page

- **WHEN** a requested URL redirects and the provider retrieves the destination
- **THEN** the provider reports the destination URL
- **AND** the citation records the destination rather than the requested URL

#### Scenario: A provider is tempted to trust its own API

- **WHEN** retrieved text contains instruction-like content
- **THEN** it is handled as data by the provider and by everything downstream

### Requirement: Every Registered Provider Passes One Shared Conformance Suite

The research layer SHALL export a reusable conformance suite asserting the provider contract, and
every registered provider SHALL pass it.

The suite SHALL cover the invariants selection depends on: both methods present, a search returning
normalizable results, a read reporting its final URL, and a failure surfacing as a thrown error or
an empty result rather than as fabricated content.

#### Scenario: A new provider is added

- **WHEN** a provider is registered
- **THEN** one call to the exported suite asserts every contract invariant, so the author does not
  have to guess which ones matter

#### Scenario: A provider is registered without its own tests

- **WHEN** a provider is added to the registry and ships no test of its own
- **THEN** a registry-level conformance run still covers it

#### Scenario: A provider fabricates on failure

- **WHEN** a provider cannot retrieve anything
- **THEN** the suite fails it if it returns invented results instead of an error or an empty list

### Requirement: An Unavailable Provider Degrades Visibly And Is Not Silently Replaced

When the selected provider cannot answer, the system SHALL NOT attempt a different provider. It
SHALL report research as unavailable with the underlying reason, and the plan SHALL be marked
ungrounded.

A silent substitution would replace a visible outage with an invisible change in grounding quality,
which nothing downstream can detect. An outage that is reported is preferable to sources that
quietly came from somewhere else.

#### Scenario: The selected provider is unreachable

- **WHEN** the configured provider cannot be reached
- **THEN** research reports unavailability with the reason
- **AND** no other registered provider is tried for that request

#### Scenario: The plan says so

- **WHEN** grounding was called for and the provider was unavailable
- **THEN** the plan is marked ungrounded and the approval gate reports it

### Requirement: The Candidate Budget Is Bounded

The number of candidate sources a single research pass reads SHALL be bounded by an explicit cap,
independent of how many results a search returns.

Pages are read one at a time, so the cap bounds latency as well as load on the sources.

#### Scenario: A search returns far more results than the cap

- **WHEN** a search returns more deduplicated candidates than the cap allows
- **THEN** at most the capped number are read

#### Scenario: The cap is not derived from the source limit

- **WHEN** the maximum citeable sources changes
- **THEN** the candidate cap does not change with it implicitly
