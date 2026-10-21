# vui-time-model Specification

## Purpose

TBD - created by syncing change rebuild-vui-video-editor-library. Update Purpose after archive.

## Requirements

### Requirement: Public time is rational, not float seconds

The library SHALL represent a point in time as an integer tick count against a project timebase expressed as an exact rational `{ numerator, denominator }`. Public contracts — snapshots, commands, operations, gesture events, and adapter interfaces — SHALL carry rational time.

Float seconds cannot represent 30000/1001. The error accumulates across a sequence of edits, and "which frame is this" stops having a single answer. The previous implementation avoided the problem only by being 30 fps everywhere.

#### Scenario: A non-integer frame rate is represented exactly

- **WHEN** a project declares 29.97 fps as 30000/1001 and a position of frame 1000 is converted to a tick count and back
- **THEN** the round trip returns frame 1000 exactly, with no accumulated error

#### Scenario: Ten thousand sequential edits are applied

- **WHEN** an item is nudged by one frame ten thousand times at 23.976 fps
- **THEN** its position equals its starting position plus exactly ten thousand frames

### Requirement: Seconds are a boundary conversion, and the boundary is documented

The library SHALL provide conversions between rational time and float seconds, and SHALL document every public place a float second is still accepted or returned. A conversion that cannot be represented exactly SHALL apply a documented, deterministic rounding rule rather than an implementation-defined one.

Consumers arrive with float seconds — Maleo's storyboard contract stores them — so refusing them is not an option; leaving the conversion undefined is.

#### Scenario: A float second is admitted at the boundary

- **WHEN** a consumer supplies a position in float seconds
- **THEN** it is converted to the nearest representable tick under the documented rule, and the applied rounding is observable to the consumer

#### Scenario: A documented boundary is added or removed

- **WHEN** a public API begins or stops accepting float seconds
- **THEN** the documented boundary list changes with it, and a test fails if the two disagree

### Requirement: Frame arithmetic is exact at every supported rate

The library SHALL support at least 23.976, 24, 25, 29.97, 30, 50, 59.94, and 60 frames per second, and SHALL convert between ticks, frames, and seconds without error accumulation at any of them.

#### Scenario: Every supported rate round-trips

- **WHEN** a property test converts arbitrary frame numbers to ticks and back at each supported rate
- **THEN** every conversion returns the original frame number

#### Scenario: Two timebases are compared

- **WHEN** a duration expressed in one timebase is compared with a duration expressed in another
- **THEN** the comparison is exact, and neither operand is first converted to a float

### Requirement: Timecode formatting distinguishes drop-frame from non-drop

The library SHALL format and parse SMPTE timecode, SHALL apply drop-frame counting for 29.97 and 59.94 when drop-frame is selected, and SHALL use the `;` separator for drop-frame and `:` for non-drop.

#### Scenario: A drop-frame timecode is produced

- **WHEN** one hour of media at 29.97 fps drop-frame is formatted
- **THEN** the result is `01;00;00;00` and matches the frame count a drop-frame counter reports

#### Scenario: The same instant is formatted both ways

- **WHEN** the same tick position is formatted as drop-frame and as non-drop
- **THEN** the two strings differ, and each parses back to the tick position it was produced from

### Requirement: A project declares one timebase, and items may not silently disagree

A timeline SHALL declare exactly one project timebase. An item whose source media has a different native rate SHALL carry that rate explicitly, and the library SHALL convert at the boundary rather than mixing rates in arithmetic.

#### Scenario: Media at a different rate is placed

- **WHEN** 25 fps media is placed on a 29.97 fps timeline
- **THEN** the item's timeline position is in project ticks, its source in-point is in source ticks, and both are retrievable without ambiguity

#### Scenario: A rate mismatch reaches arithmetic

- **WHEN** a caller adds a duration in source ticks to a position in project ticks
- **THEN** the type system rejects it, rather than producing a plausible wrong number
