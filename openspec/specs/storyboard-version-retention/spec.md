# storyboard-version-retention Specification

## Purpose

Bound how many storyboard versions a project retains, keep every version something still depends on, prune on write, and answer a request for a pruned version as absent rather than missing or substituted.

## Requirements

### Requirement: Retained storyboard versions are bounded per project

The system SHALL bound the number of storyboard versions retained for a project.
Writing a new version SHALL NOT increase retained history without limit.

#### Scenario: A project accumulates versions

- **WHEN** a project has more versions written than the retention policy allows
- **THEN** the retained count stays within the bound, and the excess is removed

#### Scenario: A long agent run writes many versions

- **WHEN** a durable agent run persists the storyboard after each of hundreds of steps
- **THEN** retained history for that project stays within the bound during the run, not only after it

### Requirement: Versions that carry meaning are never pruned

The system SHALL retain the current version of a project, every version marked
approved or rendered, and every version referenced by a durable run, an output,
or a render record. These SHALL be retained regardless of age or of how many
versions follow them.

#### Scenario: An approved version is older than the window

- **WHEN** a version marked approved falls outside the recent-version window
- **THEN** it is retained

#### Scenario: A referenced version would otherwise be pruned

- **WHEN** a version is referenced by an output or render record and falls outside the window
- **THEN** it is retained, and the reference continues to resolve

#### Scenario: The current version is the oldest retained

- **WHEN** a project's current version is older than every other retained version
- **THEN** it is retained

### Requirement: Pruning happens on write

Retention SHALL be enforced when a version is written, within the same
transaction. The bound SHALL NOT depend on a scheduled task having run.

A policy enforced only by a maintenance job is a policy that is one missed
schedule away from the state this requirement exists to prevent.

#### Scenario: A version is written

- **WHEN** a new storyboard version is inserted
- **THEN** pruning for that project runs in the same transaction

#### Scenario: The write fails

- **WHEN** the insert fails
- **THEN** no version is pruned, because the two happen together

### Requirement: Version numbers stay monotonic and are not reused

Pruning SHALL NOT renumber retained versions and SHALL NOT cause a later write to
reuse a discarded number. The next version SHALL be greater than every version
ever written for that project.

#### Scenario: A version is written after pruning

- **WHEN** versions are pruned and a new version is then written
- **THEN** its number is greater than the highest number ever issued, not than the highest retained

### Requirement: A request for a pruned version is answered as absent

Reading a version that has been pruned SHALL report it as absent, distinctly from
a version that never existed and from a read failure. A reader SHALL NOT receive
a different version in its place.

#### Scenario: A pruned version is requested

- **WHEN** a version that existed and has been pruned is requested
- **THEN** the response says it is no longer retained, and no substitute document is returned

#### Scenario: A version that never existed is requested

- **WHEN** a version number beyond any ever issued is requested
- **THEN** the response distinguishes this from a pruned version

### Requirement: Existing history is reclaimed deliberately, not silently

A one-time reclaim SHALL be available for databases holding unbounded history. It
SHALL report what it would remove without removing it by default, and SHALL
require explicit confirmation to act.

#### Scenario: The reclaim is run without confirmation

- **WHEN** the reclaim runs with no explicit confirmation
- **THEN** it reports the rows and bytes it would remove per project, and removes nothing

#### Scenario: The reclaim is confirmed

- **WHEN** the reclaim runs with explicit confirmation
- **THEN** it removes only versions the retention policy does not retain, and reports the reclaimed size

#### Scenario: The reclaim is interrupted

- **WHEN** the reclaim is interrupted partway
- **THEN** the database is left consistent, and re-running it completes the work
