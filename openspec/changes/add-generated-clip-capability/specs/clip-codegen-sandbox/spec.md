## ADDED Requirements

### Requirement: Model-authored code never executes in a signed-in browser

Code authored by a model SHALL execute only in the render service. It SHALL NOT be
loaded, imported or evaluated in the web application, which runs in a browser carrying
the user's session. Editor surfaces SHALL consume the rendered file, never the
composition source.

#### Scenario: Web app receives a file, not a module

- **WHEN** a generated clip is displayed in the editor
- **THEN** the editor loads the rendered video file and at no point imports the generated
  module

#### Scenario: Composition source is not served to the browser

- **WHEN** the web application requests a generated clip's assets
- **THEN** the composition source is not among them

### Requirement: Generated modules resolve imports from an allowlist

A generated composition SHALL import only from an explicit allowlist. Imports outside the
allowlist SHALL fail the static gate before bundling. The runtime libraries the
composition depends on SHALL be supplied by the host rather than bundled by the generated
module, so a single instance of each is shared.

#### Scenario: Disallowed import is rejected

- **WHEN** generated source imports a module outside the allowlist
- **THEN** the static gate fails and the composition is never bundled

#### Scenario: Runtime libraries are externals

- **WHEN** a generated composition is bundled
- **THEN** the shared runtime libraries resolve to the host's instances rather than copies
  inside the generated bundle

### Requirement: The render workspace has no ambient reach

The workspace a generated composition is rendered in SHALL have no network access, and no
reach into repository source, runtime data, or secrets. Assets a composition may use SHALL
be provisioned into the workspace before rendering begins.

#### Scenario: Asset is pre-provisioned, not fetched

- **WHEN** a brief names asset urls
- **THEN** those assets are placed in the workspace before the render runs, and the
  composition references them locally

#### Scenario: Fonts do not require a network fetch

- **WHEN** a composition uses the project's brand typeface
- **THEN** that typeface was provisioned into the workspace and is loaded from it

#### Scenario: Secrets are unreachable

- **WHEN** a render runs
- **THEN** the workspace exposes no credential store, environment secret, or runtime
  database path

### Requirement: Rendering runs under resource and time caps

Every render of a generated composition SHALL run under a wall-time cap and SHALL be
terminated when it is exceeded. Termination SHALL fail the attempt rather than leaving a
process running.

#### Scenario: Overrunning render is terminated

- **WHEN** a render exceeds its wall-time cap
- **THEN** the process is terminated and the attempt is recorded as failed

#### Scenario: Caller abort stops the render

- **WHEN** the caller aborts an in-flight clip generation
- **THEN** the render is terminated and no partial output is admitted

### Requirement: The rendering runtime stays where it already lives

Clip rendering SHALL run in the package that already owns the rendering runtime. Neither
the orchestrating package nor the media worker SHALL acquire a browser runtime in order to
support clips.

#### Scenario: Media worker hosts no browser runtime

- **WHEN** a clip generation job runs
- **THEN** the media worker carries the job record and no browser runtime is started
  inside it

#### Scenario: Orchestration calls the render service

- **WHEN** a composition is ready to render
- **THEN** it is sent to the render service over the existing service boundary rather
  than rendered in place
