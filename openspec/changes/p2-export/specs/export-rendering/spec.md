# Spec Delta

## Purpose

Export a project video through the Rust renderer, in the browser and in the server render worker, and move export authority from Remotion to Rust only on recorded evidence with a rollback.

## ADDED Requirements

### Requirement: Export eligibility comes from whole-project coverage

A project SHALL be eligible for Rust export only when the renderer coverage report is empty for every output frame of its render storyboard. Eligibility SHALL be computed from the same render storyboard that the export renders. A still frame or a sample of frames SHALL NOT establish eligibility. The editor and the render worker SHALL compute the same answer for the same storyboard.

#### Scenario: Every frame is covered

- **WHEN** the coverage report is empty for every frame of a project's render storyboard
- **THEN** the project is eligible for Rust export

#### Scenario: One frame is not covered

- **WHEN** one frame of the storyboard has a coverage problem
- **THEN** the project is not eligible for Rust export
- **AND** the reason names the unsupported element and the first affected time

### Requirement: Browser export renders through the Rust renderer

The editor SHALL export an eligible project in the browser through the Rust renderer. The output SHALL be an MP4 file with H.264 video and AAC audio, at the project's output size and frame rate. Each output frame SHALL be the frame that the renderer draws for that frame index after every media item for that frame is supplied. The audio track SHALL be the Rust mix of the project's voiceover, music, clip audio and sound effects, with authored timing, volume, fades, trims and mute rules. The output SHALL contain no editor overlay. The export SHALL NOT change the project document.

#### Scenario: An eligible project exports in the browser

- **WHEN** an operator exports an eligible project in a browser with a WebGPU adapter
- **THEN** the browser produces an MP4 file without a server render job
- **AND** a decoded copy of the file has the expected frame count, duration, size and frame rate

#### Scenario: Media is slow to load

- **WHEN** a video frame needed for an output frame is not yet decoded
- **THEN** the export waits for that frame and does not encode a placeholder or an earlier frame

#### Scenario: Decoded output matches the renderer

- **WHEN** representative projects are exported in the browser and decoded
- **THEN** sampled output frames match the renderer's own frames for the same indexes within the recorded encoding tolerance
- **AND** audio events in the decoded file start within one frame of their authored times

### Requirement: Browser export is unavailable for ineligible projects and browsers

The editor SHALL NOT start a browser export for a project that is not eligible, or in a browser without a WebGPU adapter or without the required WebCodecs encoders. The editor SHALL give the reason and SHALL offer server export. No fallback renderer SHALL start.

#### Scenario: Browser has no WebGPU

- **WHEN** an operator opens the export menu in a browser without a WebGPU adapter
- **THEN** browser export is unavailable with a reason that names the missing WebGPU support
- **AND** server export remains available

#### Scenario: Project has an unsupported element

- **WHEN** an operator opens the export menu for an ineligible project
- **THEN** browser export is unavailable with the coverage reason
- **AND** server export remains available

### Requirement: Browser export reports progress and can be cancelled

Browser export SHALL show its phase and progress as a fraction of output frames. The operator SHALL be able to cancel it. Cancellation SHALL stop decoding and encoding, release the encoders and decoders it opened, and produce no file. A failure SHALL show a reason and SHALL leave the editor usable. Editing during export SHALL NOT change the output, because the export renders the storyboard captured when it started.

#### Scenario: Operator cancels

- **WHEN** the operator cancels a running browser export
- **THEN** no file is saved and the export resources are released

#### Scenario: Operator edits during export

- **WHEN** the operator changes a clip while a browser export runs
- **THEN** the output contains the storyboard captured at the start
- **AND** the edit is kept in the document

#### Scenario: GPU device is lost during export

- **WHEN** the GPU device is lost while a browser export runs
- **THEN** the export fails with a reason or continues after recovery, and it never writes a frame drawn on a lost device

### Requirement: The render worker renders through the Rust host

The render worker SHALL render a job through the native Rust render host when the job's renderer is `rust`. The host SHALL render the prepared render storyboard on a software GPU device and SHALL encode an MP4 file with H.264 video and AAC audio. The host SHALL use only codec libraries that are licensed for distribution in the render-worker image. The job SHALL use the existing queue, phases, progress, cancellation, retry, output storage and poster rules. The job record SHALL name the renderer that produced its output.

#### Scenario: A Rust job completes

- **WHEN** the worker runs a job whose renderer is `rust`
- **THEN** the job moves through its phases with rising progress
- **AND** the completed output is stored and served as other completed exports are
- **AND** the job record names the `rust` renderer

#### Scenario: A Rust job is cancelled

- **WHEN** an operator cancels a running Rust job
- **THEN** the host process stops within five seconds
- **AND** the job is `cancelled` and no partial output is stored

#### Scenario: The host fails

- **WHEN** the host exits with an error, or decoding or encoding fails
- **THEN** the job fails with a reason that names the failed stage
- **AND** no partial output is stored and the worker continues with the next job

#### Scenario: A Rust job gets an ineligible storyboard

- **WHEN** the host receives a storyboard with a non-empty coverage report
- **THEN** the host refuses it before it encodes a frame and names the coverage problem

### Requirement: Export authority follows one deployment setting

The deployment SHALL select the authoritative export renderer with one setting whose values are `remotion` and `rust`. The default SHALL be `remotion`. With `rust`, an eligible job SHALL render through the Rust host and an ineligible job SHALL render through Remotion. With `remotion`, every job SHALL render through Remotion. Changing the setting SHALL affect only jobs that start after the change. Returning the setting to `remotion` SHALL be the rollback and SHALL need no data migration.

#### Scenario: Authority is Rust and the project is eligible

- **WHEN** the setting is `rust` and an eligible job starts
- **THEN** the Rust host renders the job

#### Scenario: Authority is Rust and the project is not eligible

- **WHEN** the setting is `rust` and an ineligible job starts
- **THEN** Remotion renders the job and the job record says why

#### Scenario: Rollback

- **WHEN** an operator sets the authority back to `remotion`
- **THEN** every job that starts after the change renders through Remotion
- **AND** completed Rust outputs stay available
