# Spec Delta

## MODIFIED Requirements

### Requirement: One-shot story generation creates implicit approvals

`create_story_video` SHALL plan through the full video planning workflow — approved-plan replacement guard, direction routing, and pre- and post-research clarification unless the request bypasses questions — and SHALL then generate without the interactive plan-approval gate. Flow SHALL create approved snapshot before provider calls and SHALL implicitly approve automatic extension revisions under same one-shot authorization.

#### Scenario: Explicit one-shot build

- **WHEN** `create_story_video` completes planning
- **THEN** it creates implicit approved snapshot
- **AND** generation proceeds without interactive gate

#### Scenario: One-shot build asks story decisions

- **WHEN** `create_story_video` runs for a request that does not bypass questions and clarification is eligible
- **THEN** the run suspends for the story decisions before framing
- **AND** generation starts only after planning completes

#### Scenario: One-shot build over an approved plan

- **WHEN** `create_story_video` runs while an approved plan exists
- **THEN** the run asks before replacing it
- **AND** rejection keeps the approved plan and generates nothing

#### Scenario: One-shot duration extension

- **WHEN** one-shot output measures short
- **THEN** each extension revision is implicitly approved before its provider calls
