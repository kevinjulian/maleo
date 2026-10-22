# preview-media-readiness Specification

## Purpose

Keeps editor preview playback moving across clip boundaries: media loads before
its clip starts, a stalled frame clock recovers, and the stall at a clip start
has a measured budget.

## Requirements

### Requirement: Video media loads before its clip starts

The editor preview SHALL start to load the media of a video clip before the
playhead reaches the first frame of that clip. The preview SHALL start the load
at least 2 seconds of timeline time before the clip starts, or at the start of
playback when the clip starts sooner. A clip that loads early SHALL NOT be
visible or audible before its first frame. The exported render SHALL NOT change.

#### Scenario: A video clip follows an image scene

- **WHEN** the preview plays from 0 seconds and a video clip starts at 6 seconds
- **THEN** the preview requests the video media before the playhead reaches 4 seconds
- **AND** the video does not show and does not play sound before 6 seconds

#### Scenario: Playback starts close to a video clip

- **WHEN** the operator starts playback at 5 seconds and a video clip starts at 6 seconds
- **THEN** the preview requests the video media when playback starts

#### Scenario: The exported video is unchanged

- **WHEN** a project with video clips is rendered to a file before and after this change
- **THEN** each frame of the two renders shows the same content

### Requirement: A stalled preview recovers

When the preview reports that it plays and its frame does not change for 1.5
seconds, the editor SHALL restart playback from the current frame. The editor
SHALL try this recovery at most two times for one stall. When the frame still
does not move after the second recovery, the editor SHALL stop playback, show
the transport as paused, and show a notice that the preview cannot play the
media at this point. A pause, a seek, the end of the timeline, or a player that
has not reported a frame yet SHALL NOT count as a stall.

#### Scenario: The frame clock stops and recovers

- **WHEN** the player reports that it plays and the frame stays the same for 1.5 seconds
- **THEN** the editor restarts playback from that frame
- **AND** the frame moves again and the transport continues to show "Pause"

#### Scenario: The recovery does not help

- **WHEN** the frame stays the same after two recovery attempts
- **THEN** playback stops, the transport shows "Play", and the editor shows a notice

#### Scenario: The operator pauses

- **WHEN** the operator pauses playback and waits for 5 seconds
- **THEN** the editor does not restart playback and does not show a notice

### Requirement: The clip-boundary stall has a measured budget

The repository SHALL contain a repeatable measurement that plays a project with
a video clip whose media arrives with a fixed network delay, and reports the
longest time the playhead does not move during playback. With an 800
millisecond media delay on desktop Chromium, the longest stall SHALL be at most
250 milliseconds. A change that touches preview media loading SHALL record the
measurement before and after.

#### Scenario: The measurement runs on a slow media response

- **WHEN** the measurement plays a project where a video clip starts at 3 seconds and its media responds after 800 milliseconds
- **THEN** it reports the longest playhead stall in milliseconds and the frame where it occurred
- **AND** the reported stall is at most 250 milliseconds
