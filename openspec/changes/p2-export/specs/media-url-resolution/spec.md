# Spec Delta

## ADDED Requirements

### Requirement: Editor media stays usable after URL expiry

The editor SHALL load, seek, replay, decode, and export managed media from stable
URLs after a signed destination expires. A browser SHALL obtain a fresh read
without persisting that destination. Storage failures SHALL be visible to the
operator rather than appearing as a successful upload, generation, or export.

#### Scenario: A timeline stays open past URL expiry

- **WHEN** an operator seeks or replays media on a timeline kept open beyond the URL lifetime
- **THEN** the media loads from a freshly authorized destination

#### Scenario: Browser export reads media

- **WHEN** a browser export decodes managed video, audio and images for the Rust renderer
- **THEN** every byte read succeeds from a freshly authorized destination and the export contains the expected media

#### Scenario: Storage fails during an upload

- **WHEN** a managed upload cannot write its bytes
- **THEN** the operator sees a storage failure and no media appears as successfully saved

## REMOVED Requirements

### Requirement: Editor media remains usable after URL expiry

**Reason**: The simplified draft export leaves (p2-export E3). Its scenario cannot stay in the requirement.

**Migration**: Replaced by "Editor media stays usable after URL expiry", which keeps every other rule and scenario and covers browser export.
