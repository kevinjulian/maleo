# Spec Delta

## ADDED Requirements

### Requirement: Basic clip controls have behavioral parity in every export

Every offered crop, flip, reverse, rate, pitch, keyframe, mask, blend, and color control SHALL have supported persistence and production-render behavior. Verification SHALL exercise actual source-time or rendered-output effects; enumerating fields alone SHALL NOT prove support. The editor SHALL block production export when required media or processing is unavailable and identify the affected clip. Browser export SHALL be production export: it SHALL render every authored control that server export renders, and SHALL NOT run for a project with a control that the Rust renderer does not cover.

#### Scenario: Reverse field exists but is ignored

- **WHEN** reverse is offered and serialization retains it but output stays forward
- **THEN** the behavioral parity check fails

#### Scenario: Missing source blocks production output

- **WHEN** a used asset is missing or its required derivative has failed
- **THEN** export preflight names the affected clip and provides source recovery rather than producing a seemingly successful incomplete video

#### Scenario: Browser export meets an uncovered control

- **WHEN** a project has a clip with an authored control that the Rust renderer does not cover
- **THEN** browser export is unavailable with a reason that names the control and the clip
- **AND** server export remains available

#### Scenario: Neutral defaults preserve output

- **WHEN** new controls are absent or neutral
- **THEN** behavioral checks confirm the existing project's output remains unchanged

### Requirement: Caption output follows the authored cue contract in every export

Production preview and video export SHALL render the same authored cue text, line breaks, timing, style scope and word emphasis. This rule SHALL apply to browser export and to server export. SRT export SHALL retain cue text and intervals without regrouping. Every offered caption presentation and motion option SHALL have behavioral render evidence. Enabled captions requiring source refresh SHALL block production export with affected-cue recovery rather than silently render stale words.

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

#### Scenario: Browser and server captions agree

- **WHEN** one eligible project with styled, animated captions is exported in the browser and on the server through Rust
- **THEN** decoded caption frames from both files match within the recorded encoding tolerance

## REMOVED Requirements

### Requirement: Basic clip controls have executable behavioral parity

**Reason**: The simplified draft export leaves (p2-export E3). Its disclosure rules and scenarios no longer apply.

**Migration**: Replaced by "Basic clip controls have behavioral parity in every export". Browser export is production export and runs only for covered projects.

### Requirement: Caption output uses the authored cue contract

**Reason**: The simplified draft export leaves (p2-export E3). Its disclosure rules and scenarios no longer apply.

**Migration**: Replaced by "Caption output follows the authored cue contract in every export". Browser export is production export and runs only for covered projects.
