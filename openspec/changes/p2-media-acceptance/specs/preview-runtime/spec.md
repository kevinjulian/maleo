# Spec Delta

## ADDED Requirements

### Requirement: Synchronized playback meets measured budgets

When audio output owns the clock, the offset between the presented video frame and the audio heard at the output SHALL have a 95th percentile no greater than 50 ms. After settling, no offset SHALL exceed 100 ms. Settling SHALL take no more than 250 ms from local data after Play, seek or a rate change. This budget SHALL apply at transport rates 0.5x, 1x and 2x, and to the first Play of a session. Measurements SHALL use captured output samples, not host-clock extrapolation.

#### Scenario: First Play of a session

- **WHEN** the operator presses Play for the first time in a session whose sources are complete and local
- **THEN** audio and video settle within 250 ms of the Play gesture

#### Scenario: Play at half rate

- **WHEN** the operator sets the rate to 0.5x and presses Play
- **THEN** audio and video settle within 250 ms
- **AND** the 95th-percentile offset stays at or below 50 ms

### Requirement: Play starts from the current position

Play SHALL start from the position shown when the operator presses it. A seek made while paused SHALL remain the start position. Readiness updates, worker messages and late results from earlier generations SHALL NOT reset the position.

#### Scenario: Seek while paused, then Play

- **WHEN** the operator pauses, seeks to 4 s on the ruler and presses Play
- **THEN** playback advances from 4 s
- **AND** the position does not return to 0 s
