# vui-edit-semantics Specification

## Purpose

TBD - created by syncing change rebuild-vui-video-editor-library. Update Purpose after archive.

## Requirements

### Requirement: The library provides the standard trim family

The library SHALL provide trim, ripple, roll, slip, and slide as operations over a transaction's projection, each with a defined effect on the edited item and on its neighbours.

- Trim moves one edge of one item and changes nothing else.
- Ripple moves one edge and shifts every later item on the same row by the same delta.
- Roll moves the boundary between two adjacent items, changing both and moving nothing else.
- Slip changes an item's source in-point and out-point without moving it on the timeline.
- Slide moves an item on the timeline while its neighbours absorb the change, leaving the item's own source range untouched.

Every consumer otherwise rebuilds these, and a library that omits them is a timeline widget rather than an editor library.

#### Scenario: A ripple trim shortens an item

- **WHEN** an item's out point is rippled earlier by a duration
- **THEN** that item shortens by the duration, every later item on the row moves earlier by the same duration, and their durations are unchanged

#### Scenario: A roll moves a shared boundary

- **WHEN** the boundary between two adjacent items is rolled later
- **THEN** the earlier item lengthens, the later item shortens, and no other item moves

#### Scenario: A slip changes source without changing position

- **WHEN** an item is slipped
- **THEN** its timeline position and duration are unchanged, and its source in-point and out-point both move by the slip amount

#### Scenario: A trim is bounded by its source

- **WHEN** a trim would extend an item past the media available at that edge
- **THEN** the operation clamps at the available bound and reports that it clamped

### Requirement: Placement policy is selectable, and magnetic and free are both supported

The library SHALL offer placement as a policy. Under a magnetic policy, items on a row SHALL remain contiguous and a removal or insertion SHALL close or open a gap. Under a free policy, items SHALL keep explicit positions and gaps SHALL persist.

A consumer SHALL select the policy per row.

Maleo alone needs both: its base track is contiguous scenes, and its overlay rows are freely placed.

#### Scenario: An item is removed from a magnetic row

- **WHEN** an item is removed from a row under a magnetic policy
- **THEN** the items after it move earlier to close the gap, in one operation

#### Scenario: An item is removed from a free row

- **WHEN** an item is removed from a row under a free policy
- **THEN** no other item moves and the gap remains

#### Scenario: Two rows use different policies

- **WHEN** one row is magnetic and another is free
- **THEN** an edit on either behaves under its own row's policy, and neither affects the other

### Requirement: Overlap is resolved by a declared strategy

For each row the library SHALL apply a declared overlap strategy: reject the edit, insert and shift, overwrite the covered region, or permit the overlap. The strategy SHALL be observable in the projection before the transaction commits.

#### Scenario: A drop would overlap under a rejecting strategy

- **WHEN** a drag reaches a position where the item would overlap another and the row rejects overlap
- **THEN** the projection reports the position as invalid before release, and a commit there does not produce an overlapping state

#### Scenario: Overlap is permitted deliberately

- **WHEN** the consumer's declared modifier is held and the row permits overlap under it
- **THEN** the commit places the item overlapping, and no automatic resolution moves it afterwards

### Requirement: Linked and grouped items move as one

Items the consumer declares linked or grouped SHALL move, trim, and roll as a unit. One snapped delta SHALL be computed from the item under the pointer and applied to every member, so relative spacing is preserved. A group SHALL produce one operation and one undo step.

#### Scenario: A group is dragged

- **WHEN** several selected items are dragged by one of them and the delta snaps
- **THEN** every member moves by the identical snapped delta, and the spacing between members is unchanged

#### Scenario: Linked audio and video are trimmed

- **WHEN** a video item with linked audio is trimmed at one edge
- **THEN** the linked audio is trimmed by the same amount at the same edge, and one operation is emitted

#### Scenario: A group edit is undone

- **WHEN** a group edit is undone
- **THEN** every member returns to its prior state in a single undo step

### Requirement: Snapping is a declared set of candidates, and is bypassable

The library SHALL snap an edit to candidates supplied by the consumer, within a configured threshold expressed in pixels rather than in time so it does not change meaning with zoom. It SHALL report which candidate was taken, and SHALL support a bypass under a consumer-declared modifier.

An edit SHALL NOT snap to a candidate belonging to an item taking part in the same edit.

#### Scenario: An edge snaps to a neighbouring boundary

- **WHEN** a dragged edge comes within the threshold of a supplied candidate
- **THEN** the projection reports the snapped position and identifies the candidate

#### Scenario: Snapping is bypassed

- **WHEN** the bypass modifier is held
- **THEN** no candidate is taken, and the projection reports the unsnapped position

#### Scenario: A group snaps

- **WHEN** several items move together
- **THEN** candidates belonging to members of the moving set are excluded, so the group cannot snap to itself
