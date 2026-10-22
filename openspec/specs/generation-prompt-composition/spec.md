# Generation Prompt Composition

## Purpose

Every generation prompt is assembled from deterministic, fixed-order layers with no persona-derived
input. Image scene generation first builds structured image prompt intent, then compiles provider-
facing prompt text after provider selection.

## Requirements

### Requirement: Deterministic layered prompt composition

The system SHALL assemble every generation prompt as deterministic, fixed-order layers. The layer order SHALL be stable for each generation stage so a given input set produces a stable prompt. No persona-derived field SHALL appear in the concatenation.

For story planning and text generation, the prompt SHALL include the story base md, routed Story materials, applicable Rules materials, and user instruction in that order.

The story layer SHALL carry the subject and nothing else. It is also the run's research topic, fingerprinted to decide whether existing research still applies, so text appended to it changes which research a run matches and retrieves. The narration writer style SHALL therefore NOT appear in this layer. It SHALL reach the narration drafting prompt as its own craft block, rendered from the profile's fields, and SHALL be absent from visual and voice generation prompts.

For visual generation, the system SHALL first build structured image prompt intent from reusable style/material summary when present, routed Visual materials, Story context needed for scene meaning, applicable Rules materials, typed scene reference assignments with project-level `referenceUse`, and user scene description. The final provider-facing prompt SHALL be compiled from that intent after image provider selection, so reference wording matches the selected provider or model.

For voice generation, the system SHALL route Voice materials and applicable Rules into the voice pipeline without requiring a voice base md.

#### Scenario: Image intent order

- **WHEN** an image is generated
- **THEN** the image intent is derived from reusable style/material summary + routed Visual materials + scene Story context + applicable Rules + typed scene references + user scene description, in that order

#### Scenario: Image provider prompt compiled after selection

- **WHEN** the media worker runs an image generation job
- **THEN** it selects the image provider before rendering the final provider-facing prompt text

#### Scenario: Visual reference attachments come from materials

- **WHEN** Visual materials include selected images, products, props, or castable references
- **THEN** the visual provider receives the corresponding reference images in deterministic order when the selected provider supports native reference inputs

#### Scenario: Story prompt order

- **WHEN** a story/text stage runs
- **THEN** the prompt is story base md + routed Story materials + applicable Rules + user instruction, in that order

#### Scenario: Choosing a writer style does not change the research topic

- **WHEN** the same brief is planned in a workspace with a writer style and in one without
- **THEN** both produce the same story layer
- **AND** both match the same existing research rather than refetching it

#### Scenario: Craft reaches narration drafting only

- **WHEN** a workspace has a writer style and a plan is drafted
- **THEN** the narration drafting prompt contains the craft block
- **AND** the story layer, the visual prompt and the voice prompt contain none of it

#### Scenario: The craft block is rendered once, deterministically

- **WHEN** the same profile is rendered twice
- **THEN** the two blocks are byte-identical
- **AND** they come from a single renderer rather than a per-caller copy

#### Scenario: No persona fields injected

- **WHEN** any generation prompt is built
- **THEN** it contains no `persona.tone`, `persona.audience`, `image_style`, or `style_prefix` content

#### Scenario: All material groups are not blindly concatenated

- **WHEN** a generation prompt is composed
- **THEN** only material groups routed to that stage are included

### Requirement: Base md are flat unversioned repo files

The system SHALL source text generation base layers from flat markdown files in the repository,
prepended verbatim as the first layer. The system SHALL NOT maintain a database version history of
prompt or generation configuration; git is the sole history.

Image scene generation SHALL NOT depend on the legacy scene image markdown template after structured
image intent migration is complete. Image Lab or other explicitly raw-prompt surfaces MAY keep a raw
prompt field when that surface is not scene generation.

#### Scenario: Text base md prepended verbatim

- **WHEN** a text generation prompt is composed for a type with a base md
- **THEN** the file contents are prepended unchanged as layer one, followed by a newline and the remaining layers

#### Scenario: Scene image template removed after migration

- **WHEN** all scene image callers submit structured image intent
- **THEN** scene image generation no longer reads the legacy scene image markdown template

#### Scenario: No config-history tracking for prompts

- **WHEN** a base md or generation config is edited
- **THEN** no prompt/config version-history record is written; the change is tracked only in git

### Requirement: Image prompts exclude script and audio fields

The image prompt compiler SHALL NOT render narration, voiceover, dialogue text, subtitle text,
script beats, narration beats, or audio timing fields into provider-facing image prompts. Those
fields MAY influence upstream planning that creates a visual scene description, but image generation
SHALL receive only pixel-facing visual intent.

#### Scenario: Narration beat omitted

- **WHEN** an image intent or legacy scene object includes narration or voiceover text
- **THEN** the compiled provider prompt contains none of that narration or voiceover text

#### Scenario: Visual moment retained

