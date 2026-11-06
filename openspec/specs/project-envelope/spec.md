# project-envelope Specification

## Purpose

Give every client one versioned, portable unit for a project: its document, media library and asset manifest, with rules that admit it losslessly or refuse it before any stored state changes.

## Requirements

### Requirement: A project has one portable envelope

The system SHALL represent a portable project as one JSON envelope. The envelope SHALL hold:

- a format name `maleo.project` and an integer `formatVersion`.
- compatibility information: the document schema version and the lowest envelope version a reader needs to preserve the envelope.
- the project identity, its type (`video`, `image` or `text`) and its title.
- the storyboard document of that type, as the editable scope plus every other stored-document field (presentation, pacing devices, migration markers and agent bookkeeping), so the stored document can be rebuilt with no field lost.
- the project media library entries.
- the asset manifest entries for every media identity that the document or the library references.

The envelope SHALL NOT hold editor chrome, chat history, settings, device paths, `blob:` URLs, `data:` preview URLs or signed storage URLs. Media SHALL appear only by stable media identity or by external URL.

#### Scenario: A video project becomes an envelope

- **WHEN** the system builds the envelope of a video project with clips, captions, markers, bookmarks, materials and two library entries
- **THEN** the envelope holds that document, both library entries and one manifest entry for each referenced identity, and it holds no chat or editor chrome

#### Scenario: The stored document is rebuilt from the envelope

- **WHEN** the system rebuilds the stored storyboard document from an envelope of a project with presentation and pacing devices
- **THEN** the rebuilt document equals the stored document, including presentation, pacing devices and agent bookkeeping

#### Scenario: A clip references media from the library

- **WHEN** a clip and a library entry reference the same media identity
- **THEN** the envelope lists that identity once in its manifest

### Requirement: Admission preserves every authored field

The shared engine SHALL admit an envelope and serialize it again. Admission followed by serialization, with no edit between them, SHALL return a JSON value equal to the admitted value. Every field the engine does not model SHALL survive with its value. A field that is absent SHALL stay absent, and a field that is empty SHALL stay empty. Every controller SHALL use this shared admission, so web, server and native clients admit and serialize an envelope the same way.

#### Scenario: An envelope round-trips

- **WHEN** a controller admits a supported envelope and serializes it with no edit
- **THEN** the output equals the input, including binary-inexact seconds and absent-versus-empty fields

#### Scenario: An envelope carries an unknown field

- **WHEN** a supported envelope carries a field that the engine does not model, at the envelope, document, clip or library-entry level
- **THEN** that field round-trips unchanged

#### Scenario: Two clients admit the same envelope

- **WHEN** the web client and a native build of the engine admit the same fixture and serialize it
- **THEN** both outputs are equal

### Requirement: Incompatible envelopes are refused before overwrite

Admission SHALL refuse an envelope when its format name is wrong, its `formatVersion` is newer than the engine supports, its document schema version is unsupported, a field fails validation, a manifest entry is missing for a referenced identity, or the engine cannot preserve a field. The refusal SHALL name a stable reason code and the field path that caused it. A controller SHALL admit an envelope before it replaces stored project state with that envelope, and a refused envelope SHALL leave the stored state unchanged.

#### Scenario: A newer envelope arrives

- **WHEN** a controller receives an envelope whose `formatVersion` is greater than the version its engine supports
- **THEN** admission refuses it with reason `unsupported-format-version`, and no stored project state changes

#### Scenario: A document schema is unsupported

- **WHEN** an envelope holds a video document whose `schemaVersion` is not supported
- **THEN** admission refuses it with reason `unsupported-schema` and the path of the document's `schemaVersion`

#### Scenario: A manifest entry is missing

- **WHEN** a clip references a managed media identity that the envelope manifest does not list
- **THEN** admission refuses it with reason `missing-manifest-entry` and the clip's path

#### Scenario: A device URL is present

- **WHEN** an envelope holds a `blob:` or `data:` preview URL where a media reference belongs
- **THEN** admission refuses it with reason `device-url` and the field path

### Requirement: Project members can read the envelope

`GET /projects/:id/envelope` SHALL return the current envelope of the project to an authenticated member of the project's workspace. The route SHALL build the envelope from the current storyboard version, the project media library and the derived asset manifest, and SHALL serialize it through the shared engine. Any other caller SHALL receive the same refusal the project routes give and SHALL learn nothing about the project.

#### Scenario: A member reads the envelope

- **WHEN** a workspace member requests the envelope of a project in that workspace
- **THEN** the response is an envelope that the shared engine admits

#### Scenario: A non-member reads the envelope

- **WHEN** an account outside the workspace requests the envelope
- **THEN** the request is refused exactly as other project routes refuse it

#### Scenario: A stored project cannot be preserved

- **WHEN** a member requests the envelope of a project whose stored document the shared engine refuses
- **THEN** the route returns the compatibility refusal with its reason code, and returns no partial envelope

#### Scenario: The envelope matches the editor

- **WHEN** an editor saves a change and then requests the envelope
- **THEN** the envelope document equals the document the editor holds

### Requirement: Compatibility fixtures define the format

The repository SHALL hold envelope fixtures for each supported project type, for a newer format version, and for each refusal reason. The Rust engine and the web wrapper SHALL run the same fixtures. The exchange format SHALL be documented with its fields, versions and refusal reasons.

#### Scenario: A fixture changes its result

- **WHEN** a change to the engine makes a fixture admit, refuse or serialize differently than recorded
- **THEN** the fixture test fails and names the fixture
