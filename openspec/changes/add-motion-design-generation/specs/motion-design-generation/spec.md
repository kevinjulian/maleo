# Spec Delta

## Purpose

Generate editable motion design from the retained text and shape primitives:
the model decides content and intent, deterministic code decides timing and
motion feel, and the result is an ordinary composition clip.

## ADDED Requirements

### Requirement: Motion intent is authored from retained primitives

A motion intent SHALL describe one moment as layers and states. Each layer SHALL
use plain text or one of Rectangle, Circle, Triangle, Star and Cross, and SHALL
carry a role of `hero`, `secondary` or `ambient` and an object class of
`headline`, `body`, `label`, `container`, `accent` or `indicator`. States SHALL
be ordered by time within the moment's duration, and each state SHALL give the
values of the layers it changes. Each state SHALL move at least one layer and at
most one `hero` layer. When no hero moves in a state, the first non-ambient layer
it moves SHALL lead that state. An intent SHALL have at most twelve layers.
Layer and state names SHALL be normalised to lowercase words joined by dashes
before they are matched.

Text layer content SHALL come from the beat's on-screen text or the user's
request. Authoring SHALL NOT invent statistics, product names or claims that are
absent from that source. An intent that fails validation SHALL be rejected with
the reason, and no composition SHALL be placed from it.

#### Scenario: A valid intent is accepted

- **WHEN** a model returns an intent with a Rectangle container, a headline text
  layer as `hero`, and two states inside a 3-second moment
- **THEN** the intent validates and is passed to compilation

#### Scenario: A retired or unknown primitive is refused

- **WHEN** an intent names a layer primitive outside the retained set
- **THEN** validation fails naming the layer and the primitive
- **AND** nothing is placed

#### Scenario: Two heroes in one state change

- **WHEN** an intent marks two layers as `hero` for the same state change
- **THEN** validation fails naming the state

### Requirement: Compilation is deterministic and produces ordinary timeline clips

Compiling a valid intent SHALL produce one ordinary timeline clip per layer:
plain text or a retained shape, with its own start, duration and lane, and its
motion as keyframe tracks in clip-local seconds on properties the timeline
already animates (position, size, scale, rotation, opacity, and fill on text).
Each clip's keys SHALL appear on the timeline and SHALL be editable like any
other clip's keys. The same intent and moment duration SHALL compile to
identical clips. Compilation SHALL NOT read the clock or unseeded randomness.

#### Scenario: Repeat compilation

- **WHEN** the same intent is compiled twice
- **THEN** the two sets of clips are equal value for value

#### Scenario: Each layer is its own editable clip

- **WHEN** an intent with a container, a headline and an accent is compiled and
  placed
- **THEN** the timeline holds three clips on three lanes
- **AND** each clip's keyframes are shown and can be moved on the timeline

### Requirement: Compiled motion follows one set of motion tokens

Compilation SHALL apply these rules to every state change:

- The layer that leads a state SHALL start its move at the state time.
- Each further moving layer SHALL start its move between 100 ms and 200 ms
  after the layer that starts before it, so the movers of a state cascade.
- When a secondary layer enters or exits with an offset, that offset SHALL be
  between 50 % and 70 % of the hero's offset in the same state. A move to an
  explicit target value SHALL reach that value.
- An `ambient` layer SHALL move continuously with an amplitude no larger than
  5 % of the frame dimension and SHALL NOT stop during the moment.
- Position and size moves SHALL follow a spring response for the layer's object
  class, sampled into keys. Opacity and colour SHALL NOT overshoot.
- An exit SHALL be no longer than the entrance of the same layer.
- When a `container` layer and a text layer change in the same state, the
  container SHALL start at the state time and the text SHALL begin after the
  container has completed at least half of its move. This rule takes precedence
  over the start times above for that text layer.
- An `indicator` layer that changes position and width SHALL move its leading
  edge before its trailing edge on the horizontal axis. Its top and bottom edges
  SHALL move together.

#### Scenario: Secondary follows the hero

- **WHEN** a state change moves a hero headline and a secondary label
- **THEN** the label's first moving key is 100 ms to 200 ms after the
  headline's first moving key