- **WHEN** upstream planning derives a visual scene moment from narration
- **THEN** the image prompt includes the visual scene moment, not the narration source text

### Requirement: Subject authority is preserved

The image prompt intent SHALL distinguish locked subject traits from generated visual description.
User-authored, Project Materials, and resolved reference traits SHALL be treated as locked subject
guidance. Agent-generated scene text SHALL NOT become locked subject identity unless it is attached
to a resolved reference or explicit user/material subject field.

#### Scenario: Reference traits override generated subject text

- **WHEN** a resolved reference says a subject is a sketch stickman and generated scene text implies a realistic human
- **THEN** the compiled image prompt preserves the sketch stickman subject and rejects the realistic human implication

#### Scenario: Agent scene text describes moment

- **WHEN** an agent-generated scene supplies visual text without a resolved subject reference
- **THEN** the compiler treats that text as scene/moment guidance rather than locked subject identity

### Requirement: Sparse image prompt rendering

The image prompt compiler SHALL render only meaningful pixel-facing fields. It SHALL omit empty
defaults such as "No product", "No action specified", and "Post Processing: None". It SHALL NOT
include application metadata such as job id, provider id, workspace id, project id, or source route.

#### Scenario: Missing optional fields omitted

- **WHEN** an image intent has no product, action, or post-processing guidance
- **THEN** the compiled provider prompt contains no placeholder lines for those fields

#### Scenario: Metadata stays out of prompt

- **WHEN** an image job carries workspace, project, provider, or job metadata
- **THEN** none of those metadata identifiers are rendered into the provider prompt

### Requirement: Scene raw prompt bypass removed

Scene image generation SHALL NOT allow `raw_prompt` to bypass structured image intent after
migration. User-entered scene prompt text SHALL be represented as scene or subject intent and still
pass through output, composition, constraint, negative, and provider-aware reference compilation.

#### Scenario: User scene text still gets system constraints

- **WHEN** an operator enters custom scene prompt text
- **THEN** generation treats it as scene intent and still includes aspect, single-image rules, constraints, negatives, and provider-aware reference handling

### Requirement: Style direction is reusable, creative direction is per-run

The system SHALL treat reusable style direction as Visual Material content or as a generated style guide derived from Visual Materials. Creative direction SHALL remain routed by stage, but user-facing UI SHALL expose it through Project Materials rather than as a separate top-level style concept.

For image generation, routed Visual materials and the material-derived style guide SHALL layer before per-scene user prompt text so a local prompt refines the project look rather than replacing it. A saved reusable style guide SHALL be used exactly when selected and SHALL NOT be summarized again by default.

#### Scenario: Visual tweak layers on top of materials

- **WHEN** a project has Visual materials and the operator enters a per-scene visual prompt
- **THEN** the image prompt includes Visual materials first and the per-scene prompt after them

#### Scenario: Style summary is material-derived

- **WHEN** the system generates or stores a style bible
- **THEN** it is presented as a derived Visual material or material summary, not as a separate top-level library style

#### Scenario: Saved style guide is not rewritten

- **WHEN** a project selects a reusable Visual Material that contains a saved style guide
- **THEN** image prompt composition uses that exact style-guide text
- **AND** no generation step rewrites it unless the operator explicitly regenerates style

### Requirement: Direct scene frame generation submits structured image intent

Direct scene frame generation SHALL derive one structured image intent from the scene's visual moment, action, shot, movement, emotion, project Visual and Rules direction, selected references, and style lock. The media worker SHALL compile the final provider-facing prompt from that intent after selecting the provider. A direct scene frame request SHALL NOT assemble an alternate final prompt in the API.

#### Scenario: Scene fields reach image intent

- **WHEN** a scene with action, shot, movement, emotion, Visual and Rules materials, and selected references is generated directly
- **THEN** the submitted intent preserves those inputs in their corresponding structured fields
- **AND** the provider prompt is compiled from that intent after provider selection

#### Scenario: One-off scene uses existing fields

- **WHEN** an operator regenerates a scene with only its current scene fields
- **THEN** direct generation derives structured intent from those fields without requiring story planning

#### Scenario: Invalid structured input fails closed

- **WHEN** an image request supplies an intent that fails the shared schema
- **THEN** the media worker rejects it before provider submission
- **AND** it does not generate from the raw prompt mirror

### Requirement: Voice generation stays ad-hoc

The system SHALL route Voice materials and applicable Rules into voice synthesis without requiring a base md for voice. Voice SHALL remain outside the base+layers shape used by image and story, but its source text and constraints SHALL still be traceable to Project Materials.

#### Scenario: Voice layers route without base md

- **WHEN** voiceover is synthesized
- **THEN** routed Voice materials and applicable Rules are applied via the voice pipeline, and no `voice.md` base is required

#### Scenario: Pronunciation rules reach voice

- **WHEN** Voice materials contain pronunciation guidance
- **THEN** voiceover synthesis receives that guidance

