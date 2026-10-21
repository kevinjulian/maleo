# image-generation-ledger Specification

## Purpose

One row per generation attempt, for every medium the system generates. A row is
opened before the provider is called and resolved when the attempt concludes, so
attribution survives a restart and billed spend always has an artifact row —
including on synchronous paths, where the temptation is to write once on success.

The capability is still named for images because that is what it first recorded.
It is not image-only: `medium` names what each row recorded, reads are scoped by
it inside the ledger module rather than at each call site, and the columns that
describe an artifact are medium-neutral where the meaning is shared and
medium-specific where it is not.

## Requirements

### Requirement: Every generation is recorded once, at the generation choke point

The system SHALL open one ledger row per generation attempt, written at the single
module every producer funnels through, not at each producer's call site. The row
SHALL be opened before the generation is submitted, and SHALL be resolved to a
terminal state when the attempt concludes.

A generation attempt therefore has a lifecycle in the ledger, not merely a success
record. The row is opened pending, and becomes either a completed row carrying the
artifact's url, or a failed row carrying none. Recording at submit rather than at
completion is what makes attribution durable — see the restart requirement below,
which cannot be satisfied by a model that writes only on success.

This holds whether the generation is asynchronous or synchronous. An asynchronous
producer opens the row before submitting and resolves it when the job concludes; a
synchronous producer opens the row before calling the provider and resolves it
after, within the same request. The lifecycle is required because generation is
metered and billed, not because a job queue exists — so a synchronous path SHALL
NOT collapse it into a single write on success.

Recording SHALL NOT be conditional on which entry point was used. The lab route,
the scene route, and the server-side agent helpers are producers of the same kind
of thing, and a producer that reaches a generation service without opening a ledger
row is a defect regardless of how it got there.

Surfaces that present generated artifacts SHALL show completed rows. Pending and
failed rows are operational state; their existence SHALL NOT cause an artifact to
appear in a gallery or a history that has none.

#### Scenario: A lab generation is recorded

- **WHEN** an image is generated from the image lab
- **THEN** one ledger row exists for it, completed, carrying its workspace, prompt,
  url and creation time

#### Scenario: An agent generation is recorded like a route generation

- **WHEN** an agent tool generates a character portrait or a scene frame server-side,
  without passing through the HTTP route
- **THEN** one ledger row exists for it, of the same shape as a route generation's

#### Scenario: A new producer cannot silently skip the ledger

- **WHEN** a generation path reaches the image service
- **THEN** it does so through the shared submit/run helpers, and its attempt opens a row

#### Scenario: A synchronous generation still has a lifecycle

- **WHEN** a synchronous producer generates an artifact and returns it in the same
  request
- **THEN** its row was opened pending before the provider was called and resolved
  after, rather than written once on success

#### Scenario: A failed generation yields no artifact

- **WHEN** the provider call fails or the job times out
- **THEN** the attempt's row is resolved failed, no completed row exists for it, and
  no artifact is presented anywhere for that attempt

#### Scenario: An in-flight generation is not mistaken for an artifact

- **WHEN** a generation has been submitted but has not yet resolved
- **THEN** its pending row does not appear as an artifact in the gallery or in a history

### Requirement: One row per image, never per prompt

The ledger SHALL be append-only with respect to images: generating the same prompt
twice SHALL produce two rows with two urls, and SHALL NOT overwrite or collapse the
earlier image.

Prompt-level facts — how often a prompt was used, when it was last used — SHALL be
derived from ledger rows rather than stored as a mutable per-prompt record. A
uniqueness constraint on (workspace, prompt) is what made the previous store unable
to represent a regenerated image, and MUST NOT be reintroduced.

#### Scenario: A prompt is regenerated

- **WHEN** an operator generates the same prompt a second time
- **THEN** both images are retrievable, each with its own creation time

#### Scenario: Prompt reuse is still answerable

- **WHEN** a surface asks how many times a prompt has been generated
- **THEN** the answer is derived from that prompt's completed ledger rows, so failed
  attempts do not inflate a reuse count

### Requirement: An image is attributed to where it came from

Every ledger row SHALL carry the workspace it was generated for and the source that
produced it. The set of sources SHALL be specific to the medium: an image
distinguishes at minimum a lab generation, a project clip, a reference entity
image, and an agent-produced image; speech distinguishes at minimum a lab
synthesis, a scene voiceover, and an agent-produced clip.

A source value SHALL NOT be offered for a medium that cannot produce it. A surface
that lets an operator filter by source SHALL offer only the values its medium has.

A row SHALL carry a project id when the generation belonged to a project. A lab
generation and a workspace-scoped reference image belong to no project, and their
absent project id SHALL mean exactly that — not "unknown".

Producers SHALL supply the context they own: the project a generation belongs to,
and which producer they are. The recording layer SHALL NOT infer a project by
guessing from prompt text or by reading back the timeline document.

The workspace SHALL be resolved from the stored record rather than taken from a
client request body, except on the one surface that lets an operator choose a
workspace directly. A generation that names a project SHALL be attributed to that
project's own workspace, because that column is the authoritative record of which
tenant owns the project — a request body is not. This also keeps a tenant from being
selected by sending different JSON.

