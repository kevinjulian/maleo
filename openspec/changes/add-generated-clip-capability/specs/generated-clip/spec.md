## ADDED Requirements

### Requirement: Clip generation composes existing seams rather than adding a provider

Authoring a clip composition SHALL use the text provider already selected for the
workspace. The system SHALL NOT introduce a separate provider capability for clip
generation, because the choice of model that writes a composition is the same choice
already made for every other text generation.

Rendering SHALL happen in the service that already owns the rendering runtime, reached
over the existing render-service boundary. Orchestration — prompt assembly, gates,
scoring, revision — SHALL live with the caller of the text seam.

#### Scenario: Clip authoring follows the workspace text provider

- **WHEN** a workspace changes its text provider and a clip is generated afterwards
- **THEN** the new provider authors the composition, with no clip-specific provider
  setting to change

#### Scenario: No clip provider appears in settings

- **WHEN** the capability settings surface is listed
- **THEN** there is no separate clip provider to select

#### Scenario: The render package gains no workspace dependency

- **WHEN** the rendering package's manifest is inspected after clip support lands
- **THEN** it declares no workspace dependency, so the web application can keep
  importing its composition

### Requirement: A clip request is a typed brief, not a prompt string

A clip generation request SHALL carry a structured brief. The brief SHALL include the
clip grammar, the duration in seconds, the aspect ratio, the frame rate, a theme
derived from the project's brand palette, the narrative purpose of the clip, and the
summaries of its sibling clips. It MAY include narration text with word timings and
urls of assets the composition may use. A free-text prompt alone SHALL be rejected.

Duration, aspect and frame rate are imposed by the timeline slot. A generated
composition SHALL NOT choose them.

#### Scenario: Brief without a purpose is rejected

- **WHEN** a clip request arrives carrying a grammar and duration but no narrative purpose
- **THEN** the request is rejected as invalid and no generation is attempted

#### Scenario: Imposed duration is honoured

- **WHEN** a brief specifies `durationSec: 6` at 30 fps
- **THEN** the rendered clip is exactly 180 frames, and a clip of any other length fails
  the frame gate

#### Scenario: Sibling summaries reach the prompt

- **WHEN** a clip is generated for a slot whose neighbours are already generated
- **THEN** the assembled prompt carries those neighbours' grammars and one-line summaries

### Requirement: A clip grammar constrains what gets generated

Every clip brief SHALL name a grammar. A grammar SHALL select which composition
patterns apply and what scene skeleton the generation starts from. A generated
composition SHALL NOT compose outside its declared grammar.

#### Scenario: Grammar is recorded on the output

- **WHEN** a clip is generated under the `product-reveal` grammar
- **THEN** the generation review records that grammar, and the same grammar is available
  for regeneration

#### Scenario: Unknown grammar is rejected

- **WHEN** a brief names a grammar the system does not define
- **THEN** the request is rejected before any model is called

### Requirement: Assembled guidance layers repository overrides last

The prompt SHALL be assembled from the vendored third-party motion ruleset followed by
this repository's overrides, in that order. The overrides exist to contradict parts of
the vendored text, so precedence SHALL be positional and the vendored copy SHALL remain
byte-identical to its pinned upstream commit.

#### Scenario: Overrides follow the text they contradict

- **WHEN** the guidance is assembled
- **THEN** the override section appears after the vendored sections, so the later word
  is this repository's

#### Scenario: Vendored text is not edited to express a local rule

- **WHEN** a local rule contradicts the vendored ruleset
- **THEN** it is stated in the override layer and the vendored file is unchanged

### Requirement: Generated clips carry no audio, captions or camera motion

A generated clip SHALL render mute and SHALL NOT render captions. The storyboard SHALL
set `Static` camera movement for a generated clip, because the composition owns its own
internal motion.

#### Scenario: Audio in a generated clip fails the gate

- **WHEN** a rendered clip's technical probe reports audio present
- **THEN** the clip fails the frame gate and is not admitted

#### Scenario: Storyboard does not apply camera motion over a generated clip

- **WHEN** a generated clip is placed on the timeline
- **THEN** its scene movement is `Static` and no preset camera motion is composed on top

### Requirement: Generated composition passes a static gate before it is rendered

Before a generated composition is bundled, the system SHALL check its source against
rules that can be decided without running it. The static gate SHALL reject a composition
that imports outside the allowlist, that interpolates without an easing curve, that omits
the required layer stack for its grammar, that renders video through a non-streaming
component, or that hardcodes colour values instead of reading the supplied theme.

A static-gate failure SHALL re-enter generation as a revision request naming the violated
rule, not surface as a generation error.

#### Scenario: Linear interpolation is rejected

- **WHEN** generated source interpolates a value with no easing curve and no spring
- **THEN** the static gate fails and a revision is requested, citing the rule

#### Scenario: Hardcoded colour is rejected

- **WHEN** generated source contains a colour literal outside the supplied theme module
- **THEN** the static gate fails and a revision is requested

#### Scenario: Passing source proceeds to render

- **WHEN** generated source violates no static rule
- **THEN** the composition is bundled and rendered

### Requirement: The rendered file is measured deterministically, not judged by a model

The frame gate SHALL be computed from the rendered file itself: a container probe, and
pixel analysis of sampled frames. It SHALL NOT require a vision model, and the text seam
SHALL NOT be asked to inspect images — its contract is text-in and text-out.