### Requirement: Generated scene and style text is produced under locked constraints

Locked constraints — selected reference traits, operator or preset-authored Visual materials, and
Rules materials — SHALL be supplied as input to the generation steps that produce scene text and the
style bible, not only to the downstream prompt compiler. A generator that can emit visual prose SHALL
receive the constraints it must not contradict before it emits that prose.

The compiler SHALL NOT be the first place a contradiction is handled. Where a contradiction still
reaches the compiler, it SHALL be reported as a structured finding naming the locked constraint and
the conflicting text. The compiler SHALL NOT silently rewrite or delete generated prose on a keyword
heuristic.

#### Scenario: Scene planning receives the locked subject

- **WHEN** a project locks its subject to a sketch stickman reference and scene text is generated
- **THEN** the scene generation input carries that locked subject constraint
- **AND** the generated scene text describes the moment without proposing a different subject class

#### Scenario: Style bible generation receives Rules

- **WHEN** Rules materials say no human presence and a style bible is generated
- **THEN** the style bible generation input carries that rule
- **AND** the generated style bible does not describe human subjects

#### Scenario: A surviving contradiction is reported, not silently rewritten

- **WHEN** generated text still contradicts a locked constraint at prompt compilation
- **THEN** compilation emits a finding naming the locked constraint and the conflicting text
- **AND** the locked constraint is the one preserved in the provider-facing prompt

### Requirement: Provider prompts dedupe repeated Visual material text

The image prompt compiler SHALL avoid repeating identical Visual material guidance in a provider-facing prompt. If the same preset or material text reaches generation through multiple compatibility fields, it SHALL render once.

#### Scenario: Preset visual prompt is not duplicated

- **WHEN** a preset stores the same Visual guidance in both legacy direction and Project Materials compatibility fields
- **THEN** the provider-facing image prompt includes that guidance once

### Requirement: Story planning separates cast identity from visual moments

The story planner SHALL separate recurring subject identity from per-section visual moment text. Planned cast references SHALL carry stable subject descriptions, while section visual prompts SHALL describe the moment, camera, setting, action, and mood. A section visual prompt SHALL NOT be the only place a recurring subject identity is defined.

#### Scenario: Subject identity is stable across sections

- **WHEN** multiple sections include the same POV protagonist
- **THEN** the protagonist's core visible traits are stored on one planned cast reference
- **AND** each section only describes what that subject is doing or how the shot sees them

#### Scenario: Generated visual text is not locked identity

- **WHEN** a planner writes a section visual prompt that mentions a recurring subject
- **THEN** provider prompt compilation treats the resolved reference description as the locked identity
- **AND** the section visual prompt remains moment guidance

### Requirement: POV prompt composition preserves first-person camera intent

For first-person POV stories, the system SHALL preserve POV camera intent separately from subject identity. The planner SHALL record whether a generated protagonist reference is primarily visible as hands/body/clothing/tools, reflection, silhouette, or face, and image prompt composition SHALL use that visibility mode when compiling the visual moment.

#### Scenario: POV hands are not converted into a portrait scene

- **WHEN** a POV section describes the viewer making a stone blade
- **THEN** the compiled image intent keeps first-person hands/tool visibility
- **AND** it does not force a front-facing portrait of the protagonist

#### Scenario: Reflection can show face when planned

- **WHEN** the story plan marks a POV protagonist reference as visible through water reflection
- **THEN** the section image prompt may show the protagonist's face only through that planned reflection context

### Requirement: Generated story references reach provider-aware prompts

Generated story references SHALL pass through structured image prompt intent and provider-aware prompt compilation exactly like operator-selected references. The provider-facing prompt SHALL not contain plan-local cast keys, unresolved `@Reference` syntax, or claims that an image is attached when the selected provider only supports text-only references.

#### Scenario: Native-reference provider receives ordered files

- **WHEN** the selected image provider supports native references
- **THEN** generated story references are sent as ordered reference images
- **AND** the prompt binds each image index to the matching entity id, role, label, and description

#### Scenario: Text-only provider receives text reference brief

- **WHEN** the selected image provider does not support native references
- **THEN** generated story references are rendered as text subject guidance only
- **AND** the prompt does not claim image files are attached

#### Scenario: Placeholder keys never reach provider

- **WHEN** a story plan has been materialized for generation
- **THEN** provider-facing prompts contain no plan-local keys such as `planned:protagonist`

### Requirement: Story planning prompt composes plan-kind instructions

The story planning prompt SHALL include fixed-order instructions for choosing `planKind` and for filling kind-specific planning fields. The instructions SHALL be part of the planner prompt for `plan_story`, not a second planning call or a separate public tool.

#### Scenario: Plan kind is classified in the planning output

- **WHEN** `plan_story` runs
- **THEN** the planner output includes a supported `planKind`
- **AND** the plan-kind choice is derived from the brief or explicit request in the same planner output that drafts sections

