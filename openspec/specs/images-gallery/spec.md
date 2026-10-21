# images-gallery Specification

## Purpose

TBD - created by archiving change images-gallery-page. Update Purpose after archive.

## Requirements

### Requirement: Images opens a gallery of everything generated

The Images destination SHALL show generated images across every workspace and every
project, newest first, without requiring the operator to first choose a scope.

The gallery SHALL show every recorded image regardless of which producer made it —
lab generations, project clip images, reference entity images, and agent-produced
images are all images the operator's work produced.

The gallery SHALL show images only. The ledger behind it also records other media;
a non-image artifact SHALL NOT appear in Images, and the exclusion SHALL come from
the ledger read rather than from the gallery filtering after the fact.

An image count SHALL count images. A count of prompts, of any other grouping, or of
artifacts of another medium, SHALL NOT be labelled as a count of images.

#### Scenario: The gallery opens unscoped

- **WHEN** an operator opens Images
- **THEN** they see the most recently generated images across all workspaces and
  projects, without selecting a workspace first

#### Scenario: Clip images are present

- **WHEN** images were generated inside a project's editor rather than in the lab
- **THEN** they appear in the gallery alongside lab images

#### Scenario: Speech is absent

- **WHEN** a workspace has generated both images and speech
- **THEN** Images shows the images and none of the speech, and its count counts the
  images alone

#### Scenario: Repeat generations both appear

- **WHEN** the same prompt was generated more than once
- **THEN** each resulting image appears as its own tile

### Requirement: An image says where it came from

Every gallery tile SHALL identify the image's origin: the project it was generated
for, or the workspace when it belongs to no project.

Where an image belongs to a project, the gallery SHALL offer a path to that project.

The gallery SHALL let an operator narrow by project, by workspace, and by producing
source.

#### Scenario: A tile attributes its image

- **WHEN** an operator looks at any tile
- **THEN** they can tell which project or workspace produced it

#### Scenario: From an image back to its work

- **WHEN** an operator selects a project-attributed image
- **THEN** they can navigate to that project

#### Scenario: Narrowing to one project

- **WHEN** an operator filters by a project
- **THEN** only images attributed to that project remain

#### Scenario: An image with no project is not mislabelled

- **WHEN** a lab image, which belongs to no project, is shown
- **THEN** it is attributed to its workspace rather than to an arbitrary project

### Requirement: The gallery and the generation session are separate destinations

Browsing generated images and running a generation session SHALL be distinct,
separately linkable destinations. Neither SHALL be reachable only from inside the
other.

Navigation entries labelled for images SHALL lead to the gallery. The generation
session SHALL remain reachable from the gallery.

Links to the previous images location SHALL continue to resolve, to the generation
session, so existing bookmarks do not break.

#### Scenario: A gallery view can be linked

- **WHEN** an operator shares the address of the gallery
- **THEN** it opens the gallery, not a generation session

#### Scenario: A generation session can be linked

- **WHEN** an operator shares the address of the lab
- **THEN** it opens the generation session directly

#### Scenario: Reaching the lab from the gallery

- **WHEN** an operator is browsing the gallery and wants to generate
- **THEN** the generation session is reachable from there

#### Scenario: An old link still works

- **WHEN** an operator follows a bookmark to the previous images address
- **THEN** they land on the generation session rather than an error

### Requirement: The generation session shows its own history faithfully

The generation session's feed SHALL show that workspace's lab generations in the
order they were generated, including repeat generations of the same prompt as
separate entries.

The session SHALL read the same record the gallery reads, so an image cannot be
present in one surface and absent from the other.

#### Scenario: A regenerated prompt appears twice in the feed

- **WHEN** an operator generates the same prompt twice in one workspace
- **THEN** the feed shows both generations, each with its own image

#### Scenario: The two surfaces agree

- **WHEN** an image is generated in the lab
- **THEN** it appears both in the session's feed and in the gallery

#### Scenario: The session stays scoped to its own generations

- **WHEN** an operator opens a workspace's generation session
- **THEN** the feed shows that workspace's lab generations, not every project's clip images
