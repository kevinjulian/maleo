# preview-media-readiness Specification

## Purpose

Keeps editor preview playback moving across clip boundaries: media loads before
its clip starts, a stalled frame clock recovers, and the stall at a clip start
has a measured budget.

## Requirements

### Requirement: Video media loads before its clip starts

The editor SHALL load complete source bytes for every timeline clip before preview playback starts. This includes images, video and audio, muted audio, hidden video, later clips and required processed derivatives. Unplaced library assets SHALL NOT block playback. Text and shapes without external media SHALL be ready without a download. Shared sources SHALL load once per source revision and report readiness to every referencing clip.

A source SHALL be ready only after its complete bytes are locally readable and its required media tracks pass adapter validation and an initial decode check. A thumbnail, metadata response, partial range or browser can-play hint SHALL NOT establish full readiness. Decoded frames and open decoders SHALL remain bounded independently of source readiness.

Every preview start path SHALL enforce the same gate, including transport, keyboard shortcuts, replay and programmatic play requests. This gate SHALL apply to normal and compare preview. Play SHALL remain disabled until all sources are ready. Completion SHALL NOT start playback automatically. Editing and paused seeking SHALL remain available with placeholders where necessary. Loading SHALL NOT make clips visible or audible before their authored start. Export behavior SHALL remain unchanged.

#### Scenario: A video clip follows an image scene

- **WHEN** a project has an image followed by a video at 6 s
- **THEN** preview cannot start until both sources finish loading and validation
- **AND** the video is neither visible nor audible before 6 s

#### Scenario: Playback starts close to a video clip

- **WHEN** the operator seeks to 5 s while a clip at 6 s is still loading
- **THEN** Play and keyboard playback remain blocked until every project source is ready

#### Scenario: The exported video is unchanged

- **WHEN** a project is exported before and after the preview readiness change
- **THEN** its output frames and sound retain the production export behavior

#### Scenario: Muted and hidden clips remain blockers

- **WHEN** a muted audio clip or hidden video clip has incomplete source bytes
- **THEN** Play remains disabled even if all currently visible and audible clips are ready

#### Scenario: All clips finish loading

- **WHEN** every required source passes readiness checks
- **THEN** Play becomes available without starting playback
- **AND** a project with no media dependencies needs no artificial loading delay

### Requirement: A stalled preview recovers

When preview reports playing but its presented frame does not change for 1.5 seconds, it SHALL attempt recovery from the current position. It SHALL attempt at most two recoveries for one stall. Recovery SHALL recheck readiness and SHALL NOT bypass missing bytes, failed validation or the operator's later Pause. If recovery cannot continue, preview SHALL pause with a named notice and recovery action. Pauses, deliberate loading, seeks, the timeline end and a player with no first frame SHALL NOT count as stalls. Audio and video SHALL stop together when recovery pauses playback.

#### Scenario: The frame clock stops and recovers

- **WHEN** a playing preview presents no new frame for 1.5 seconds and its sources remain ready
- **THEN** preview attempts recovery from that position
- **AND** successful recovery restores synchronized playback

#### Scenario: The recovery does not help

- **WHEN** two recovery attempts fail to advance the presented frame
- **THEN** playback stops, transport shows Play and a notice identifies the failure
- **AND** sound does not continue behind a frozen preview

#### Scenario: The operator pauses

- **WHEN** the operator pauses and waits for 5 seconds, including during recovery
- **THEN** preview does not restart and does not report that pause as a stall

### Requirement: The clip-boundary stall has a measured budget

The repository SHALL contain a repeatable delayed-media measurement and record results before and after preview loading changes. With an 800 millisecond response delay for a video starting at 3 seconds on desktop Chromium, preview SHALL wait for full readiness before Play is accepted. The measurement SHALL report readiness wait separately from playback stalls. After Play is accepted, the longest playback stall SHALL remain at most 250 milliseconds. Readiness wait SHALL NOT be presented as improved decoding throughput.

#### Scenario: The measurement runs on a slow media response

- **WHEN** a video at 3 seconds has an 800 millisecond response delay
- **THEN** Play remains blocked until its complete bytes and media validation are ready
- **AND** the measurement reports the separate readiness wait and a longest playback stall of at most 250 milliseconds

### Requirement: Every clip exposes media loading state

Each timeline clip SHALL expose queued, loading, validating, ready or failed media state as applicable. Loading SHALL show measured byte progress when the total is known and indeterminate progress otherwise. Failure SHALL name its cause and expose Retry through reachable clip actions. A clip with several sources SHALL become ready only when all of them are ready. Muted, hidden, narrow and mobile clips SHALL retain accessible state. Indicators SHALL preserve clip geometry, selection and trim handles. Readiness updates SHALL NOT create document edits or undo entries.

#### Scenario: A narrow clip loads without a known size

- **WHEN** a narrow clip loads a response without a total length
- **THEN** its loading indicator remains indeterminate with an accessible state label
- **AND** its touch and keyboard actions remain reachable

#### Scenario: One source fails

- **WHEN** a source fails to load or decode
- **THEN** every referencing clip shows failure and Play remains disabled
- **AND** Retry retries that source without discarding ready siblings

### Requirement: Readiness follows current media dependencies

Readiness SHALL follow the current project and source revisions. Adding, replacing or changing a required source SHALL revoke readiness before another Play request is accepted. If this occurs during playback, audio and video SHALL pause together. Completion of old work SHALL NOT restore readiness for a replacement source. Removing a clip SHALL remove dependencies that no remaining clip references. Pure layout changes SHALL preserve valid byte readiness. Ready bytes SHALL stay pinned while the open project references them. Unavailable local bytes, storage exhaustion and unsupported media SHALL keep playback blocked with a recoverable explanation.

#### Scenario: Replace a source during playback

- **WHEN** a playing project replaces a ready source with an unloaded source
- **THEN** audio and video pause and Play becomes disabled
- **AND** loading completion enables Play without automatically restarting

#### Scenario: Remove the only failed clip

- **WHEN** the operator removes the only clip referencing a failed source
- **THEN** that source stops blocking the remaining project
- **AND** successful later completion from the removed request cannot change the current dependency set

#### Scenario: Local storage cannot hold the project

- **WHEN** complete source bytes cannot be retained locally
- **THEN** preview reports the storage failure and keeps Play disabled
- **AND** it does not silently switch to partial streaming

### Requirement: Readiness status keeps the timeline geometry stable

The readiness status SHALL appear inside the existing transport toolbar row. Its arrival, change and removal SHALL NOT move the ruler, the lanes or the clips on desktop or phone layouts.

#### Scenario: Media becomes ready while the operator works

- **WHEN** the readiness status disappears because the last source finished loading
- **THEN** the ruler, lane and clip bounding boxes are the same before and after

#### Scenario: Phone layout shows the compact status

- **WHEN** the compact status icon appears in a 320 px wide toolbar
- **THEN** the toolbar row height and the lane positions do not change
