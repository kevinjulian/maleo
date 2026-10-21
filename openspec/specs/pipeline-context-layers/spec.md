# Pipeline Context Layers

## Purpose

The boundary between the pipeline and the content that flows through it. The
pipeline owns stage order, gates and what each stage reads; Project Materials,
visual style and the timeline template own appearance, guidance and timing. They
meet only at stage boundaries, and material content never decides which stages run.

## Requirements

### Requirement: Materials do not select a pipeline

Project Materials, visual style, and the style bible SHALL influence the appearance
and content of generated output. They SHALL NOT determine stage order, gating, or
which pipeline profile runs.

#### Scenario: A style word does not change production mechanics

- **WHEN** a Visual material describes a style such as "cinematic"
- **THEN** the selected pipeline profile and its stage order are unaffected, and only
  the appearance of generated assets changes

#### Scenario: Pipeline selection derives from request and content type

- **WHEN** a pipeline profile is selected for a run
- **THEN** the selection reads the request and the project's content type, not the
  material bodies

### Requirement: Material guidance reaches prompts through one conversion

Operator-facing material guidance SHALL reach a stage's prompt only as routed
creative direction channels, produced by a single conversion, so that the same
inputs always compose the same prompt.

#### Scenario: One conversion point

- **WHEN** material guidance is composed into a stage's prompt
- **THEN** it arrives as direction channels produced by that single conversion

#### Scenario: Reference resolution reads the material record

- **WHEN** a stage resolves which reference entities a scene may use
- **THEN** it reads the materials record itself, because that is a lookup of
  available references rather than guidance text to compose

### Requirement: Rules layer last

Where a stage composes material layers into a prompt, the rules layer SHALL be
positioned after the guidance it constrains, so it reads as a hard constraint rather
than as competing guidance.

#### Scenario: Rules follow guidance

- **WHEN** a stage composes story, visual, or voice guidance with rules
- **THEN** the rules layer appears last in the composed prompt

### Requirement: Each context layer is captured at a defined boundary

Every external input a run depends on SHALL be captured at a defined boundary and held stable for the work that reads it, rather than re-read opportunistically.

A project chat command SHALL capture one typed context envelope before planning begins. The envelope SHALL identify resolved editor focus, compact project indexes, captured entity fingerprints, Project Materials and reference ids, validated conversation memory, and the pending action used by the run.

#### Scenario: Timeline template is frozen for the asset pass

- **WHEN** asset generation begins
- **THEN** the selected timeline template is read once and held stable for the whole
  asset pass, even if the project's selection changes during it

#### Scenario: Generation reads an approved revision

- **WHEN** generation consumes a plan
- **THEN** it reads the exact approved revision, and editing the draft afterwards
  does not change what the active generation produces

#### Scenario: Chat command captures live project context

- **WHEN** the user submits a project chat command
- **THEN** planning receives one context envelope describing current project state and resolved focus
- **AND** later editor focus changes do not alter the active run's inputs

#### Scenario: Capture boundaries are documented

- **WHEN** a contributor asks which layer is captured where
- **THEN** the codemap names the boundary for chat focus, conversation memory, materials, direction, visual style, and the timeline template