#### Scenario: A clip image knows its project

- **WHEN** an image is generated for a clip inside a project's editor
- **THEN** its ledger row carries that project's id, its workspace, and the clip source

#### Scenario: A scene voiceover knows its project

- **WHEN** speech is synthesized for a scene inside a project's editor
- **THEN** its ledger row carries that project's id, its workspace, and the scene source

#### Scenario: A project's image is attributed to that project's tenant

- **WHEN** a generation names a project
- **THEN** its workspace is the one recorded against that project, not one supplied
  by the caller

#### Scenario: A tenant cannot be chosen by request body

- **WHEN** a request carrying a project names a different workspace than the project's
- **THEN** the project's own workspace is used

#### Scenario: A lab image has no project

- **WHEN** an image is generated in the lab, which is scoped to a workspace
- **THEN** its ledger row carries the workspace and no project id

#### Scenario: A medium is not offered another medium's source

- **WHEN** a source filter is built for a medium
- **THEN** it offers only the sources that medium can be produced by

#### Scenario: Images are filterable by origin

- **WHEN** a caller asks for a workspace's images, or one project's images, or only
  the images a given source produced
- **THEN** the ledger answers each without scanning unrelated rows

### Requirement: Recording survives a process restart

Attribution SHALL be durable from the moment a generation is submitted, which is why
the row is opened then rather than on completion. The system SHALL NOT depend on
in-process state to associate a job with its workspace or project.

An API restart between submitting a generation and observing its completion SHALL
NOT cause the resulting image to go unrecorded or to lose its attribution.

Resolving an attempt SHALL be idempotent: observing the same conclusion more than
once SHALL NOT produce a second row.

A row left pending because its conclusion was never observed SHALL remain
distinguishable from one that completed and from one that failed, so an abandoned
attempt is visible as such rather than indistinguishable from an in-flight one.

#### Scenario: The API restarts mid-generation

- **WHEN** a generation is submitted, the API restarts, and the job then completes
- **THEN** the image is still recorded with its original workspace and project

#### Scenario: A completion is observed more than once

- **WHEN** the same completed job is polled repeatedly
- **THEN** exactly one ledger row exists for it, resolved once

#### Scenario: An attempt is never concluded

- **WHEN** a generation is submitted and its conclusion is never observed
- **THEN** its row remains identifiable as unresolved, and no image is presented for it

### Requirement: Removing an image from a surface does not erase that it was generated

Deleting a generated image from a gallery or a history SHALL hide it from those
surfaces while preserving the record that the generation occurred and what it was
attributed to.

A per-image affordance SHALL NOT destroy ledger history. The record is the artifact
side of a metered, billed generation, and spend that happened SHALL remain
attributable regardless of whether an operator has since tidied the surface that
displayed it. Permanent removal is an administrative operation, not a per-tile one.

#### Scenario: An operator deletes an image

- **WHEN** an operator deletes a generated image from the gallery or the lab
- **THEN** it no longer appears on either surface

#### Scenario: The generation is still accounted for

- **WHEN** an image has been deleted from every surface that showed it
- **THEN** the record that it was generated, for which workspace and project, remains

### Requirement: An image is marked individually

Marking an image as notable SHALL apply to that image, not to the prompt that
produced it.

A prompt that has produced several images SHALL be able to have some marked and
others not. Whether a prompt has any marked image SHALL be derivable from its images;
the reverse SHALL NOT be assumed, because a prompt-level mark cannot say which of its
images it means.

#### Scenario: One of several images is marked

- **WHEN** a prompt has produced three images and an operator marks one
- **THEN** that image is marked and the other two are not

#### Scenario: Marks survive the move off the prompt store

- **WHEN** a prompt was marked before this change, having produced one retained image
- **THEN** that image is marked afterwards

### Requirement: A recovered row stays legible after the recovery is retired

Rows written by the historical recovery persist in existing databases after the
recovery pass itself is removed. The system SHALL keep the marking those rows
carry and SHALL keep presenting them honestly: a recovered row's absent prompt
SHALL NOT be rendered as an empty prompt, and its approximate timestamp SHALL
remain identifiable as approximate.

The marking SHALL NOT be treated as dead because nothing writes it any more. It
is read by every surface that lists ledger rows, and the rows that carry it are
permanent.

#### Scenario: A recovered row renders as approximate

- **WHEN** a surface displays a ledger row that carries the recovered marking
- **THEN** its timestamp is presented as approximate rather than as a recorded time

#### Scenario: A recovered row's missing prompt is not shown as empty

- **WHEN** a recovered row whose prompt was never recorded is displayed
- **THEN** the surface states that no prompt was recorded rather than rendering a
  blank prompt

### Requirement: Image lab exposes the provider used by the next generation

The image lab SHALL expose image-provider selection in the bottom composer before an operator submits a lab generation. The selector SHALL read and write through the same provider status contract used by project settings, including effective provider, selected provider, provider health, and worker configuration state.

The lab SHALL NOT maintain a separate provider registry or submit a lab-only provider id outside the established provider-setting contract. A provider that is unavailable, unconfigured, or stale SHALL be visible as unavailable and SHALL NOT be selectable for the next generation.

