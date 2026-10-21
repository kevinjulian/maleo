# script-view Specification

## Purpose

The AV script surface: the project as a table of scenes — narration beside its visual prompt, its frame and its timing — grouped into chapters. One of the content editor's three views, reading and writing the same `Scene` records the timeline and the studio do, so the three cannot disagree without a sync step between them.

## Requirements

### Requirement: The script view projects scenes, it does not store them

The script view SHALL read and write the same `Scene` records the timeline
edits. It SHALL NOT hold a second copy of any script text. There SHALL be no
action that copies text from the script to the timeline or from the timeline to
the script, in either direction.

#### Scenario: Editing narration in the script is visible on the timeline

- **WHEN** the operator edits a scene's narration in the script view
- **THEN** the same scene's `vo` is updated in the store
- **AND** the timeline surface shows the edited text without any sync action

#### Scenario: Editing narration on the timeline is visible in the script

- **WHEN** the operator edits a scene's narration from the timeline inspector
- **THEN** the script view shows the edited text without any sync action

#### Scenario: No sync affordance is offered

- **WHEN** the script view is open with unsaved differences of any kind
- **THEN** no control labelled as syncing the script to the timeline, or the
  timeline to the script, is presented

### Requirement: The script is one of the editor's views

The content editor SHALL offer Storyboard, Script, Timeline, and Studio as distinct views. Storyboard SHALL edit pre-production story-plan sections and semantic beats. Script SHALL continue reading and writing live generated scenes directly and SHALL NOT store second copy of scene narration.

Storyboard SHALL have path `/content/<id>/storyboard`; Script SHALL retain `/content/<id>/script`. Each path SHALL seed view on mount; thereafter view SHALL follow operator tab choice.

Studio sub-views SHALL remain unchanged, and storyboard PNG export SHALL remain reachable from Studio without being confused with Storyboard authoring view.

#### Scenario: Editor offers four views

- **WHEN** video editor opens
- **THEN** it offers Storyboard, Script, Timeline, and Studio

#### Scenario: Storyboard path

- **WHEN** operator opens `/content/<id>/storyboard`
- **THEN** Storyboard authoring view is selected

#### Scenario: Script path

- **WHEN** operator opens `/content/<id>/script`
- **THEN** generated-scene Script view is selected

#### Scenario: Ownership remains separate

- **WHEN** both Storyboard and Script show narration
- **THEN** Storyboard edits plan draft
- **AND** Script edits generated scene state without copy/sync action

#### Scenario: Studio remains unchanged

- **WHEN** Studio opens
- **THEN** existing sub-views and storyboard PNG export remain reachable

### Requirement: The script renders as an AV script table

The script view SHALL render one table row per scene, with the scene's label, an
AUDIO cell enumerating the scene's audio, a VISUAL cell (`vis`, `shot`, `move`),
an IMAGE cell showing the generated frame, and a DURATION cell showing the
scene's duration alone. AUDIO SHALL precede VISUAL.

The DURATION cell SHALL show the scene's duration formatted as `mm:ss`. It SHALL
NOT show the scene's start offset on the timeline, and SHALL NOT show whether the
duration is pinned or auto.

The AUDIO cell SHALL list every audio element on the scene, one labelled line per
element, ordered music first, then sound effects, then voiceover, then any
generated speech. A music line SHALL be labelled `Music`, a sound effect line
`SFX`, a voiceover line `VO` followed by its speaker's name, and a generated
speech line `Speech` followed by its origin and measured length. A scene SHALL
show no line for a kind of audio it does not carry.

The cell SHALL name the timeline audio crossing the scene, not merely count it.
Audio the timeline holds SHALL be stated on the row it BEGINS on and SHALL NOT be
repeated on the later rows it runs through; a line whose audio continues past its
row SHALL be marked as continuing. Timeline audio SHALL be read-only, as the
script does not own it.

Positions SHALL compare with a tolerance, so that audio cued on the boundary
between two scenes is reported on one of them rather than on both.

The voiceover text SHALL remain editable in place. Music and sound effect lines
SHALL be read-only, because they project content the script does not own.