#### Scenario: Explainer fields are produced in the planner output

- **WHEN** the planner chooses `planKind: "explainer"`
- **THEN** the planner output includes the explainer contract fields
- **AND** those fields are written about the user's topic rather than copied from a fixed example

### Requirement: Explainer metadata stays out of provider-facing media prompts

Explainer contract fields and section teaching moves SHALL guide upstream narration and visual moment planning, but SHALL NOT be rendered verbatim into provider-facing image or audio prompts unless transformed into provider-appropriate content.

#### Scenario: Image prompt receives visual grammar, not lesson metadata

- **WHEN** an explainer plan contains learning objective, core question, misconception, concept ladder, evidence moment, transfer takeaway, visual grammar, and teaching moves
- **THEN** provider-facing image prompts contain pixel-facing visual descriptions derived from that plan
- **AND** they do not contain raw field labels such as `learningObjective`, `coreQuestion`, `misconception`, `conceptLadder`, `evidenceMoment`, `transferTakeaway`, or `teachingMove`

#### Scenario: Audio prompt receives narration, not the whole contract

- **WHEN** voiceover is generated for an explainer section
- **THEN** the voice pipeline receives the section narration and voice constraints
- **AND** it does not receive the full explainer contract as script text

#### Scenario: Prompt hygiene test covers explainer fields

- **WHEN** tests compile provider-facing prompts from an explainer story plan
- **THEN** they fail if raw explainer field labels or unrelated teaching metadata appear in the provider prompt

### Requirement: Sparse story prompts expand into an engaging story plan

For video/story planning, the system SHALL expand sparse user prompts into a story plan before asset generation. The plan SHALL preserve the user's requested topic, duration, language, and story intent while adding the narrative structure needed for engaging storytelling.

The expansion SHALL be produced by composing engagement instructions into the planner prompt, so that the engagement fields are derived from the brief on every run. Fixed engagement text that does not vary with the brief does not satisfy this requirement.

#### Scenario: Minimal Indonesian story prompt becomes a structured story plan

- **WHEN** the user asks `ceritakan selama 2 menit apa yang dilakukan manusia purba saat mereka bosan`
- **THEN** the planning stage creates one story plan with target duration near 120 seconds
- **AND** the plan keeps Indonesian narration intent unless the user requests another language
- **AND** the plan covers what prehistoric humans did when bored rather than replacing the topic with unrelated symbolism

#### Scenario: Story plan contains engagement structure

- **WHEN** a sparse story prompt is planned
- **THEN** the story plan includes a hook, premise, tension or narrative question, escalation, turn or reveal, resolution, and emotional arc
- **AND** each section or beat has a narrative job traceable to the user's brief

#### Scenario: Engagement fields vary with the brief

- **WHEN** two unrelated briefs are planned
- **THEN** their hook, tension, escalation, turn, resolution, and visual motif differ
- **AND** each set refers to its own brief's subject

#### Scenario: Language follows the brief, not a keyword list

- **WHEN** a brief is written in a language the job has not declared
- **THEN** the plan's narration language is resolved from the brief itself
- **AND** it is not decided by matching the brief against a fixed list of topic words

#### Scenario: Story visuals change with narration

- **WHEN** the story plan targets a narrated video longer than one short beat
- **THEN** the plan includes ordered visual shots or beats that follow the narration start-to-finish
- **AND** no long section depends on one static image when the narration contains multiple distinct moments

### Requirement: One story plan selects structure by data

The planning stage SHALL represent short beat-driven videos and longer narrated videos as one story plan artifact. The choice between beat structure, narration-section structure, research support, word budget, and shot cadence SHALL be encoded as story plan data rather than separate planning flows.

The threshold that separates beat structure from narration-section structure SHALL have one definition shared by the code that resolves it and the code that records it.

#### Scenario: Two-minute story uses narration-first structure

- **WHEN** a user asks for a two-minute narrated story
- **THEN** the story plan uses narration-section structure with an appropriate word budget
- **AND** it remains the same story plan artifact type used for shorter beat-driven videos

#### Scenario: Short story uses beat structure without a second flow

- **WHEN** a user asks for a fifteen-second video and states no structure
- **THEN** the story plan resolves to beat structure
- **AND** it is produced by the same planning flow that plans narrated stories

#### Scenario: An explicit structure request is honored at any duration

- **WHEN** the user or agent explicitly requests beat structure for a two-minute story
- **THEN** the plan records beat structure
- **AND** the requested structure is not overridden by the duration threshold

#### Scenario: A silent beat plan carries no narration

- **WHEN** a short beat-structure story plan has no narration
- **THEN** its sections carry empty narration and explicit visual durations
- **AND** asset generation produces visuals without requiring voiceover timing

#### Scenario: Approval refers to the story plan

