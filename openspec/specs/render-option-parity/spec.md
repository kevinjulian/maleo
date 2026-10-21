# render-option-parity Specification

## Purpose

Keep the set of render options the client offers equal to the set the pipeline
implements, and make a difference between them fail a build rather than produce
a plausible-looking export.

Two vocabularies have to agree and nothing structural made them: what a picker
offers, and what the renderer can carry. `4:5` was selectable in the timeline
and in Project Settings while no layer implemented it — `aspectOf` had no
branch, `FORMAT_DIMS` no row, `aspectMap` no entry. Because all three defaulted
the same way, the preview agreed with the export and both were 9:16, so a
control labelled "Portrait" produced a vertical video and every check in the
repository passed.

The lookup between the vocabularies is what hides the disagreement:
`FORMAT_DIMS[fmt] ?? FORMAT_DIMS["9:16"]` cannot distinguish "unsupported" from
"9:16". This capability makes the supported sets enumerable, gives each
vocabulary one declared home, and compares them by importing values rather than
by matching source text.

## Requirements

### Requirement: An option the client offers is an option the pipeline renders

Every render option selectable in the web client SHALL be implemented in each
layer that has to carry it, and the repository SHALL enforce the agreement with a
check that runs outside the reviewer's judgement.

For a video aspect this means a row in `FORMAT_DIMS`, an entry in the aspect
ratio table behind `aspectOf`, and an entry in the renderer's `aspectMap`. For a
scene transition it means a handled arm in `resolveTransition` and in the
entrance/exit styles.

`4:5` was selectable in two surfaces and implemented in none of the three aspect
layers. Because all three defaulted the same way, preview agreed with export and
both were 9:16 — a control labelled "Portrait" produced a vertical video, and no
test, type, or reviewer could see it. The lookup between the two vocabularies is
what hides the disagreement: `FORMAT_DIMS[format] ?? FORMAT_DIMS["9:16"]` cannot
distinguish "this format is not supported" from "this format is 9:16".

#### Scenario: An option is offered before it is implemented

- **WHEN** a value is added to the client's aspect list without a matching entry in `FORMAT_DIMS`, the aspect ratio table, and `aspectMap`
- **THEN** the parity check fails and names the option and the layer that lacks it

#### Scenario: A transition is added to the shared vocabulary

- **WHEN** a value is added to `TIMELINE_SCENE_TRANSITIONS` and no arm handles it
- **THEN** the parity check fails, rather than the transition rendering as a cut and the defect being found by watching an export

#### Scenario: An implemented option is withdrawn from a lower layer

- **WHEN** a format is removed from `aspectMap` while a picker still offers it
- **THEN** the parity check fails, because the direction of the difference does not change that the two vocabularies disagree

#### Scenario: The check runs with the verification commands

- **WHEN** the repository's verification commands run
- **THEN** the parity check is one of them, and a difference fails the run rather than producing advice

### Requirement: A supported set is declared, not inferred from control flow

A vocabulary the parity check compares SHALL be a declared value that can be
imported and enumerated. A supported set expressed only as branches with a
fallback arm SHALL be converted to a table with a lookup.

`aspectOf` returned `9/16` for `16:9`, `1:1`, and every other input through a
ternary chain, so `aspectOf("4:5")` and `aspectOf("nonsense")` were the same
answer. A set that cannot be enumerated cannot be compared, and a fallback that
cannot be distinguished from a real answer is what turns an unsupported option
into a plausible-looking output.

Where an implementation is genuinely a function rather than a table, the check
SHALL probe it by calling it and comparing against its default result, and SHALL
NOT match its source text. A check that reads source goes green when the
implementation is refactored, which is when parity is most likely to have broken.

#### Scenario: A supported set is needed by a check

- **WHEN** a check must know which values a layer supports
- **THEN** it imports the table and enumerates it, rather than matching declaration syntax in the file

#### Scenario: A fallback answer is indistinguishable from a real one

- **WHEN** a lookup returns its default for an unsupported key
- **THEN** the supported set remains enumerable independently of the lookup, so "unsupported" is still detectable

### Requirement: One declared list per option vocabulary

A vocabulary offered to the operator SHALL be declared once, and every picker
that presents it SHALL read that declaration. Two lists that must agree and are
maintained separately SHALL NOT both exist.

The aspect list was stated twice — `aspectOptions` in the timeline and `ASPECTS`
in Project Settings — which is the same defect the parity check exists to catch,
one level up. It is also the shape `FORMAT_DIMS` and `DRAFT_DIMS` had, where the
two tables had already drifted apart by a row before anyone noticed.