Every row SHALL carry exactly one editable voiceover line, including a row whose
scene has no narration written yet: the script is the surface narration is
written on, and a row carrying only a music cue would otherwise offer nowhere to
type. Where a scene carries more than one voiceover, the first SHALL be the
editable one and the rest SHALL render read-only, so that two fields never write
the same narration.

#### Scenario: A scene carrying music, an effect and narration

- **WHEN** a scene carries a music cue, a sound effect and narration
- **THEN** its AUDIO cell shows three lines, in the order music, effect,
  voiceover
- **AND** each is labelled with its kind

#### Scenario: A scene carrying narration alone

- **WHEN** a scene carries narration and no music or sound effect
- **THEN** its AUDIO cell shows one voiceover line
- **AND** no empty music or effect line is rendered in their place

#### Scenario: A scene carrying a cue but no narration yet

- **WHEN** a scene carries a music cue and no narration
- **THEN** its AUDIO cell shows the music line and an empty editable voiceover
  line
- **AND** the operator can write narration into that row

#### Scenario: A scene carrying more than one voiceover

- **WHEN** a scene carries two voiceovers
- **THEN** both are shown
- **AND** only the first offers an edit

#### Scenario: A music bed running the length of the project

- **WHEN** a music bed spans every scene in the project
- **THEN** only the first row it covers names it
- **AND** that line is marked as continuing past its row
- **AND** no later row repeats it

#### Scenario: Generated speech on the timeline

- **WHEN** a scene's narration has been rendered to speech on the timeline
- **THEN** the row shows a `Speech` line carrying that audio's origin and
  measured length
- **AND** the line is read-only

#### Scenario: A cue landing on a scene boundary

- **WHEN** a sound effect is cued at exactly the moment one scene ends and the
  next begins
- **THEN** it is reported on the scene it starts, and not on the one it ends

#### Scenario: The voiceover line is editable and the cues are not

- **WHEN** the operator edits the voiceover text of a row
- **THEN** that scene's narration is updated
- **AND** the music and sound effect lines on the same row offer no edit

#### Scenario: The duration cell shows one value

- **WHEN** a scene five seconds long is rendered
- **THEN** its DURATION cell shows `00:05`
- **AND** shows neither the scene's start offset nor its duration mode

#### Scenario: A scene with generated assets

- **WHEN** a scene has a generated frame and generated speech
- **THEN** its IMAGE cell shows the frame and its AUDIO cell shows a speech
  indicator
- **AND** both are read-only apart from explicit per-row generation actions

#### Scenario: A scene with no generated assets

- **WHEN** a scene has neither a frame nor speech
- **THEN** its row still renders its AUDIO and VISUAL cells
- **AND** the IMAGE cell indicates that nothing has been generated

#### Scenario: Narrow viewport

- **WHEN** the viewport is too narrow for side-by-side cells
- **THEN** each row's cells stack vertically without loss of content

### Requirement: Columns stay aligned across the whole document

Every scene row on the page SHALL share one set of column widths, regardless of
which chapter it belongs to. The column header SHALL remain visible while
scrolling and SHALL NOT be repeated for each chapter.

The AUDIO, VISUAL and IMAGE columns SHALL be of equal width.

A frame SHALL keep its own aspect ratio, and its ORIENTATION SHALL decide how
much of the IMAGE column it takes: a portrait frame SHALL take half the column
and a landscape or square frame SHALL take all of it, with height following in
each case. A portrait frame at full column width would stand nearly twice as
tall as the prose beside it, so the width is what varies, never the ratio.

A field carrying a generated visual prompt SHALL stop growing at a maximum
height and scroll beyond it, so that one long prompt does not set the height of
the row it sits in. Nothing SHALL be truncated or hidden by that cap.

#### Scenario: Rows in different chapters

- **WHEN** the script contains scenes in more than one chapter
- **THEN** the column boundaries of a row in one chapter align with those of a
  row in any other chapter

#### Scenario: The three content columns are equal

- **WHEN** the script renders at the write density
- **THEN** the AUDIO, VISUAL and IMAGE columns occupy equal width

#### Scenario: A portrait frame

- **WHEN** a scene's frame is taller than it is wide
- **THEN** it renders at half the IMAGE column's width
- **AND** its height follows its own aspect ratio

