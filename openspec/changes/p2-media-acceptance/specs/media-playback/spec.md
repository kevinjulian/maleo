# Spec Delta

## ADDED Requirements

### Requirement: Audio decoding persists per source within its lease

The web audio adapter SHALL keep one decoder context per audio source for as long as that source holds a decoder lease. Consecutive windows from the same source SHALL NOT parse the container again or start a new decoder context. A held context SHALL release its lease when the shared broker asks it to yield, when the project or session is disposed, and when the source revision changes. Every audio window SHALL still decode from its pre-roll offset and return only the requested interval. The audio decoder count and the decoded-audio byte budget SHALL stay unchanged.

#### Scenario: Consecutive windows reuse the source context

- **WHEN** playback requests windows 0.0–0.25 s, 0.25–0.5 s and 0.5–0.75 s from one audio source
- **THEN** the source is parsed and its decoder context is created once
- **AND** each window returns exactly its requested samples

#### Scenario: A third source needs a decoder slot

- **WHEN** two audio sources hold both audio decoder leases and a third source requests a window
- **THEN** an idle holder yields its lease after its current window completes
- **AND** no more than two audio decoders exist at any time

#### Scenario: The source revision changes

- **WHEN** a held source receives a new revision
- **THEN** the old context closes and releases its lease and PCM reservations
- **AND** no window decoded under the old revision reaches the mixer
