# media-playback Specification

## Purpose

Provide portable video source timing and audio mixing with bounded resources, so platform adapters preserve authored playback behavior.

## Requirements

### Requirement: Video requests preserve authored source time

Video playback SHALL preserve clip placement, source in-point, selected interval, rate and direction across scene visuals, visual timelines and overlays. Rates from 0.25 through 4 SHALL use the existing source-interval contract. Supported reverse playback SHALL use the existing validated reverse source contract. Invalid or unavailable processed media SHALL produce a named blocker. Playback SHALL NOT loop beyond an authored source interval to conceal an invalid edit.

Source-frame selection SHALL match the pinned production Remotion extractor for CFR/VFR sources, nonzero timestamps, rates, boundary ties and endpoint holds. Selection windows SHALL retain distinct source presentation timestamps. This alignment SHALL NOT change production export behavior or lower renderer parity thresholds.

#### Scenario: Seek into a trimmed fast clip

- **WHEN** a forward clip starts at timeline 6 s, has source in-point 3 s and rate 2, and the operator seeks to timeline 7 s
- **THEN** the requested source position is 5 s
- **AND** direct and sequential requests select the same source frame

#### Scenario: Reverse a selected interval

- **WHEN** a reversed clip has a validated derivative for its selected source interval
- **THEN** playback preserves the interval, direction and duration after seeking and trimming
- **AND** a stale derivative blocks playback rather than substituting forward media

#### Scenario: Select a source frame between presentation timestamps

- **WHEN** a source request falls between two CFR or VFR presentation timestamps
- **THEN** direct, sequential and out-of-order decoding select the frame chosen by the pinned production extractor
- **AND** source timestamps remain distinct from selection-window boundaries
- **AND** boundary ties, nonzero timestamps and held endpoints retain production behavior

### Requirement: Decoding resources remain bounded

The runtime SHALL enforce finite decoder, decoded-frame byte, decoded-audio byte and outstanding-request budgets. It SHALL reject stale decode results after seeks or source changes. Sources used simultaneously at different positions SHALL retain independent frame identities. Evicted decoded frames SHALL remain recoverable from complete local source bytes without a network request. Unsupported codecs SHALL report a source-specific error.

#### Scenario: Rapid seeks finish out of order

- **WHEN** seeks request positions 1 s, 8 s and 3 s and decoding for 8 s finishes last
- **THEN** only the latest requested 3 s frame can replace the displayed frame
- **AND** obsolete frames and decoder resources are released

#### Scenario: Two clips share a source

- **WHEN** overlapping clips reference one video at different source positions
- **THEN** both display their own requested frames
- **AND** the source bytes load once within the project session

### Requirement: Audio mixing preserves authored sound

Audio mixing SHALL preserve voiceover, music, effects, ambient sound and enabled embedded video audio. It SHALL preserve source intervals, rate, validated reverse and pitch-preserved derivatives, volume animation, fades, looping rules, ducking and track mute/solo rules. Extracted source audio SHALL suppress its embedded counterpart. Intentional narration gaps SHALL retain their duration while music continues. Missing or stale processed audio SHALL block playback instead of silently dropping sound.

#### Scenario: Narration pauses over music

- **WHEN** narration has an authored silent gap and background music spans it
- **THEN** narration remains silent for that gap while music follows its authored gain and ducking envelope
- **AND** the timeline does not collapse the gap

#### Scenario: Extracted audio does not duplicate

- **WHEN** a video has an independently placed extracted audio clip
- **THEN** the mix contains the extracted clip according to its edits and excludes the video's suppressed embedded audio

#### Scenario: Retimed speech retains its processing contract

- **WHEN** a speech clip uses a valid pitch-preserved or reversed derivative
- **THEN** the mix samples that derivative with its existing source mapping
- **AND** changing the source revision invalidates readiness for that derivative

### Requirement: Media adapters release resources and report failures

Media adapters SHALL report completion, position and failures to the shared runtime. Project changes, disposal and obsolete requests SHALL cancel work and release handles, decoded samples and output buffers. Failures SHALL leave the authored document, selection and undo history intact. An audio device that is suspended or unavailable SHALL NOT report successful audible playback.

#### Scenario: Project changes during decode

- **WHEN** the operator changes projects while decoding is pending
- **THEN** the old work cannot supply frames or sound to the new project
- **AND** old resources are released

#### Scenario: Browser refuses audio activation

- **WHEN** the browser refuses to activate audio output after Play
- **THEN** playback stays paused with a named recovery action
- **AND** the runtime does not advance as if sound were playing
