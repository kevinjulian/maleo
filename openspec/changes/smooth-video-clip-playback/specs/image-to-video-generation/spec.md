# Spec Delta

## MODIFIED Requirements

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
