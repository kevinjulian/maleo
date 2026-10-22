# image-to-video-generation Specification

## Purpose

Defines selectable image-to-video generation shared by editor and agent, including trusted source access, actual source metadata, and provider attribution.

## Requirements

### Requirement: Animation uses the selected video provider

Editor animation and agent animation SHALL resolve the same video capability selection. The existing capability-provider endpoint SHALL persist the selection in the existing global settings store. Existing Fal generation SHALL remain available through the shared path, including its configured model and credentials. Selecting sandbox SHALL NOT require Fal credentials.

#### Scenario: Owner selects sandbox

- **WHEN** an instance owner selects sandbox for video through the capability endpoint
- **THEN** subsequent editor and agent animations use sandbox

#### Scenario: Real generation remains available

- **WHEN** Fal is selected and configured
- **THEN** editor and agent animation use the configured Fal model through the same generation path

#### Scenario: Unauthorised selection

- **WHEN** a non-owner attempts to change global video provider selection
- **THEN** the API refuses the write and preserves the effective selection

### Requirement: Animation returns actual source metadata

Successful animation SHALL return a playable video URL, actual source duration, provider id, and model. Media admission, agent provenance, and playback SHALL use actual source metadata rather than infer it from requested scene length. Timeline placement SHALL remain distinct from source duration but SHALL NOT exceed the available source interval. Generated clips SHALL display the generated video's first frame as thumbnail rather than the input scene image, including older clips saved with that image. Thumbnail loading SHALL NOT create an undo entry. Numeric edits and timeline drags SHALL use measured source bounds; stored oversized generated clips SHALL be trimmed to those bounds on reload.

The published video SHALL be an H.264 MP4 with its index before the media data (faststart). Its duration SHALL match the provider output within 0.1 seconds. Successful animation SHALL also return a poster URL. The poster is a managed image of the first frame of the published video, in the same workspace. The editor SHALL display this poster as the thumbnail of the generated clip. A generated clip without a poster SHALL display a first frame that the browser decodes from the video. Clips made before this requirement have no poster. When the poster cannot be made, animation SHALL still succeed without a poster URL.

#### Scenario: Longer scene uses sandbox source

- **WHEN** a seven-second scene is animated with sandbox
- **THEN** source duration is recorded as four seconds and video clip placement is capped at four seconds
- **AND** the original scene span remains seven seconds

#### Scenario: Shorter scene uses sandbox source

- **WHEN** a two-second scene is animated with sandbox
- **THEN** source duration is recorded as four seconds and placement uses only the first two seconds

#### Scenario: Clip is edited or reloaded

- **WHEN** an operator extends a generated clip or reloads an oversized clip with measured source duration
- **THEN** its source interval cannot run beyond the measured source end
- **AND** its actual video-frame thumbnail remains visible after editor and agent round trips and reload

#### Scenario: Generated video is ready for playback

- **WHEN** sandbox or Fal generation succeeds
- **THEN** the published MP4 has its `moov` box before its `mdat` box and its video codec is H.264
- **AND** the result contains a poster URL for a managed image of the first frame

#### Scenario: Poster is the clip thumbnail

- **WHEN** an operator animates a scene and the result contains a poster URL
- **THEN** the timeline clip and the media browser tile show that poster image
- **AND** the thumbnail is visible in iOS Safari without playback

#### Scenario: Older generated clip has no poster

- **WHEN** a project contains a generated clip without a poster
- **THEN** the timeline shows the first frame that the browser decodes from the video

#### Scenario: Poster extraction fails

- **WHEN** the media worker cannot write a poster for a generated video
- **THEN** animation succeeds, the result has no poster URL, and the media worker logs the failure

### Requirement: Source and output obey workspace boundaries

Animation SHALL validate source access against the trusted caller workspace and project before generation, including sandbox generation. Sandbox SHALL NOT fetch arbitrary caller-supplied external URLs. Output SHALL be published as managed video under the authorised workspace, with existing authenticated media delivery and range support.

#### Scenario: Source belongs to another workspace

- **WHEN** an animation references managed image owned by an unauthorised workspace
- **THEN** it is refused before any video is generated

#### Scenario: Sandbox output is published

- **WHEN** sandbox generation succeeds
- **THEN** callers receive an authorised managed-video URL rather than a local filesystem path

### Requirement: Sandbox generation records zero spend

Sandbox video SHALL record provider attribution, completion or failure, and zero provider cost and charged credits. Real video generation SHALL retain its quota and billing enforcement without charging twice.

#### Scenario: Sandbox completes

- **WHEN** sandbox video generation completes
- **THEN** the usage record names sandbox and its model and records zero cost and charged credits

#### Scenario: Real generation is quota limited

- **WHEN** a workspace lacks quota for real video generation
- **THEN** generation is refused before the provider incurs spend