The probe SHALL record container validity, duration, resolution, frame rate and whether
audio is present. Frame analysis SHALL sample at least four frames, record their paths,
and report black frames, blank or near-uniform frames, content outside the safe area, and
insufficient text contrast.

#### Scenario: A black frame is detected without a model call

- **WHEN** a rendered clip contains a fully black sampled frame
- **THEN** the frame gate reports it from pixel analysis alone

#### Scenario: Fewer than four sampled frames fails the gate

- **WHEN** a review reports three sampled frames
- **THEN** the review is invalid and the clip is not admitted

#### Scenario: Frame paths are recorded

- **WHEN** the frame gate runs
- **THEN** the sampled frame paths are recorded on the review, so the measurement is
  checkable after the fact

### Requirement: Clip quality is scored against the brief and thresholded

The system SHALL score a generated clip against named quality dimensions and convert the
score to a verdict. Dimensions SHALL include motion without narrative purpose, visuals
that decorate rather than communicate, over-reliance on typography, and resemblance to
sibling clips.

These dimensions are judgements about the composition, so they SHALL be scored by reading
the composition source against the brief through the text seam, not by inspecting frames.

A verdict of `revise` SHALL re-enter generation with the failing dimensions named. A
verdict of `fail` SHALL end generation.

#### Scenario: Motion with no narrative purpose scores against the clip

- **WHEN** a generated composition animates elements in a way the brief's purpose does
  not motivate
- **THEN** the motion dimension scores poorly and the overall verdict is at best `revise`

#### Scenario: A clip resembling its sibling scores against the clip

- **WHEN** a generated composition closely resembles the sibling summaries in its brief
- **THEN** the resemblance dimension scores poorly

#### Scenario: Scoring reads source, not pixels

- **WHEN** quality is scored
- **THEN** the composition source and the brief are what the text seam receives

### Requirement: A generated clip is admitted only with a populated review

The system SHALL NOT store a rendered clip without a review recording the probe, the
frame analysis, the quality score and an overall status. The review is the evidence the
rendered output was measured; a generation that cannot produce one SHALL fail rather than
admit the file.

#### Scenario: Review accompanies every admitted clip

- **WHEN** clip generation succeeds
- **THEN** the result carries a review whose status is `pass` and whose probe, frame
  analysis and quality score are fully populated

#### Scenario: A file without a review is not admitted

- **WHEN** a rendered path exists but no review was produced
- **THEN** the generation fails and the file is not admitted as an asset

#### Scenario: A claimed pass does not override a measured failure

- **WHEN** a review's overall status says `pass` but its frame analysis records black frames
- **THEN** the clip is not admitted

### Requirement: Revision is bounded by attempts, wall time and spend

The generate-gate-revise loop SHALL stop at a configured maximum number of revisions, a
maximum wall time, and a spend ceiling covering the whole loop rather than a single
attempt. Reaching any limit SHALL end the loop.

#### Scenario: Revision limit ends the loop

- **WHEN** a clip has been revised the maximum number of times and still does not pass
- **THEN** the loop ends and the clip falls back rather than revising again

#### Scenario: Spend ceiling ends the loop mid-revision

- **WHEN** the loop's accumulated spend reaches the ceiling before a passing verdict
- **THEN** the loop ends and no further attempt is made

### Requirement: A failed generation falls back to the preset path

When clip generation ends without a passing verdict, the system SHALL fall back to the
existing preset composition for that slot. The timeline SHALL NOT be left without a clip,
and the fallback SHALL be visible as such rather than presented as generated.

#### Scenario: Fallback fills the slot

- **WHEN** generation exhausts its revision budget without passing
- **THEN** the slot is filled by the preset path and the project remains renderable

#### Scenario: Fallback is distinguishable

- **WHEN** a slot was filled by fallback
- **THEN** the surface shows the clip as preset-derived, not as a generated clip

### Requirement: A generated clip persists as a source and an evictable bake

A generated clip SHALL persist its composition source as the artifact of record and its
rendered file as a cache derived from that source. The rendered file SHALL be keyed by
the composition source together with the duration, aspect and frame rate it was rendered
for.

The source SHALL NOT be deleted while the clip exists. The rendered file MAY be evicted
and re-derived. The generation review SHALL persist with the generation record rather
than as a third file.

#### Scenario: Changing slot duration invalidates only the bake

- **WHEN** a generated clip's slot duration changes
- **THEN** the existing rendered file no longer matches its key, a re-bake is scheduled,
  and the composition source is unchanged

#### Scenario: Evicted bake is re-derivable

- **WHEN** a rendered file has been evicted and the clip is needed again
- **THEN** it is re-rendered from the stored composition source with no model call

#### Scenario: Cleanup never removes a source

- **WHEN** artifact cleanup runs
- **THEN** composition sources for live clips are retained and only superseded bakes are
  removed

### Requirement: Downstream surfaces treat a generated clip as a video asset

The storyboard and the render pipeline SHALL reference a generated clip by url, exactly
as they reference any other video asset. No downstream consumer SHALL depend on the clip
having been generated.

#### Scenario: Render pipeline is unchanged

- **WHEN** a storyboard containing a generated clip is rendered
- **THEN** the clip plays as a video asset and the render pipeline needs no knowledge of
  its origin

#### Scenario: Preview and export play the same file

- **WHEN** a generated clip is scrubbed in the editor and later exported
- **THEN** both play the same rendered file, preserving preview and export parity