- **WHEN** planning completes
- **THEN** the user-facing approval summary refers to reviewing the story plan
- **AND** it does not ask the user to choose between a video blueprint and a longform plan

#### Scenario: The story plan is rendered to the user

- **WHEN** the planning stage emits the story plan artifact
- **THEN** the client renders it as a plan the user can review
- **AND** re-emitting the plan within a run replaces the previous card rather than appending another

### Requirement: Story planning composes embodied POV lifecycle instructions

The `plan_story` planning prompt SHALL include fixed-order instructions for embodied POV lifecycle planning when applicable. These instructions SHALL require the planner to distinguish the viewer's body, system pressure, sensory model, agency limits, lifecycle stage progression, and shot diversity grammar from provider-facing visual prompt prose.

#### Scenario: Bee brief receives non-human POV instructions

- **WHEN** `plan_story` plans a worker bee lifecycle POV brief
- **THEN** the planner output includes non-human body constraints and sensory model fields
- **AND** section and shot planning use bee-scale visual moments instead of human portrait assumptions

#### Scenario: Object or creature POV uses same contract

- **WHEN** `plan_story` plans a non-historical embodied POV brief such as an object, machine, creature, or organism
- **THEN** the planner uses the same lifecycle and shot grammar contract
- **AND** no history-specific requirement is needed to produce engaging POV structure

### Requirement: Embodied POV metadata stays out of provider-facing prompts

Embodied POV lifecycle fields, section lifecycle fields, and shot grammar fields SHALL guide upstream visual moment planning, but SHALL NOT be rendered as raw schema labels or narration metadata into provider-facing image prompts. Provider prompts SHALL contain only pixel-facing scene descriptions, style/material constraints, and provider-appropriate reference guidance.

#### Scenario: Raw lifecycle labels are omitted

- **WHEN** an embodied POV plan contains fields such as viewer role, body constraints, sensory model, camera role, body action, emotional pressure, or novelty key
- **THEN** provider-facing image prompts do not contain raw field labels such as `viewerRole`, `bodyConstraints`, `sensoryModel`, `cameraRole`, `bodyAction`, `emotionalPressure`, or `noveltyKey`
- **AND** the prompt still describes the visible scene derived from those fields

#### Scenario: Bee prompt is pixel-facing

- **WHEN** image generation runs for a worker bee POV shot
- **THEN** the provider-facing prompt describes visible bee-scale scene details such as antennae, compound-eye perspective, wax comb, pollen, queen chamber, flower field, or threat shadow
- **AND** it does not include lifecycle planning notes, narration text, or timing metadata

### Requirement: POV shot diversity is checked before image prompt submission

Before submitting image prompts for an embodied POV section, the system SHALL check planned shot grammar for same-chapter repetition. Image generation SHALL use the revised or accepted shot plan, not a set of adjacent prompts that repeat the same camera role, location, and action.

#### Scenario: Repeated historical chapter prompts are blocked

- **WHEN** an embodied POV historical section has adjacent shots with the same camera role, same location, and same body action
- **THEN** those prompts are not submitted unchanged to the image provider
- **AND** the section's shot plan is revised or flagged before image generation continues

#### Scenario: Accepted diverse shots compile normally

- **WHEN** an embodied POV section has diverse shot grammar
- **THEN** image prompt compilation proceeds through the existing provider-aware image intent path
- **AND** provider-specific reference support behavior remains unchanged

### Requirement: Story image prompts correlate to final narration beats

For story video generation, the system SHALL determine the number of visual beats
from the measured audio and the timeline template's `maxVisualBeatSec`, and SHALL
then author one provider-facing visual per beat. The beat count SHALL be an input
to authoring; the system SHALL NOT predict it at plan time, and SHALL NOT assign a
smaller set of planned shot prompts across a larger set of measured beats.

Authoring SHALL receive, for the section being generated: each beat's exact
narration text in order, the section's planned shots as approved visual intent,
the locked visual constraints, the project's Visual and Rules direction, the Story
Bible's subjects and locations as closed id lists, and the preceding beat's end
state. Authoring SHALL return exactly one structured Beat Visual Intent per beat,
each identified by its beat index.

Each authored intent SHALL describe the concrete visual moment for the beat it
illustrates, including visible action, camera or framing, location or prop
novelty, emotional pressure, and any planned POV body/camera grammar, as
structured fields rather than as a single prose string. Adjacent beats SHALL
differ in at least one of visible action, camera role, composition, location, or
subject focus.

Authoring SHALL NOT return medium, realism, visual treatment, lighting, palette,
or negatives. Those are rendered from the Story Bible at compile time and are
identical across a story's beats.

The provider-facing prompt SHALL NOT include raw narration text, subtitle text,
audio timing fields, or narration beat metadata. Narration beat text MAY inform
the authored visual, but the prompt sent to the image provider SHALL remain
pixel-facing.