#### Scenario: Opacity does not overshoot

- **WHEN** a layer fades in on a spring-driven class
- **THEN** no sampled opacity value lies outside the range between its start and
  end values

#### Scenario: Indicator stretches

- **WHEN** an indicator moves from left to right and changes width
- **THEN** during the move its width is larger than at both ends of the move

### Requirement: Motion lint reports findings without blocking placement

The lint SHALL evaluate a compiled composition and report findings, each with a
code, the layer and the time. It SHALL report: more than one layer making a
large move at the same time, a text layer that moves while it holds fewer
seconds than its reading time, all layers entering on the same frame, an exit
longer than its entrance, and a layer outside the frame at rest. Findings SHALL
be recorded with the run. A finding SHALL NOT prevent placement.

#### Scenario: Text moves during reading

- **WHEN** a six-word text layer holds still for 0.8 s before it moves again
- **THEN** the lint reports a reading-time finding for that layer and time

#### Scenario: Clean motion

- **WHEN** a compiled composition follows every token
- **THEN** the lint reports no findings

### Requirement: Story generation places motion for on-screen text beats

When story generation places on-screen text for a beat whose presentation is
`headline`, `explainer` or `transition`, it SHALL author, compile and place one
clip per motion layer for that beat in place of the plain-text overlay, inside
the same span. When authoring, validation or compilation fails, generation SHALL
place the plain-text overlay it places today and record the reason. A failure
SHALL NOT fail the run. A `narrative` beat SHALL receive no motion.

Generated motion SHALL use the run's captured visual style for colour and type.
The clips of one beat SHALL carry ids from a reserved range derived from that
beat's text and start, so they are recognised as that beat's motion. Saving the
project or running a later edit SHALL keep them unchanged. Regenerating story
assets SHALL keep the clips already placed for a beat whose text and start are
unchanged, including any edits made to them, and SHALL make no new model call
for that beat.

#### Scenario: Headline beat becomes motion

- **WHEN** a generation run reaches a headline beat with on-screen text
- **THEN** the timeline holds one clip per motion layer inside that beat's text
  span
- **AND** no plain-text overlay for the same text

#### Scenario: Authoring fails

- **WHEN** the motion intent for an explainer beat fails validation twice
- **THEN** the beat receives the plain-text overlay
- **AND** the run completes with the failure recorded in its trace

#### Scenario: Placed motion survives a save

- **WHEN** generated or chat-placed motion clips are on the timeline and the
  project is saved by a later edit run
- **THEN** those clips are unchanged

#### Scenario: Edited motion survives regeneration

- **WHEN** a user moves a keyframe of a generated motion clip and story assets
  are regenerated with that beat's text and start unchanged
- **THEN** the clip keeps the moved keyframe and no motion model call is made

### Requirement: Chat places motion design through editor commands

The agent SHALL expose an `add_motion_design` tool that takes a description, a
start time, a duration and optional text. It SHALL author, compile and place one
clip per motion layer through one batch of editor commands, so the placement is
one undo step. The tool SHALL be available to the editing agent and over MCP
like the other edit tools. A failure SHALL return a tool error naming the
problem and SHALL NOT change the document.

#### Scenario: Chat adds motion

- **WHEN** a user asks the agent to add an animated title "Ship faster" at 4 s
  for 3 s
- **THEN** the timeline holds the motion's clips between 4 s and 7 s, one of
  them a text clip reading "Ship faster"
- **AND** undo removes all of them in one step

#### Scenario: Chat request fails

- **WHEN** the authored intent fails validation
- **THEN** the tool returns an error naming the failed rule and the document is
  unchanged

### Requirement: A placed motion clip can be expanded into editable clips

The editor SHALL offer an action on a selected `motion-comp` clip that replaces
it with one ordinary clip per layer, each on its own lane with its keyframes in
clip-local seconds, at the times and positions the composition drew them. The
replacement SHALL be one undo step. The action SHALL NOT change the saved motion
definition the clip came from.

#### Scenario: Expand a placed motion

- **WHEN** a user expands a placed two-layer motion clip
- **THEN** the timeline holds two clips with their own keyframe lanes in its
  place
- **AND** one undo restores the single motion clip
