# Speech Generation Tool

## Purpose

The Speech destination: a gallery of every clip a workspace has synthesized, and
the lab that makes them. The counterpart to the Images tool, and deliberately the
same surface — a gallery with URL-carried filters, and a lab that is the image
lab's chrome with a different medium in it — so the two read as one product rather
than two.

Speech synthesis is synchronous: the clip comes back in the response, with no job
to poll. The attempt is still recorded as a lifecycle rather than a single write on
success, because synthesis is metered before the response is written and billed
spend must not be able to leave no trace of what it bought.

## Requirements

### Requirement: Speech opens a gallery of everything synthesized

The Speech destination SHALL show generated speech clips for the active workspace,
newest first, without requiring the operator to first choose a scope.

The gallery SHALL show every recorded speech clip regardless of which producer made
it — lab syntheses, scene voiceovers, and agent-produced clips are all speech the
operator's work produced.

The gallery SHALL show speech only. An image SHALL NOT appear in it, and a speech
clip SHALL NOT appear in the Images gallery, even though both are recorded in the
same ledger.

#### Scenario: The gallery opens unscoped within the workspace

- **WHEN** an operator opens Speech
- **THEN** they see the most recently synthesized clips across the workspace's
  projects, without selecting a project first

#### Scenario: Scene voiceovers are present

- **WHEN** speech was synthesized inside a project's editor rather than in the lab
- **THEN** it appears in the gallery alongside lab clips

#### Scenario: The two galleries do not bleed into each other

- **WHEN** a workspace holds both generated images and generated speech
- **THEN** Images lists only the images and Speech lists only the speech

### Requirement: A speech clip is auditionable and identifiable from its tile

Each tile SHALL let the operator play the clip without leaving the gallery, and
SHALL identify the clip by the text that was spoken, the voice used, the provider
that synthesized it, and its duration.

Playing a clip SHALL NOT re-synthesize it and SHALL NOT be a billed operation. The
tile plays the stored artifact.

#### Scenario: Operator plays a clip from the gallery

- **WHEN** the operator activates the play control on a tile
- **THEN** the stored audio plays, and no synthesis request is issued

#### Scenario: A tile names its voice and provider

- **WHEN** a tile is rendered for a recorded clip
- **THEN** it shows the spoken text, the voice, the provider, and the duration

#### Scenario: Only one clip plays at a time

- **WHEN** a clip is playing and the operator activates a second clip's play control
- **THEN** the first stops and the second plays

### Requirement: The speech lab and the speech gallery are separate destinations

The lab SHALL hold the synthesis session — the composer, the voice selection, and
the feed of what this workspace has synthesized. The gallery SHALL be the
destination for browsing recorded clips, reachable as its own route rather than as
a panel inside the lab.

Gallery filters SHALL be carried in the URL, so a narrowed view is shareable.

#### Scenario: A narrowed gallery view is shareable

- **WHEN** an operator narrows the gallery by project, source, or search text and
  copies the address
- **THEN** opening that address elsewhere reproduces the same narrowed view

#### Scenario: The lab keeps its session across visits

- **WHEN** an operator synthesizes in the lab, navigates away, and returns
- **THEN** the feed still shows what that workspace synthesized, in order

#### Scenario: Narrowing a filter is not a navigation

- **WHEN** the operator edits a gallery filter
- **THEN** the address updates without adding a history entry, so Back leaves the
  gallery rather than undoing the filter

### Requirement: The speech lab is the image lab's surface, not a second design

The two labs SHALL read as one surface with a different medium in it. The speech
lab SHALL use the same composition as the image lab: a full-height feed that owns
the route with no app bottom navigation, a centred single-column feed of
generated items, and a sticky composer whose controls sit on one row with the
input.

An item in the feed SHALL lead with its artifact, then carry the text that
produced it and a secondary line of metadata, with reuse offered on the item
itself. Both labs SHALL order their feed the same way, so moving between them does
not reverse the direction of history.

Where the mediums genuinely differ the controls SHALL differ — a voice picker
where the image lab has an aspect control, an audition control the image lab has
no use for, and a character allowance because synthesis is synchronous. Those are
the only differences that SHALL be visible.

#### Scenario: The two labs are recognisably the same surface

- **WHEN** an operator moves from the image lab to the speech lab
- **THEN** the feed, the composer, and the item layout occupy the same positions
  and differ only in the controls the medium requires

#### Scenario: History runs the same direction in both

- **WHEN** each lab is opened with several items in its history
- **THEN** both order the feed the same way

#### Scenario: The lab owns its route

- **WHEN** the speech lab is open
- **THEN** the app bottom navigation is not rendered over its composer, as on the
  image lab

### Requirement: A gallery offers only filter values its medium can produce

Filter options SHALL be derived from the clips that exist, for the medium the
gallery shows. A source value that speech cannot have SHALL NOT be offered as a
speech filter, and a project with no speech SHALL NOT be offered as a speech
filter option.

#### Scenario: An image-only source is not offered for speech

- **WHEN** the operator opens the Speech gallery's source filter
- **THEN** the offered values are those speech can be produced by, and a value that
  only images can carry is absent

#### Scenario: Facets are scoped to the active workspace

- **WHEN** the facet list is built
- **THEN** it names only projects belonging to the active workspace

### Requirement: A synthesis is recorded as an attempt, without a job queue

Speech synthesis SHALL remain a single request: the caller receives the clip in the
response, and there is no separate submit, poll, or job record.

The attempt SHALL still be recorded durably. A row SHALL be opened before synthesis
is attempted and resolved to completed or failed after it concludes, both within
that one request. Recording SHALL NOT be conditional on the response reaching the
caller.

This exists because synthesis is metered and billed before the response is written.
An attempt whose spend was recorded SHALL NOT be able to leave no trace of what the
spend bought.

#### Scenario: A lab synthesis is recorded

- **WHEN** speech is synthesized from the speech lab
- **THEN** one ledger row exists for it, completed, carrying its workspace, the
  spoken text, the voice, the provider, the url and the duration

#### Scenario: Billed spend always has an artifact row

- **WHEN** synthesis succeeds and is metered, but the process ends before the
  response is returned
- **THEN** a row for that attempt exists rather than the spend being unattributable

#### Scenario: A failed synthesis yields no clip

- **WHEN** the provider call fails or the provider is unconfigured
- **THEN** the attempt's row is resolved failed, and no clip is presented in the
  gallery or the lab feed for that attempt

#### Scenario: No polling surface is introduced

- **WHEN** a client synthesizes speech
- **THEN** it obtains the result from that request alone, with no job id to poll

### Requirement: Lab input is bounded so synthesis fits one request

The lab SHALL bound the length of text it will submit in a single synthesis, and
SHALL tell the operator the bound before they exceed it rather than failing after
submission.

The bound exists because synthesis is synchronous. It is a limit on the lab's
composer, not on the recorded ledger or on longform voiceover paths that already
split their text.

#### Scenario: Operator is told the bound while composing

- **WHEN** the operator types text approaching the limit
- **THEN** the composer shows the remaining allowance

#### Scenario: Over-long text is refused before it is billed

- **WHEN** the operator submits text beyond the bound
- **THEN** the request is refused with a message naming the limit, and no metered
  synthesis is attempted
