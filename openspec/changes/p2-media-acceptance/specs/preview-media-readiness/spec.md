# Spec Delta

## ADDED Requirements

### Requirement: Readiness status keeps the timeline geometry stable

The readiness status SHALL appear inside the existing transport toolbar row. Its arrival, change and removal SHALL NOT move the ruler, the lanes or the clips on desktop or phone layouts.

#### Scenario: Media becomes ready while the operator works

- **WHEN** the readiness status disappears because the last source finished loading
- **THEN** the ruler, lane and clip bounding boxes are the same before and after

#### Scenario: Phone layout shows the compact status

- **WHEN** the compact status icon appears in a 320 px wide toolbar
- **THEN** the toolbar row height and the lane positions do not change
