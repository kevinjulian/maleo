# preview-runtime Specification

## Purpose

The engine's preview session plays a render storyboard the same way on every platform: one
playback clock, one frame scheduler and one set of preview states, with each platform supplying
only its adapters.

## Requirements

### Requirement: A preview session holds the storyboard

A preview session SHALL hold one render storyboard. The host SHALL set the storyboard once and
SHALL set it again only when it changes. A frame request SHALL carry no storyboard. A storyboard
that does not parse SHALL be refused with an error that names the problem, and the session SHALL
keep the previous storyboard.

#### Scenario: Playback does not resend the storyboard

- **WHEN** a session plays 10 seconds of a project without an edit
- **THEN** the host sends the storyboard once, before playback

#### Scenario: An edit replaces the storyboard

- **WHEN** the host sets a changed storyboard while the session is paused at frame 120
- **THEN** the session draws frame 120 of the changed storyboard

#### Scenario: A storyboard does not parse

- **WHEN** the host sets a storyboard that does not parse
- **THEN** the session returns an error that names the problem
- **AND** the next frame draws from the previous storyboard

### Requirement: The session keeps the playback clock

The session SHALL keep the playback position. It SHALL support play, pause, seek and a playback
rate. The host SHALL supply the current time on each tick, and the session SHALL compute the
position from that time alone. The position SHALL stay between zero and the storyboard duration.
At the end of the storyboard, playback SHALL stop at the last frame.

#### Scenario: Playback advances with the host time

- **WHEN** the session plays from 2.0 s at rate 1 and the host time advances by 1.5 s
- **THEN** the position is 3.5 s

#### Scenario: Rate scales the position

- **WHEN** the session plays from 0 s at rate 2 and the host time advances by 1.0 s
- **THEN** the position is 2.0 s

#### Scenario: Seek while playing

- **WHEN** the host seeks to 8.0 s while the session plays
- **THEN** playback continues from 8.0 s

#### Scenario: Playback reaches the end

- **WHEN** the position reaches the storyboard duration while playing
- **THEN** the session pauses on the last frame

### Requirement: The scheduler draws the latest due frame

On each tick, the session SHALL draw the frame at the current position, unless that frame is
already on screen. When a draw is still in progress, the session SHALL NOT start another; the
next tick SHALL draw the frame due at that time. Frames that are passed over during playback
SHALL be counted as dropped. Seeks that arrive while a frame draws SHALL NOT queue: only the last
one draws.

#### Scenario: A slow frame drops frames

- **WHEN** a draw takes three frame intervals during playback
- **THEN** the next draw is the frame due at that time
- **AND** the dropped-frame count rises by the frames passed over

#### Scenario: Seeks during a draw

- **WHEN** the host seeks to frames 10, 20 and 30 while one frame draws
- **THEN** only frame 30 draws after it

#### Scenario: A paused tick draws nothing

- **WHEN** the session is paused and the frame on screen is the frame at the position
- **THEN** a tick draws nothing

### Requirement: The session reports its state

The session SHALL report one state: `loading`, `ready`, `playing`, `paused`, `device-lost` or
`failed`. A `failed` state SHALL carry a message. The session SHALL report its state, its
position, its dropped-frame count and its frame times (last, p50, p95) to the host.

#### Scenario: A session starts

- **WHEN** a host creates a session
- **THEN** the state is `loading` until the GPU device and the first storyboard are ready
- **AND** then the state is `ready`

#### Scenario: Startup fails

- **WHEN** the GPU device cannot be created
- **THEN** the state is `failed` with a message that says why

### Requirement: The session recovers from a lost GPU device

When the GPU device is lost, the session SHALL report `device-lost`, create a new device, and draw
the current frame again. Images the host supplied before the loss SHALL stay available without
the host supplying them again. When the new device cannot be created, the state SHALL be
`failed`.

#### Scenario: The device is lost and recovers

- **WHEN** the GPU device is lost while the session is paused at frame 90
- **THEN** the state becomes `device-lost`, then `paused`
- **AND** frame 90 draws again with its images, and the host supplies no image again

### Requirement: Platforms supply the session's adapters

The session SHALL perform no IO. A platform SHALL supply a drawing surface, and images as
straight-alpha RGBA. The session SHALL define a video frame decoder interface and an audio
output interface for platforms to implement, and SHALL run with neither.

#### Scenario: A session runs without media adapters

- **WHEN** a host creates a session with a surface and no decoder or audio output
- **THEN** the session plays the storyboard's static layers and captions on the host clock

### Requirement: The web preview session runs in a worker

On the web, the preview session SHALL run in a dedicated worker. The preview canvas SHALL be
transferred to the worker. The worker SHALL fetch and decode the images itself. A frame that draws
slowly SHALL NOT block the editor's main thread.

#### Scenario: A slow frame does not block the editor

- **WHEN** the worker draws a frame that takes 50 ms
- **THEN** the editor's main thread handles input during that time

#### Scenario: The worker supplies an image

- **WHEN** the storyboard names an image the worker has not loaded
- **THEN** the worker fetches and decodes it, and the frame draws its placeholder until it is
  ready