#### Scenario: A landscape or square frame

- **WHEN** a scene's frame is wider than it is tall, or square
- **THEN** it renders at the full width of the IMAGE column
- **AND** its height follows its own aspect ratio

#### Scenario: A long visual prompt

- **WHEN** a scene's visual prompt is longer than the field's maximum height
- **THEN** the field stops growing and scrolls
- **AND** the row is no taller than a row whose prompt is short
- **AND** none of the prompt is lost

#### Scenario: Scrolling past a chapter boundary

- **WHEN** the operator scrolls from one chapter into the next
- **THEN** the column header remains visible
- **AND** no second column header is rendered inside the document

### Requirement: A scene's label is derived from its position

A scene SHALL be labelled with its chapter's number and its position within that
chapter, as `chapter.scene`. The label SHALL be derived on render and SHALL NOT
be persisted. No operator action SHALL renumber scenes, because labels are
always derived.

#### Scenario: Labels reflect chapter membership

- **WHEN** the first scene of the second chapter is rendered
- **THEN** its label is `2.1`

#### Scenario: Moving a scene between chapters

- **WHEN** a scene is moved from the first chapter to the second
- **THEN** its label changes to reflect its new chapter and position
- **AND** its identity is unchanged

#### Scenario: Inserting a scene

- **WHEN** a scene is inserted before an existing scene in a chapter
- **THEN** the labels of the following scenes in that chapter shift accordingly
- **AND** no identity changes

### Requirement: Chapters group scenes, with a brief and a computed footer

Scenes SHALL be grouped into chapters. A chapter SHALL render a header carrying
its number, title and an authored brief, and a footer carrying its running time,
its narration word count, and the cumulative running time and word count to the
end of that chapter. The footer SHALL be computed on render and SHALL NOT be
authored or persisted.

Each footer statistic SHALL render its label above its value, rather than inline
with it.

#### Scenario: A chapter header

- **WHEN** a chapter is rendered
- **THEN** its number, title and brief are shown above its scenes

#### Scenario: A chapter with no brief

- **WHEN** a chapter has no brief
- **THEN** its header shows its number and title without a brief, and without
  placeholder text in its place

#### Scenario: A chapter footer

- **WHEN** a chapter's scenes total twenty seconds and twelve narration words,
  and it is the first chapter
- **THEN** its footer reports a segment running time of twenty seconds, a
  segment word count of twelve, and the same values as the cumulative totals

#### Scenario: A footer statistic is a stacked pair

- **WHEN** a chapter footer renders its segment running time
- **THEN** the label sits above the value rather than beside it

#### Scenario: Cumulative totals across chapters

- **WHEN** a second chapter follows the first
- **THEN** its footer's totals include the first chapter's running time and
  words

#### Scenario: The footer is not editable

- **WHEN** the operator attempts to edit a chapter footer value
- **THEN** no scene or chapter is modified

#### Scenario: A project with no chapters

- **WHEN** a project has no chapters defined
- **THEN** its scenes render within a single implicit chapter

### Requirement: A speaker cue is shown only when a speaker is chosen

Every voiceover line SHALL name the speaker it belongs to. Where a scene has no
chosen speaker, that name SHALL be the project's default voice. Where a scene has
a chosen speaker, the voiceover line SHALL name that speaker.

The column header SHALL NOT name the project's default voice. Every voiceover
line already names its own speaker, so a name in the header states the same fact
twice and states it wrongly for any row that chose otherwise.

#### Scenario: A scene using the default voice

- **WHEN** a scene has no chosen speaker
- **THEN** its voiceover line names the project's default voice
- **AND** the column header names no voice

#### Scenario: A scene with a chosen speaker

- **WHEN** a scene has a chosen speaker
- **THEN** its voiceover line names that speaker

### Requirement: Chapters follow section provenance where it exists

A project whose scenes carry section provenance SHALL derive its chapters from
that provenance, not from story beats. A scene marked as a section introduction
SHALL render as a row of its own, marked as its chapter's opening scene, and
SHALL NOT be folded into the chapter header.

#### Scenario: Scenes carrying section provenance

- **WHEN** a project's scenes carry section identifiers
- **THEN** its chapters group the scenes by those identifiers
- **AND** story beats are not used to group them

