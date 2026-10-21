# chapter-aware-surfaces Specification

## Purpose

The surfaces that mark where one part of the story hands over to the next: the timeline ruler and the rendered chapter pill. Both existed before chapters did and were degenerate — one ruler marker per scene, and a pill reading "2 of 5" that meant scene 2 of 5.

## Requirements

### Requirement: The timeline ruler marks chapters, not scenes

The timeline ruler SHALL show one marker per chapter, positioned at the start of
that chapter's earliest scene and labelled with the chapter's title. It SHALL NOT
show one marker per scene.

A ruler chapter marker SHALL NOT be draggable, because its position is derived
from the scenes it groups. Any attempt to move one SHALL leave the document
unchanged rather than writing a position that the next read recomputes away.

#### Scenario: A project with two chapters

- **WHEN** a project's scenes are grouped into two chapters
- **THEN** the ruler shows two markers
- **AND** each is labelled with its chapter's title and sits at the start of that
  chapter's earliest scene

#### Scenario: Scenes without chapters

- **WHEN** every scene is in a single chapter
- **THEN** the ruler shows one marker, not one per scene

#### Scenario: A chapter marker cannot be dragged

- **WHEN** a ruler chapter marker is moved
- **THEN** the document is unchanged

#### Scenario: Retiming a chapter's first scene moves its marker

- **WHEN** the earliest scene of a chapter is moved later on the timeline
- **THEN** that chapter's ruler marker moves with it

### Requirement: Rendered chapter pills count chapters

The rendered chapter pill SHALL show the viewer's position among chapters — its
label taken from the chapter's title and its count from the number of chapters —
and SHALL span the full time range of the chapter it names. It SHALL NOT show one
pill per scene.

#### Scenario: A five-scene video in two chapters

- **WHEN** a video of five scenes grouped into two chapters is rendered with
  chapter pills enabled
- **THEN** the pill over the first chapter's scenes reads as the first of two
- **AND** the pill over the second chapter's scenes reads as the second of two

#### Scenario: A pill spans its whole chapter

- **WHEN** a chapter groups three scenes
- **THEN** one pill covers the span from the first scene's start to the last
  scene's end

#### Scenario: Chapter pills stay off by default

- **WHEN** a project has not enabled chapter pills
- **THEN** none are rendered
