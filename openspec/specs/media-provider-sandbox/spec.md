# media-provider-sandbox Specification

## Purpose

The local mock provider: what it generates, where its output is cached, and the
opt-in that keeps it out of every path that did not ask for it.

Written because the sandbox is the one provider whose output is fabricated. In a
registry whose unconfigured default takes the first ready provider, readiness is
reachability — so the sandbox's health, not its intent, is what keeps mock media
away from callers expecting real results. It also gives TTS a second registered
implementation, so capability-scoped selection is exercised by real code instead
of held open by a single candidate that never has to be chosen between.

## Requirements

### Requirement: Sandbox Readiness Is Opt-In

For image and TTS, sandbox SHALL report ready only with `MALEO_SANDBOX=1` and unconfigured otherwise. For video, explicit provider selection SHALL be sufficient authorisation; video readiness SHALL depend on required local generation binaries, without requiring `MALEO_SANDBOX=1`. Automatic video resolution SHALL exclude sandbox regardless of readiness. Undeclared capabilities SHALL report unconfigured.

#### Scenario: Opt-in is absent

- **WHEN** image or TTS health is called without `MALEO_SANDBOX=1`
- **THEN** it resolves to unconfigured

#### Scenario: Opt-in is set

- **WHEN** `MALEO_SANDBOX=1` is set
- **THEN** image and TTS health resolve to ready

#### Scenario: Explicit selection without the opt-in

- **WHEN** sandbox image or TTS is selected without `MALEO_SANDBOX=1`
- **THEN** selection fails naming sandbox as unconfigured

#### Scenario: Video is selected without environment opt-in

- **WHEN** sandbox video is selected and local generation binaries are available without `MALEO_SANDBOX=1`
- **THEN** video health reports ready and generation is permitted

#### Scenario: Video binary is absent

- **WHEN** required local video generation binaries are unavailable
- **THEN** video health reports unconfigured and generation fails visibly

#### Scenario: Undeclared capability is asked about

- **WHEN** health is called for an undeclared capability
- **THEN** it resolves to unconfigured

### Requirement: Sandbox Provides Local TTS

Sandbox SHALL declare and implement TTS, producing playable local audio without external services. The voice and text SHALL identify its cached audio.

#### Scenario: Speech is synthesized

- **WHEN** sandbox TTS receives text
- **THEN** it writes playable WAV under the sandbox cache directory and returns its path

#### Scenario: The same text is synthesized twice

- **WHEN** synthesis repeats the same voice and text
- **THEN** the cached file is returned with cache status true

#### Scenario: Voice changes

- **WHEN** the same text uses a different voice
- **THEN** a distinct cache entry is produced

#### Scenario: Conformance runs against the sandbox

- **WHEN** shared provider conformance runs without external services
- **THEN** sandbox declares image, TTS, and video, implements each, and passes conformance

### Requirement: Sandbox video always lasts four seconds

Sandbox video SHALL produce a silent, browser-playable MP4 of exactly four seconds with a visible sandbox marker and observable motion. Requested duration SHALL NOT change source duration. Output SHALL preserve the requested aspect ratio. Failed or interrupted generation SHALL NOT publish an incomplete file.

#### Scenario: Requested durations differ

- **WHEN** valid requests ask for two, four, or seven seconds
- **THEN** every sandbox source video lasts four seconds

#### Scenario: Vertical video is requested

- **WHEN** a valid request specifies a vertical aspect ratio
- **THEN** the four-second output preserves that aspect ratio

#### Scenario: Generation is interrupted

- **WHEN** local encoding fails or is cancelled
- **THEN** generation reports failure and no incomplete output is admitted
