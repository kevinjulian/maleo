# Spec Delta

## MODIFIED Requirements

### Requirement: The intro and section fields are named for the preset kind they resolve to

The fields selecting a timeline template's intro and section titling SHALL remain named as text selections, not as the unrelated camera-motion preset entity. They SHALL resolve only to plain text or no title. New generation SHALL use explicit supported style and layout for enabled titles, not a retired visual preset.

Existing selections that name retired visual presets SHALL be disabled during migration. This SHALL NOT remove the Video Template record, alter unrelated policy or recreate clips deleted from existing projects. Other supported titling selections SHALL remain unchanged.

#### Scenario: Fields name the text preset

- **WHEN** a timeline template is read
- **THEN** its intro and section titling fields identify supported plain text or no title
- **AND** they do not offer retired stock visual presets

#### Scenario: Renamed fields resolve unchanged

- **WHEN** supported plain-text or no-title selections are read through the existing field names
- **THEN** their supported selection and rendered behavior remain unchanged

#### Scenario: Existing template survives the rename

- **WHEN** a stored timeline template is read after migration
- **THEN** its record and unrelated policy survive
- **AND** retired visual-preset selections are disabled while supported selections are preserved

#### Scenario: A new title uses a primitive

- **WHEN** a generation run creates an enabled intro or section title
- **THEN** it creates plain text with supported explicit style and layout
- **AND** loading an older project does not regenerate a removed title
