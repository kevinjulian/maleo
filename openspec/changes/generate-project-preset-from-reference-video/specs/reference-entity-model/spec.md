## ADDED Requirements

### Requirement: Captured frame references retain source provenance

A canonical Reference entity created from a captured source frame SHALL retain provenance containing source kind, normalized source video id and URL, timestamp milliseconds, capture method, and import id. Provenance SHALL be metadata on the canonical entity and SHALL NOT change the existing workspace-role-label-image content key.

Source provenance SHALL be available in Reference detail for inspection. It SHALL NOT be inserted into generation prompts as creative guidance, and it SHALL NOT expose cookies, credentials, local file paths, temporary upload URLs, or signed source URLs.

#### Scenario: Captured frame is inspectable

- **WHEN** a selected source frame is finalized as a Reference entity
- **THEN** Reference detail can show its canonical source URL and capture timestamp
- **AND** generation continues to resolve the entity through its stable id, role, description, and canonical managed image

#### Scenario: Matching entity is reused

- **WHEN** finalize supplies a captured frame whose existing content key matches a canonical workspace entity
- **THEN** the existing entity is reused according to current deduplication behavior
- **AND** source provenance is merged without changing entity identity

#### Scenario: Sensitive source data is discarded

- **WHEN** frame media comes from a local file or authorized source session
- **THEN** persisted provenance contains no local path, source credential, cookie, or temporary signed URL
