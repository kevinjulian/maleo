# Spec Delta

## ADDED Requirements

### Requirement: Production jobs run on both renderers

While Remotion is the authoritative export renderer, the render worker SHALL run a shadow Rust render for each completed production job whose storyboard is eligible for Rust export. The shadow render SHALL use the same prepared storyboard and the same media as the authoritative job. A shadow render SHALL start only when no authoritative job is waiting. A shadow render SHALL NOT change the authoritative job's status, output, history or charges, and its output SHALL NOT be shown to operators as an export. An ineligible job SHALL record why it had no shadow render.

#### Scenario: An eligible job completes

- **WHEN** an authoritative Remotion job completes for an eligible storyboard
- **THEN** the worker queues a shadow Rust render of the same prepared storyboard
- **AND** the operator sees only the Remotion output

#### Scenario: Authoritative work is waiting

- **WHEN** an authoritative job is queued
- **THEN** no shadow render starts until the authoritative queue is empty

#### Scenario: A shadow render fails

- **WHEN** a shadow render fails
- **THEN** the comparison records the failure as a divergence
- **AND** the authoritative job is unchanged

### Requirement: Output comparison uses recorded criteria

The worker SHALL compare each shadow output with its authoritative output and SHALL store the result. The comparison SHALL use criteria from a versioned configuration in the repository. The criteria SHALL cover:

- equal output size, frame rate and frame count, and durations within one frame;
- full-frame SSIM at sampled frames that include each scene boundary, each transition midpoint and at least one frame per second;
- audio loudness per 100 ms window, and the start time of each audio clip.

A comparison SHALL pass only when every criterion passes. A failed comparison SHALL keep the sampled frames, the difference images and the scores for review. A change to a threshold SHALL record a reason in the configuration.

#### Scenario: Outputs agree

- **WHEN** both outputs meet every recorded criterion
- **THEN** the comparison passes and records its scores and configuration version

#### Scenario: A sampled frame differs

- **WHEN** a sampled frame scores below the SSIM threshold
- **THEN** the comparison fails and names the frame, the time and the score
- **AND** the frames and a difference image are kept for review

#### Scenario: Audio drifts

- **WHEN** an audio clip starts more than one frame later in the shadow output
- **THEN** the comparison fails and names the clip and the offset

### Requirement: Divergence is explained before the window closes

Each failed comparison SHALL be unexplained until an operator records an explanation. An explanation SHALL name the cause and one resolution: a Rust fix, an accepted Remotion defect, or a recorded tolerance change. An unexplained divergence SHALL block the authority switch. A Rust fix SHALL restart the observation window.

#### Scenario: Operator explains a divergence

- **WHEN** an operator records the cause and resolution of a failed comparison
- **THEN** the divergence is explained and the comparison report shows the explanation

#### Scenario: A Rust fix lands

- **WHEN** a divergence is resolved by a change to the Rust renderer or host
- **THEN** the observation window restarts from the deployment of that change

### Requirement: The authority switch needs a closed observation window

The authority switch to Rust SHALL be allowed only when the comparison report shows an observation window of at least 14 days and at least 50 compared production jobs, with zero unexplained divergences in that window. The report SHALL also list the share of production jobs that were not eligible, with their coverage reasons. The switch decision and the report used for it SHALL be recorded.

#### Scenario: Window is complete

- **WHEN** the report covers 14 days and 50 compared jobs with no unexplained divergence
- **THEN** the report states that the switch is allowed

#### Scenario: Too few jobs

- **WHEN** 14 days pass with fewer than 50 compared jobs
- **THEN** the report states that the window is open and gives the job count