The system SHALL NOT derive a beat's visual content from a hardcoded
subject-keyword table.

#### Scenario: One authored visual per measured beat

- **WHEN** a story section's narration is split into visual beats after TTS measurement
- **THEN** the number of provider-facing image prompts equals the number of beats
- **AND** each prompt was authored for that beat's exact narration text
- **AND** no prompt is a planned shot prompt reused for more than one beat

#### Scenario: Authoring returns structured intent

- **WHEN** visuals are authored for a section's measured beats
- **THEN** each beat's result carries subject ids, visual moment, action, end state, and camera fields
- **AND** it carries no medium, lighting, palette, or negative fields

#### Scenario: Planned shots steer authoring without becoming the prompt

- **WHEN** a section carries operator-approved planned shots
- **THEN** those shots are supplied to authoring as visual intent
- **AND** the provider-facing prompts are the authored per-beat visuals, not the planned shot text

#### Scenario: Authoring returns the wrong count

- **WHEN** an authoring result does not contain exactly one visual per beat, or omits or repeats a beat index
- **THEN** the system retries the authoring call
- **AND** on continued failure marks the section failed and retryable
- **AND** does not fall back to reusing a planned prompt across beats

#### Scenario: Narration text does not leak

- **WHEN** a final story image prompt is compiled from a narration beat
- **THEN** the provider-facing prompt contains no verbatim narration sentence, caption text, `Narration beat:` label, or timing metadata
- **AND** it still contains a visual moment that corresponds to the narration beat

#### Scenario: POV beat keeps body-scale grammar

- **WHEN** a final visual beat belongs to an embodied POV story
- **THEN** its prompt includes the beat's POV camera role, body clue, location/action, and prop or sensory focus
- **AND** it does not collapse into a generic section-wide environment prompt

### Requirement: Duplicate final story image prompts are blocked before provider generation

The system SHALL detect adjacent duplicate story image beats by comparing their
**structured intent fields** — visual moment, shot type, camera angle, location id,
and subject ids — before any composition or style rendering. The check SHALL NOT run
on the fully composed provider string, because the rendered style block is identical
across a story's beats by design and a per-beat suffix makes adjacent composed
prompts differ regardless of whether their visual content is identical.

Two adjacent beats SHALL be treated as duplicates when they match on every compared
field. Where a beat carries only legacy prose, the comparison SHALL fall back to
normalizing that prose.

If two adjacent beats are duplicates, the system SHALL retry authoring for that
section. If the duplicate persists, the system SHALL skip image generation for the
section and mark it retryable with an error naming the duplicate beat positions. It
SHALL NOT submit duplicate adjacent prompts to the image provider.

#### Scenario: Adjacent duplicate beats never reach the provider

- **WHEN** two adjacent story visual beats match on visual moment, shot type, camera angle, location, and subject ids
- **THEN** no image provider call is made for the duplicate beats
- **AND** the section records a retryable error naming the duplicate beat positions

#### Scenario: Identical rendered style cannot mask a duplicate

- **WHEN** two adjacent beats carry identical structured intent and differ only by the rendered style block, an index label, or a composition label
- **THEN** the duplicate check still reports them as duplicates

#### Scenario: Legacy prose beats still compared

- **WHEN** two adjacent beats carry only a legacy prose visual prompt
- **THEN** the duplicate check compares their normalized prose

#### Scenario: Similar motif with changed visual details is allowed

- **WHEN** two adjacent beats share a motif but differ in visible action, camera role, prop focus, location, or emotional pressure
- **THEN** the prompts are not treated as duplicates
- **AND** generation may proceed for both visual beats

### Requirement: Project style constraints adapt to story subject and camera context

Project Materials, Rules, and locked visual constraints SHALL be supplied to
per-beat visual authoring as constraints on what may be written, so that
incompatible subject wording is resolved while the visual is authored rather than
rewritten afterwards. The system SHALL NOT carry a hardcoded table of subject
keywords, subject-specific substitutions, or subject-specific prohibited-figure
rewrites.

Where a style constraint names a subject form that the story's subject cannot
take, authoring SHALL preserve the constraint's medium, linework, palette, and
simplicity intent while expressing it for the actual subject. Prohibitions in
Rules SHALL be preserved verbatim in intent and SHALL NOT be softened by
adaptation.

#### Scenario: Style intent survives a subject it does not literally fit

- **WHEN** Project Materials request a style whose wording names a subject form the story's subject cannot take
- **THEN** the authored visual preserves the style's medium, linework, palette, and simplicity intent
- **AND** expresses it for the story's actual subject
- **AND** the resolution is produced by authoring under the supplied constraints, not by a keyword substitution table

#### Scenario: Hard rules remain hard

- **WHEN** Rules materials prohibit a subject, presence, or element
- **THEN** every authored visual for the section honours that prohibition
- **AND** subject adaptation does not reintroduce the prohibited element