#### Scenario: A section introduction scene

- **WHEN** a scene is marked as a section introduction
- **THEN** it renders as its own row, marked as its chapter's opening scene
- **AND** its duration is counted in its chapter's running time

### Requirement: Chapters fall back to runs of story beats

A project whose scenes carry no section provenance SHALL derive chapters from
runs of consecutive scenes sharing a story beat. A beat that recurs after a
different beat SHALL begin a new chapter rather than joining the earlier one. A
scene with no beat SHALL join the run before it, and a project whose scenes
carry no beats SHALL derive a single untitled chapter.

#### Scenario: Consecutive scenes sharing a beat

- **WHEN** a project's scenes carry the beats hook, hook, turn, turn, turn,
  payoff in that order
- **THEN** three chapters are derived, of two, three and one scene

#### Scenario: A beat that recurs

- **WHEN** a project's scenes carry the beats hook, turn, hook in that order
- **THEN** three chapters are derived
- **AND** the first and third scenes are not placed in the same chapter

#### Scenario: A scene with no beat

- **WHEN** a scene carrying no beat follows a scene carrying one
- **THEN** it joins that scene's chapter

#### Scenario: A project with no beats

- **WHEN** no scene in a project carries a beat
- **THEN** a single untitled chapter is derived containing every scene

### Requirement: The table renders at three densities

The script SHALL offer three densities over the same rows: outline (number,
name and duration), read (narration alone), and write (every cell). The route MAY
seed the density, defaulting to write, so a link can open an outline; thereafter
it SHALL follow the operator's choice and SHALL NOT be persisted per operator or
per project. Changing density SHALL NOT change any scene.

#### Scenario: A link can open an outline

- **WHEN** an operator opens a script path whose query string names the outline
  density
- **THEN** the script renders at the outline density

#### Scenario: No density in the path

- **WHEN** an operator opens a script path with no density in its query string
- **THEN** the script renders at the write density

#### Scenario: The operator's choice wins afterwards

- **WHEN** the operator changes the density
- **THEN** the script renders at the chosen density

#### Scenario: Outline

- **WHEN** the operator selects the outline density
- **THEN** each row shows only its number, name and duration
- **AND** section rows remain visible

#### Scenario: Read

- **WHEN** the operator selects the read density
- **THEN** each row shows its narration and no other cell

#### Scenario: Density does not mutate

- **WHEN** the operator changes density
- **THEN** no scene field is modified

### Requirement: Scenes split and merge while writing

The operator SHALL be able to split a scene at the cursor inside its narration,
and to merge a scene into the preceding one from the start of its narration. A
split SHALL give the new scene a fresh id, inherit the shot, movement and
speaker of the scene it came from, and leave both scenes in auto duration.

#### Scenario: Splitting a scene

- **WHEN** the operator splits a scene at a point inside its narration
- **THEN** two scenes exist, carrying the narration before and after that point
- **AND** the new scene has a fresh id and inherits shot, movement and speaker
- **AND** both scenes are in auto duration

#### Scenario: Merging a scene

- **WHEN** the operator merges a scene into the one before it
- **THEN** one scene remains, carrying both narrations
- **AND** the operator is warned if the merged-away scene had generated assets

### Requirement: The current scene is marked, and survives leaving the script

The script SHALL mark the row the operator is working in. Opening the editor
from the script SHALL carry that scene, so the operator arrives where they left
off rather than at the top of the project.

There is no shared playhead: the script is its own route and the timeline is not
on screen, so "seek the playhead" has nothing to seek. Continuity across the two
surfaces is what carries instead.

#### Scenario: The row being edited is marked

- **WHEN** the operator puts the cursor in a row
- **THEN** that row is marked as the current one

#### Scenario: Leaving for the editor keeps the place

- **WHEN** the operator opens the editor from a script row
- **THEN** the editor opens on that scene

### Requirement: The script discloses timeline content it does not own

Overlays, music, transitions, effects, and infographics SHALL NOT produce script
rows. Each script row SHALL show a read-only summary of such content overlapping
that scene.