#### Scenario: Operator chooses a ready provider from the lab

- **WHEN** an operator opens `/images/lab` and the provider status endpoint lists ready image providers
- **THEN** the bottom composer offers those ready providers
- **AND** choosing one persists through the existing image-provider setting endpoint
- **AND** the next lab generation uses the effective provider reported by that setting

#### Scenario: Unavailable provider is visible but blocked

- **WHEN** the provider status endpoint lists a provider whose health is not ready
- **THEN** the lab provider control identifies that provider as unavailable
- **AND** the operator cannot select it for the next generation

#### Scenario: Provider status cannot be loaded

- **WHEN** the provider status endpoint cannot be loaded
- **THEN** the lab keeps prompt submission governed by the existing generation health state
- **AND** the composer reports that provider selection is unavailable rather than showing a stale or invented provider list

### Requirement: Image lab composer is usable on mobile

The image lab composer SHALL remain usable on phone-width viewports. The prompt input SHALL keep a readable text area, the reference, aspect, and send controls SHALL NOT overlap, the app bottom navigation SHALL NOT render on the image lab route, and the sticky composer SHALL NOT hide the final feed item when the feed is scrolled to the bottom. Provider and aspect-ratio selection SHALL use compact selected-value triggers and reference-picker-style popovers on both desktop and mobile.

#### Scenario: Phone-width lab composer

- **WHEN** an operator opens `/images/lab` on a phone-width viewport
- **THEN** the prompt input, provider control, reference control, aspect control, and send button are all reachable
- **AND** no control overlaps another control or extends outside the viewport
- **AND** the mobile bottom navigation is not rendered

#### Scenario: Mobile submit target remains reachable

- **WHEN** the phone-width composer contains selected references and a non-empty prompt
- **THEN** the send button remains visible and reachable without horizontal scrolling

#### Scenario: Provider selector opens as a shared popover

- **WHEN** an operator taps the image lab provider control on desktop or phone-width viewport
- **THEN** provider selection opens in a compact popover anchored to the composer
- **AND** the trigger shows only the selected provider
- **AND** the popover lists all configured providers with ready and unavailable states
- **AND** choosing a ready provider applies the existing provider-setting contract

#### Scenario: Ratio selector opens as a shared popover

- **WHEN** an operator taps the image lab ratio control on desktop or phone-width viewport
- **THEN** aspect-ratio selection opens in a compact popover anchored to the composer
- **AND** the trigger shows only the selected ratio
- **AND** the popover lists the available ratio options
- **AND** choosing a ratio updates the next generation aspect ratio

### Requirement: Image lab does not add an internal header

The image lab SHALL NOT render an internal `imagelab-header` above the feed. The route SHALL rely on the app shell for global navigation and keep the generation surface focused on feed and composer.

#### Scenario: Lab route has no internal header

- **WHEN** an operator opens `/images/lab` on desktop or mobile
- **THEN** no element with `imagelab-header` is rendered
- **AND** the feed starts without an extra lab-specific header row

### Requirement: A ledger row names the medium it recorded

Every ledger row SHALL carry the medium of the artifact it records, distinguishing
at minimum a generated image from generated speech. The medium SHALL be stored, not
inferred from which columns happen to be populated or from the shape of a url.

Reads SHALL be scoped by medium. A caller asking for images SHALL NOT receive
speech rows, and a caller asking for speech SHALL NOT receive image rows, without
each call site remembering to filter — the scoping SHALL live in the ledger module
so a forgotten predicate cannot leak one medium into the other's surface.

Rows recorded before the medium was stored SHALL be treated as images, because that
is what they are.

#### Scenario: An image read excludes speech

- **WHEN** a caller lists a workspace's images
- **THEN** only image rows are returned, whatever else the workspace has generated

#### Scenario: A speech read excludes images

- **WHEN** a caller lists a workspace's speech
- **THEN** only speech rows are returned

#### Scenario: Existing rows remain images

- **WHEN** the ledger is read after rows recorded before the medium existed
- **THEN** those rows are images, and appear in image surfaces unchanged

#### Scenario: Counting is per medium

- **WHEN** a count is taken for a medium
- **THEN** it counts that medium's rows only

### Requirement: A row carries the attributes its medium needs

The columns that describe an artifact SHALL be medium-neutral where the meaning is
shared and medium-specific where it is not. The artifact's location SHALL be one
column across media. Attributes that only one medium has — an image's aspect, a
speech clip's voice, provider and duration — SHALL be recorded where they apply and
absent where they do not.

An absent medium-specific attribute SHALL mean the medium does not have it, not
that it is unknown.

#### Scenario: A speech row carries its voice, provider and duration

- **WHEN** speech is recorded
- **THEN** its row carries the voice used, the provider that synthesized it, and the
  clip's duration

#### Scenario: An image row carries no voice

- **WHEN** an image is recorded
- **THEN** its voice, provider and duration are absent, and that absence is not read
  as missing data

#### Scenario: One column locates the artifact

- **WHEN** any surface resolves an artifact from its row
- **THEN** it reads the same location column regardless of medium