#### Scenario: A second picker presents the same vocabulary

- **WHEN** a surface needs to offer the aspect list
- **THEN** it reads the declared table rather than restating the values

#### Scenario: The checked list and the rendered list are the same list

- **WHEN** the parity check reads the client's offered vocabulary
- **THEN** it reads the table the pickers render from, so passing the check means the offered options are the checked options

### Requirement: The check fails when it cannot find what it checks

The parity check SHALL assert that every vocabulary it reads is non-empty before
comparing them, and SHALL fail when one is missing or empty.

This check resolves values across a package boundary, so it has several ways to
silently read nothing: a moved export, a renamed entry point, a changed `exports`
map in `packages/video/package.json`. The reasoning is the one
`web-http-boundary` already records — a scan of nothing and a scan finding
nothing are indistinguishable in a passing result.

#### Scenario: An imported vocabulary disappears

- **WHEN** a table the check imports is removed, renamed, or no longer exported from its package entry
- **THEN** the check fails naming the missing vocabulary, rather than reporting parity across an empty set

### Requirement: Reveal options are checked against renderer support

Every reveal type, direction, black-slide direction, phase, texture, and color
build option offered by the web client SHALL be implemented by the renderer. The
repository SHALL enforce this with a parity check that imports the offered
client values and renderer-supported values rather than matching source text.

#### Scenario: Client offers unsupported reveal type

- **WHEN** a reveal type is added to the client controls without renderer
  support
- **THEN** the parity check fails and names the unsupported reveal type

#### Scenario: Renderer support is withdrawn

- **WHEN** renderer support for a reveal type, direction, or phase is removed
  while the client still offers it
- **THEN** the parity check fails

#### Scenario: Checked reveal lists are non-empty

- **WHEN** the parity check cannot import or enumerate reveal options
- **THEN** the check fails rather than reporting parity across an empty set

#### Scenario: Client offers unsupported reveal enhancement

- **WHEN** a reveal direction, black-slide direction, texture, or color build
  option is added to the client controls without renderer support
- **THEN** the parity check fails and names the unsupported option

### Requirement: Basic clip controls have executable behavioral parity

Every offered crop, flip, reverse, rate, pitch, keyframe, mask, blend, and color control SHALL have supported persistence and production-render behavior. Verification SHALL exercise actual source-time or rendered-output effects; enumerating fields alone SHALL NOT prove support. The editor SHALL block production export when required media or processing is unavailable and identify the affected clip. A simplified draft export SHALL disclose unsupported authored controls before running and SHALL NOT be presented as production-equivalent.

#### Scenario: Reverse field exists but is ignored

- **WHEN** reverse is offered and serialization retains it but output stays forward
- **THEN** the behavioral parity check fails

#### Scenario: Missing source blocks production output

- **WHEN** a used asset is missing or its required derivative has failed
- **THEN** export preflight names the affected clip and provides source recovery rather than producing a seemingly successful incomplete video

#### Scenario: Draft omits new compositing

- **WHEN** a simplified draft cannot render a clip's authored mask or blend mode
- **THEN** the editor identifies the omitted controls before draft export and labels its output as a simplified draft

#### Scenario: Neutral defaults preserve output

- **WHEN** new controls are absent or neutral
- **THEN** behavioral checks confirm the existing project's output remains unchanged

### Requirement: Caption output uses the authored cue contract

Production preview and video export SHALL render the same authored cue text, line breaks, timing, style scope and word emphasis. SRT export SHALL retain cue text and intervals without regrouping. Every offered caption presentation and motion option SHALL have behavioral render evidence. Simplified draft output SHALL use the same cues and explicitly disclose any omitted styling or animation before export. Enabled captions requiring source refresh SHALL block production export with affected-cue recovery rather than silently render stale words.

#### Scenario: Stable highlight across frames

- **WHEN** frames before and after active-word changes are rendered for one cue
- **THEN** text, line breaks and reserved word positions remain identical while only allowed emphasis changes

#### Scenario: Preview and export agree

- **WHEN** an edited and styled caption set is previewed and exported
- **THEN** both display the same cues at the same timeline times
- **AND** exported SRT has matching authored text and cue intervals

#### Scenario: Unresolved source change

- **WHEN** enabled captions require refresh after source replacement or an ambiguous mixed-source edit
- **THEN** production export names the affected captions and offers refresh or explicit caption disabling

#### Scenario: Draft has reduced effects

- **WHEN** simplified draft output cannot reproduce an offered caption effect
- **THEN** the editor discloses that omission before running and does not label draft output as production-equivalent
