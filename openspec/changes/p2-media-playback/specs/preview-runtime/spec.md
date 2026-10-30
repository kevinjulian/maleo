# Spec Delta

## MODIFIED Requirements

### Requirement: The session keeps the playback clock

The session SHALL keep playback position and support play, pause, seek and rate. When audio output is active, its latency-aware output position SHALL be the master position. The host SHALL still supply monotonic time for scheduling. Sessions without active audio output SHALL derive position from host time. Clock ownership SHALL remain continuous through intentional silence, mute and rate changes. Suspended audio output SHALL pause playback rather than silently substituting a running host clock. Position SHALL stay between zero and storyboard duration. At the end, playback SHALL stop at the last frame and stop audio output.

#### Scenario: Playback advances with the host time

- **WHEN** a session without active audio output plays from 2.0 s at rate 1 and host time advances by 1.5 s
- **THEN** position is 3.5 s

#### Scenario: Rate scales the position

- **WHEN** a session without active audio output plays from 0 s at rate 2 and host time advances by 1.0 s
- **THEN** position is 2.0 s

#### Scenario: Seek while playing

- **WHEN** the operator seeks to 8.0 s while the session plays
- **THEN** old queued audio and decode results cannot play after the seek
- **AND** synchronized playback continues from 8.0 s once its local media buffers are ready

#### Scenario: Playback reaches the end

- **WHEN** position reaches storyboard duration while playing
- **THEN** the session pauses on the last frame and stops sound

#### Scenario: Host time advances ahead of sound

- **WHEN** audio reports position 3.0 s while host-time extrapolation suggests 3.2 s
- **THEN** the session schedules video from audio position 3.0 s

#### Scenario: An intentional silent gap occurs

- **WHEN** active audio output renders silence between authored audio clips
- **THEN** its output clock continues through that gap without changing timeline duration or clock ownership

### Requirement: The session reports its state

The session SHALL report one state: `loading`, `ready`, `playing`, `paused`, `buffering`, `stalled`, `device-lost` or `failed`. Failed states SHALL carry a message. Reports SHALL include position, dropped frames, frame times (last, p50, p95), media readiness, blockers and clock ownership. A Play request with incomplete media readiness SHALL be refused without advancing position or starting sound.

#### Scenario: A session starts

- **WHEN** a host creates a session
- **THEN** it reports loading until the GPU, first storyboard and all media dependencies are ready
- **AND** it reports ready after those prerequisites complete

#### Scenario: Startup fails

- **WHEN** the GPU device cannot be created
- **THEN** the session reports failed with its cause

#### Scenario: A local decoder needs more data

- **WHEN** a ready project's requested frame or audio block is temporarily unavailable from its local decoder
- **THEN** the session reports buffering and coordinates audio/video position until recovery
- **AND** repeated failure reaches stalled or failed with a named cause instead of endless playing state

### Requirement: Platforms supply the session's adapters

The session SHALL perform no IO. Platforms SHALL supply the surface, straight-alpha RGBA media frames, asynchronous decoder completion and audio output with latency-aware position and failures. Shared behavior SHALL own source timing, readiness, decoding budgets, scheduling and mixing rules. A session SHALL run without decoder or audio adapters when its dependencies require neither. Browser media decoding SHALL remain outside the editor main thread. Audio activation and device output SHALL remain platform responsibilities.

#### Scenario: A session runs without media adapters

- **WHEN** a host creates a session with a surface, no video/audio dependencies and no decoder or audio output
- **THEN** the session plays its ready static layers and captions on host time

#### Scenario: A required adapter is absent

- **WHEN** a storyboard requires video decoding that its host cannot supply
- **THEN** the session reports that dependency as a blocker and refuses Play

## ADDED Requirements

### Requirement: Compare playback has one audible owner

Normal preview SHALL retain its existing renderer. Compare mode SHALL default to the reference renderer's audio and provide an explicit diagnostic selection for Rust audio. Only one audio owner SHALL be audible at a time. Reference playback position SHALL remain a comparison measurement and SHALL NOT replace the Rust audio clock. Returning from compare mode SHALL release Rust audio resources and restore normal transport ownership without editing the document.

#### Scenario: Test Rust audio in compare mode

- **WHEN** the operator explicitly selects Rust as the diagnostic audio owner
- **THEN** reference audio is muted before Rust audio starts
- **AND** the Rust session schedules its video against its own audio output position

#### Scenario: Normal editor opens

- **WHEN** the operator opens the editor without compare mode
- **THEN** normal preview enforces full-media readiness without fetching the Rust renderer module or creating its render worker