#### Scenario: A new subject needs no code change

- **WHEN** a story is generated for a subject the codebase has never seen
- **THEN** style and subject conflicts are resolved from the supplied constraints alone
- **AND** no new subject-specific branch is required for the visuals to be authored

### Requirement: Typed visual references compile by role

Provider-aware image prompt compilation SHALL preserve typed reference metadata until the provider has been selected. Native-reference providers SHALL receive ordered reference files plus role-specific binding text. Text-only providers SHALL receive truthful text fallback by role and SHALL NOT claim image files are attached.

Role-specific prompt wording SHALL distinguish style, character, location, product, and prop semantics. `referenceUse` SHALL be read from the Visual reference entry, not from scene-level overrides. Character wording SHALL preserve identity when configured as `exact`. Style wording SHALL guide look, mood, lighting, palette, atmosphere, and visual grammar. Location wording SHALL guide place and layout. Product wording SHALL require user-selected source material and prefer exact preservation or direct placement when exact pixels matter. Prop wording SHALL bind reusable objects.

#### Scenario: Character reference is attached and bound

- **WHEN** the selected provider supports native references and a scene selects a Character reference
- **THEN** the provider request includes the character image in the ordered reference array
- **AND** the prompt binds that image to the character label and identity

#### Scenario: Text-only provider gets truthful fallback

- **WHEN** a scene selects a Character reference and the selected provider does not support native references
- **THEN** the provider-facing prompt describes the character from its label and description
- **AND** it does not say that a reference image is attached

#### Scenario: Product exactness is not promised by weak generation

- **WHEN** a scene requires an exact product and the selected provider cannot preserve exact image references
- **THEN** prompt compilation reports the weaker capability or chooses direct asset placement where available
- **AND** it does not silently ask the provider to recreate the product as if exact preservation were guaranteed

#### Scenario: Reference use comes from the reference entry

- **WHEN** a scene selects Anna and Anna's Visual reference entry has `referenceUse: exact`
- **THEN** prompt compilation binds Anna as an exact character reference
- **AND** it does not look for a scene-level use-mode override

### Requirement: Generated visual references fill only missing roles

Agent generation SHALL create draft visual references or style guides only for roles that lack a user-set, preset-set, or locked value. Generated Style MAY be auto-used. Generated Character and Location references SHALL record provenance and SHALL require approval before use. Product references SHALL NOT be generated.

#### Scenario: Missing character can be generated

- **WHEN** a story plan requires a recurring character and no matching Character reference exists
- **THEN** the agent may create a generated Character reference with provenance
- **AND** image generation does not use it until the operator approves it

#### Scenario: Existing character is not regenerated

- **WHEN** a project already has a user-set Character reference matching a planned character
- **THEN** the agent uses that reference instead of generating another character

#### Scenario: Locked style guide constrains generated references

- **WHEN** a locked style guide exists and the agent generates a missing Character reference
- **THEN** the generated character prompt receives the locked style guide and applicable Rules before it creates the reference image

#### Scenario: Product reference is never generated

- **WHEN** a story plan or scene requires a Product reference and no selected Product reference exists
- **THEN** the system reports the missing Product reference
- **AND** it does not generate a Product reference automatically

### Requirement: Prompt composition receives hint-resolved scene references

Image prompt composition SHALL receive the final ordered scene reference ids after manual assignment and hint resolution have been reconciled. Prompt composition SHALL preserve each selected reference's role and project-level `referenceUse`. It SHALL NOT read `selectionHint` as prompt style text unless a later prompt layer explicitly includes it for explainability.

#### Scenario: Hint selects reference before prompt compile

- **WHEN** hint resolution selects Anna for a scene
- **THEN** image intent includes Anna as a selected reference
- **AND** provider prompt compilation uses Anna's role and `referenceUse`

#### Scenario: Hints are not style text

- **WHEN** a Visual reference has `selectionHint: mother, woman, Anna`
- **THEN** prompt compilation does not append that hint as visual style guidance
- **AND** the hint only affects which reference ids reach the prompt

#### Scenario: Ambiguity blocks before prompt compile

- **WHEN** hint resolution finds multiple matching character references for one unassigned scene role
- **THEN** image intent is not sent to provider prompt compilation for that scene
- **AND** the operator receives an assignment-required message

### Requirement: Planned shot cues are verified against their narration

At story plan materialization, the system SHALL verify that every non-empty
planned shot cue occurs in its own section's narration after normalization. A cue
that does not occur SHALL be recorded as unverified for that shot rather than
silently retained, so downstream narration grouping never matches on text the
narrator does not speak.

#### Scenario: Cue occurs in the section narration

- **WHEN** a planned shot supplies a cue that appears in its section's narration
- **THEN** the cue is retained for narration grouping and shot duration planning

#### Scenario: Cue does not occur in the section narration

