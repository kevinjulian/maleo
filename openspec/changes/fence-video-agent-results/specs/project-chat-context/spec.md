## MODIFIED Requirements

### Requirement: Results are fenced and applied by touched entity identity

The context envelope SHALL carry a stable id and content fingerprint for every entity it describes in detail. A settled result SHALL declare the stable ids of the entities it changes. Before applying the result, the system SHALL re-derive the current fingerprint of those ids and compare it with the captured one. It SHALL NOT compare or block on entities outside the result's touched scope, and SHALL NOT silently overwrite a touched entity that changed after the envelope was captured.

Application SHALL be scoped: the written document SHALL take values from the result only for declared touched ids, and SHALL take every other entity from current project state. A result SHALL NOT restore a captured value for an entity it did not declare.

This governs every settled result the editor applies, including video scene results. A settled video result SHALL apply through the document-shaped command seam as one undoable step, and SHALL correspond agent scenes to editor scenes by stable scene identity rather than by array position.

#### Scenario: Touched scope is unchanged

- **WHEN** a settled result targets entities whose current fingerprints match the captured ones
- **THEN** the result applies through the existing command seam as one undoable user-visible step

#### Scenario: Unrelated edit happened during generation

- **WHEN** the user changes an entity outside the result's touched scope while the run executes
- **THEN** the result still applies to its touched scope
- **AND** the current value of the edited entity is written, not the captured one

#### Scenario: Result returns a whole document

- **WHEN** a settled result carries a full document shaped like the one the run read
- **THEN** only the declared touched entities are taken from it
- **AND** entities it rewrote without declaring are left at their current values

#### Scenario: Undo follows touched scope

- **WHEN** the user undoes a settled agent application
- **THEN** the command ledger reverses exactly the touched entities it changed
- **AND** unrelated edits made during the run are not reverted

#### Scenario: Target changed during generation

- **WHEN** the user changes an entity inside the result's touched scope before the result applies
- **THEN** the system holds the conflicting result for review or re-plans against current context
- **AND** it does not overwrite the newer edit

#### Scenario: Target was edited and reverted

- **WHEN** a touched entity was changed and restored to its captured value before the result applies
- **THEN** its fingerprint matches and the result applies without a spurious conflict

#### Scenario: Target no longer exists

- **WHEN** a touched entity was deleted before the result applies
- **THEN** the system holds the result for review rather than recreating the entity

#### Scenario: Scenes are reordered while a video run executes

- **WHEN** the user reorders scenes before a settled video result applies
- **THEN** each returned scene corresponds to the scene sharing its stable identity
- **AND** no scene is matched by its position in the array

#### Scenario: A settled video result is undone

- **WHEN** the user undoes a settled video result
- **THEN** the scenes, overlays and characters it changed are reversed together as one step

#### Scenario: A scene edited during a video run

- **WHEN** the user edits a scene the run also changed
- **THEN** the result is held for review rather than overwriting that scene
