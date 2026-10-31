# Spec Delta

## MODIFIED Requirements

### Requirement: Persistence and producers cannot reintroduce retired presets

Project and template writes, agent edits, imports and restoration SHALL enforce the retained primitive contract. A historical restore SHALL apply cleanup before becoming a writable current document. Stale commands SHALL NOT resurrect retired clips through undo, replacement or synchronization. Migration SHALL remain visible through the authoritative project persistence and command feed.

New generation SHALL emit on-screen text either as plain text with explicit supported style/layout data, or as ordinary clips, one per retained primitive layer, with explicit supported style, layout and keyframes. It SHALL NOT select a retired preset or depend on removed preset metadata. Generated motion SHALL consist of project clips only; generation SHALL NOT create, change or delete a saved motion definition in the user's library. Loading an existing project SHALL NOT recreate clips removed by migration.

#### Scenario: A stale client replaces the document

- **WHEN** an old client submits a whole-document replacement containing a retired title after migration
- **THEN** the server refuses the incompatible write and directs the client to reload
- **AND** the cleaned head remains unchanged

#### Scenario: A historical version is restored

- **WHEN** a user restores a historical storyboard containing retired clips
- **THEN** the new current version contains only surviving supported content
- **AND** the command feed and subsequent reload observe that cleaned version

#### Scenario: Generation requests a section title

- **WHEN** a new generation run creates on-screen section text
- **THEN** it emits plain text with supported authored style and layout
- **AND** no retired visual preset is referenced

#### Scenario: Generation emits motion for a beat

- **WHEN** a new generation run places motion for a headline beat
- **THEN** every placed clip is plain text or a retained shape
- **AND** the user's saved motion library is unchanged