- **WHEN** a planned shot supplies a cue absent from its section's narration
- **THEN** the cue is recorded as unverified
- **AND** narration grouping falls back to its balanced contiguous split rather than matching on the absent text

### Requirement: Story beat prompts are not assembled by prose concatenation

For story visual beats, the provider-facing prompt SHALL be compiled by mapping the
Story Bible and the beat's structured intent into image prompt intent fields. The
system SHALL NOT produce a story beat prompt by concatenating the authored visual,
the routed material layers, the timeline guidance, and the style summary into a
single prose value.

A story beat's compiled intent SHALL populate its subject locks, scene, composition,
style, lighting/colour, constraint, and negative fields. It SHALL NOT carry the whole
composed description in the scene visual moment while the remaining fields stay
empty.

The system SHALL NOT hardcode a shot type or camera movement for a story beat that
carries planned or authored camera grammar.

#### Scenario: Compiled intent is populated, not blank

- **WHEN** a story beat is compiled for an image provider
- **THEN** its intent carries subject locks, composition, style, lighting/colour, and negatives from the Story Bible and the beat intent
- **AND** the scene visual moment carries the beat's moment rather than the entire composed description

#### Scenario: No hardcoded shot type

- **WHEN** a story beat carries planned or authored camera grammar
- **THEN** the compiled composition uses that grammar
- **AND** the shot type is not fixed to a default value

#### Scenario: Style is stated once

- **WHEN** a story beat prompt is compiled
- **THEN** the story's medium, palette, and lighting appear once in the prompt
- **AND** they are not restated inside the scene visual moment

### Requirement: Story generation consumes one approved snapshot

Story generation SHALL resolve narration, visual intent, references, voice direction, Story Bible, and constraints from one captured approved snapshot. Every output SHALL name source semantic beat and revision. Draft state SHALL NOT enter in-progress pass.

#### Scenario: No approved snapshot

- **WHEN** normal story generation is requested without approved snapshot
- **THEN** no speech or image provider call occurs

#### Scenario: Draft changes mid-pass

- **WHEN** draft changes during generation
- **THEN** pass continues solely from captured snapshot

### Requirement: One-shot story generation creates implicit approvals

`create_story_video` SHALL plan through the full video planning workflow — approved-plan replacement guard, direction routing, and pre- and post-research clarification unless the request bypasses questions — and SHALL then generate without the interactive plan-approval gate. Flow SHALL create approved snapshot before provider calls and SHALL implicitly approve automatic extension revisions under same one-shot authorization.

#### Scenario: Explicit one-shot build

- **WHEN** `create_story_video` completes planning
- **THEN** it creates implicit approved snapshot
- **AND** generation proceeds without interactive gate

#### Scenario: One-shot build asks story decisions

- **WHEN** `create_story_video` runs for a request that does not bypass questions and clarification is eligible
- **THEN** the run suspends for the story decisions before framing
- **AND** generation starts only after planning completes

#### Scenario: One-shot build over an approved plan

- **WHEN** `create_story_video` runs while an approved plan exists
- **THEN** the run asks before replacing it
- **AND** rejection keeps the approved plan and generates nothing

#### Scenario: One-shot duration extension

- **WHEN** one-shot output measures short
- **THEN** each extension revision is implicitly approved before its provider calls

### Requirement: Duration extension follows approved policy

Review policy SHALL add proposed continuation to draft without TTS, image, or timeline work and SHALL wait for approval. Auto policy SHALL create and implicitly approve extension revision before generating it. Existing compatible outputs SHALL remain in both modes.

#### Scenario: Review additions

- **WHEN** approved review-policy output measures short
- **THEN** continuation appears as unapproved draft
- **AND** no provider calls or clips exist for additions

#### Scenario: Auto approve additions

- **WHEN** approved auto-policy output measures short
- **THEN** extension revision is created and implicitly approved
- **AND** generated outputs record extension revision and approval mode

### Requirement: Incompatible story state is never reused

Speech, captions, measured segments, authored visual intent, and images SHALL be reused only when recorded input hashes match captured approved inputs. Clearing top-level URL or obtaining equal counts SHALL NOT prove compatibility.

#### Scenario: Same beat count after narration edit

- **WHEN** narration changes but measured beat count stays same
- **THEN** old visual intent and images are not admitted as current

#### Scenario: Planned visual changes

- **WHEN** approved visual intent differs from prior input
- **THEN** new visual authoring uses approved intent
- **AND** provider submission excludes old authored intent

### Requirement: Measured render beats retain semantic source identity

Measured audio SHALL continue determining voice and visual render-beat partitions. Every derived segment SHALL record semantic source beat and approved revision. Every measured visual beat SHALL continue receiving distinct structured visual intent.

#### Scenario: Semantic beat splits after TTS

- **WHEN** one semantic beat creates several measured segments
- **THEN** every segment records same source beat
- **AND** every visual segment receives its own structured intent