Audio SHALL NOT be counted in that summary. The AUDIO cell already names every
audio clip crossing the row, so a count beside the visual prompt states the same
fact twice and states it less well.

#### Scenario: A scene overlapped by overlays and music

- **WHEN** a scene is overlapped by two text overlays and a music bed
- **THEN** its row's summary names the overlays
- **AND** the music is named in the AUDIO cell rather than counted in the summary
- **AND** that content is not editable from the script view

### Requirement: Deleting a script row confirms its consequences

Deleting a script row SHALL delete the underlying scene. When content the script
does not own overlaps that scene, the operator SHALL be told before the delete
proceeds.

#### Scenario: Deleting a row with overlapping overlays

- **WHEN** the operator deletes a script row that overlapping overlays are
  anchored across
- **THEN** the operator is shown what else is affected and must confirm
- **AND** nothing is removed until the confirmation is given

#### Scenario: Deleting a row with nothing overlapping

- **WHEN** the operator deletes a script row with no overlapping content
- **THEN** the scene and its own clips are removed

### Requirement: The script offers to regroup chapters from provenance

The script view SHALL offer an action that re-derives the project's chapters from
its scenes' section provenance, for a project whose chapters no longer describe
its scenes.

The action SHALL state what it will replace before it runs, naming the authored
chapter titles and briefs that will be lost, and SHALL change nothing until the
operator confirms. It SHALL NOT run on its own, on load or otherwise.

The action SHALL be absent when there is nothing to regroup from — a project
whose scenes carry neither section provenance nor story beats would derive the
single chapter it already has, so offering the action would promise a change it
cannot make.

#### Scenario: A project whose chapters no longer describe it

- **WHEN** a project's scenes carry four sections but the script shows one
  chapter
- **AND** the operator regroups and confirms
- **THEN** the script shows four chapters, each named after its section
- **AND** each scene appears under the chapter for its section

#### Scenario: The operator is told what they will lose

- **WHEN** the operator asks to regroup a project whose chapter carries an
  authored title and brief
- **THEN** they are shown that the title and brief will be replaced
- **AND** nothing changes until they confirm

#### Scenario: Declining changes nothing

- **WHEN** the operator declines the confirmation
- **THEN** the project's chapters, titles and briefs are unchanged

#### Scenario: Nothing to regroup from

- **WHEN** a project's scenes carry neither section provenance nor story beats
- **THEN** the regroup action is not offered

#### Scenario: Regrouping is never automatic

- **WHEN** a project whose chapters disagree with its scenes is opened
- **THEN** its chapters are shown as they are stored
- **AND** no regrouping happens without the operator asking for it

### Requirement: The script shows what a narration line is grounded in

Where a scene carries validated source evidence, the script SHALL show it against that scene's
narration: the source as a followable link, and the quote the narration was validated against.

The script SHALL read this from the scene records it already projects. It SHALL NOT store a second
copy of any citation, and it SHALL NOT retrieve anything to display one — consistent with the rule
that the script view projects scenes rather than owning them.

Citations SHALL be shown at the density where narration is edited and MAY be omitted at a density
meant for scanning structure, because a citation list on every row of an outline is noise rather
than signal.

A scene with no source evidence SHALL show nothing in its place. The script SHALL NOT present an
absence of evidence as a claim about whether the line needed grounding, because the scene record
does not carry that fact.

#### Scenario: A grounded narration line shows its source

- **WHEN** a scene carries source evidence and the script is at a narration-editing density
- **THEN** the scene's row shows the source as a followable link and the validated quote

#### Scenario: An ungrounded line shows nothing rather than a verdict

- **WHEN** a scene carries no source evidence
- **THEN** its row shows no citation affordance
- **AND** no statement is made about whether that line required grounding

#### Scenario: Citations do not become a second copy of the evidence

- **WHEN** the script displays a citation
- **THEN** it is read from the scene record
- **AND** no citation text is written back by the act of displaying it

#### Scenario: The outline density stays scannable

- **WHEN** the script is at the density meant for scanning structure
- **THEN** citation lists do not occupy the rows

#### Scenario: One rendering, two surfaces

- **WHEN** the story plan card and the script view both show a scene's or section's sources
- **THEN** they render through the same component rather than two separate implementations
