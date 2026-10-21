# project-chat-workspace Specification

## Purpose

Define the project chat as a workspace: a read-only transcript with one actionable frontier, flat run presentation, story-plan summaries, state-only colour, a quiet context-aware composer, pinned decisions with explicit reply, progress and recovery, results linked back to the editor, and desktop sizing and accessibility.

## Requirements

### Requirement: Only the newest actionable state offers actions

The project chat SHALL expose project-changing or editor-navigating actions only for the newest actionable state (the frontier), the composer, and the pinned blocker batch. Every earlier run, output, result, and decision SHALL render as read-only history with no action controls. A newer instruction SHALL end the previous frontier.

The pinned blocker batch is the one bounded exception: it describes current project state rather than a past run, so it offers its remedy controls regardless of which run surfaced its blockers and regardless of that run's phase. It SHALL NOT restore actions to any run, output, result, or decision in the transcript.

An instruction sent while a decision is pending SHALL be queued rather than started. A decision is resolved by answering it or stopping its run, never by typing past it: launching immediately abandoned the gate the operator was reading.

#### Scenario: Run is executing

- **WHEN** the newest run is executing
- **THEN** its status row offers Stop
- **AND** no earlier run offers any action

#### Scenario: Earlier run failed

- **WHEN** an earlier run failed or partially failed and a newer instruction exists
- **THEN** the earlier run shows its failure as text without Retry

#### Scenario: Earlier story plan

- **WHEN** a story plan belongs to a run that is not the frontier
- **THEN** it renders without editable fields, generation actions, or navigation actions

#### Scenario: Earlier result

- **WHEN** an applied or held result belongs to a run that is not the frontier
- **THEN** it states what happened without `Show changes`, `Undo`, review, or re-plan

#### Scenario: Instruction sent while a decision waits

- **WHEN** a run is waiting on a decision and the user sends a newer instruction
- **THEN** that instruction is held as the queued instruction and no run starts
- **AND** the decision stays pinned with its choices, reply, and Stop
- **AND** the queued instruction runs once the decision is resolved

#### Scenario: Earlier decision

- **WHEN** a decision belongs to a run that a later run has already superseded
- **THEN** it is no longer pinned and offers no choice, reply, or Stop
- **AND** it reads as superseded in the transcript

#### Scenario: One action set per state

- **WHEN** the frontier run is running, waiting, failed, partial, interrupted, credit-blocked, or holds an applied or held result
- **THEN** it offers only that state's actions
- **AND** its outputs offer none of their own (fix, seek, add to timeline, clip links, `Open in Storyboard`)

#### Scenario: Settled run with nothing pending

- **WHEN** the frontier run finished with no result, failure, or decision to act on
- **THEN** its outputs may offer their own actions, and nothing else in the transcript does

#### Scenario: Blockers open on an earlier run

- **WHEN** blockers reported by an earlier run are still open
- **THEN** the pinned blocker batch offers their remedies
- **AND** that earlier run's outputs still offer no actions of their own

#### Scenario: Blocker remedies are not run actions

- **WHEN** the pinned blocker batch is shown beside a frontier run that offers Retry
- **THEN** the run offers only Retry
- **AND** the blocker remedies belong to the pinned batch, not to the run

### Requirement: Chat presents runs flat, with activity disclosed on request

The project chat SHALL present user instructions, assistant answers, required decisions, and runs as distinct message types. A run SHALL render as one status row plus an optional `Activity` disclosure, with its outputs directly below and no container around the run. Within the chat history a turn SHALL contain at most one bordered surface. Tool calls and safe activity summaries SHALL appear only inside the disclosure; hidden reasoning SHALL NOT be rendered.

#### Scenario: Run is active

- **WHEN** a command is executing
- **THEN** the run's status row shows its current stage
- **AND** related tool events do not appear as peer conversation messages

#### Scenario: Run produces useful output

- **WHEN** a run reaches useful output or a terminal state
- **THEN** its activity disclosure is closed by default
- **AND** the user can open it through an explicit `Activity` control

#### Scenario: Nesting is bounded

- **WHEN** a run with activity, a story plan, and a result is rendered
- **THEN** no bordered surface in that turn contains another bordered surface

### Requirement: Story plans are summarised in chat and edited in the editor

The chat SHALL render a story plan as a compact read-only summary of section count, duration against target, section status counts, verification status, and blocking direction errors. Chat SHALL NOT render narration or editorial editing controls. `Open in Storyboard`, which opens the editor's Storyboard view, SHALL be offered by the pinned decision while the frontier run waits on approval of its plan, and by the plan itself only when the frontier run has settled with nothing pending.

#### Scenario: Plan awaits review

- **WHEN** the newest run produced a story plan and waits on its approval
- **THEN** chat shows the plan's summary, and the pinned decision offers `Open in Storyboard` beside its choices
- **AND** the plan's narration is edited in the Storyboard view, not in chat

### Requirement: Colour carries state, not identity

Chat surfaces SHALL be neutral by default. The accent colour SHALL be reserved for running or active work, selection, and focus; warning colour for partial, credit, interruption, and advisory states; error colour for failure and held results. User messages, completed runs, and artifact kinds SHALL NOT be distinguished by colour.

#### Scenario: Completed transcript

- **WHEN** every run in view is complete
- **THEN** no run, message, or artifact uses the accent, warning, error, or success colour

#### Scenario: Run fails

- **WHEN** the newest run fails
- **THEN** its status row uses the error colour and nothing else in the transcript does

### Requirement: Credits appear only when they constrain work

The chat SHALL NOT show credit state while credits are healthy. It SHALL show credit state when credits are low, and SHALL replace the input with a credit action when generation is blocked.

#### Scenario: Healthy balance

- **WHEN** remaining credits are above the low threshold
- **THEN** the composer area shows no credit meter

#### Scenario: Blocked

- **WHEN** a credit limit blocks generation
- **THEN** the composer area shows the limit and its choices instead of the input

### Requirement: Composer displays automatic context

The composer SHALL show the scope resolved by `project-chat-context` as one quiet context line of removable labels identifying stable project entities, and SHALL update it when editor focus changes before submission. Whole-project focus SHALL show no line. Each instruction SHALL keep the scope it was submitted with inside a closed disclosure.

#### Scenario: Clip is selected

- **WHEN** the user selects a clip and opens or focuses chat
- **THEN** the context line names that clip

#### Scenario: User removes automatic context

- **WHEN** the user removes a label before sending
- **THEN** that focus source is excluded
- **AND** resolution falls through to the next applicable source

#### Scenario: Result names context

- **WHEN** a run starts
- **THEN** its instruction records the submitted scope in a closed `Context` disclosure
- **AND** later selection changes do not rewrite that record

### Requirement: Composer offers project entity completion

The composer SHALL offer `@` autocomplete over project sections, clips, materials, and references, inserting a stable entity reference rather than display text. Existing slash-command autocomplete SHALL remain separate and SHALL NOT be triggered by `@`.

#### Scenario: User types an entity mention

- **WHEN** the user types `@` followed by filter text
- **THEN** matching project entities are offered
- **AND** selecting one inserts a mention bound to that entity's stable id

#### Scenario: User dismisses the menu

- **WHEN** the autocomplete menu is open and the user presses Escape
- **THEN** the menu closes without inserting a mention or executing anything

#### Scenario: Mentioned entity is renamed

- **WHEN** a mentioned entity's title changes after insertion
- **THEN** the mention still resolves to the same entity

### Requirement: Composer remains usable during execution

The composer SHALL remain editable while a run is active. The user MAY prepare one queued instruction labelled `Send after current`; the system SHALL NOT start it concurrently and SHALL rebuild its context when the active run finishes.

#### Scenario: User types during generation

- **WHEN** a run is active and the user enters another instruction
- **THEN** the composer remains usable
- **AND** sending creates one visible queued instruction rather than another active run

#### Scenario: Active run finishes

- **WHEN** the current run reaches a terminal state and a queued instruction remains
- **THEN** the system rebuilds context from the current project before starting it

#### Scenario: User changes queued instruction

- **WHEN** one instruction is already queued
- **THEN** the user can edit, replace, or remove it
- **AND** the UI does not create a hidden multi-item work queue

### Requirement: Required input remains visible and explicit

The frontier run's unresolved approval or clarification SHALL be pinned immediately above the composer until answered, stopped, or superseded by a newer instruction. A decision from any earlier run SHALL NOT be pinned. Free-text input SHALL answer it only while an explicit `Replying to` mode is visible; otherwise composer text remains a project instruction or queued instruction. An answer the server refuses SHALL leave the decision pinned.

#### Scenario: Choice approval is pending

- **WHEN** a run waits for a finite choice
- **THEN** the decision is pinned above the composer with explicit choices and Stop

#### Scenario: Free-text clarification is selected

- **WHEN** the user chooses to answer a free-text clarification
- **THEN** the composer shows `Replying to` with the question and a cancel control

#### Scenario: Reply mode is cancelled

- **WHEN** the user cancels `Replying to`
- **THEN** composer text is no longer submitted as an answer to the parked run

### Requirement: Progress and recovery describe real work

An active run SHALL report its current named stage and measurable progress when the pipeline knows it. When the newest run is stopped, interrupted, credit-blocked, or failed, it SHALL expose the one action appropriate to that state. Recovery SHALL offer targeted retry when failed scope is known and SHALL NOT retry completed scope.

#### Scenario: Section generation is active

- **WHEN** a run is generating section three of eight
- **THEN** chat reports that stage and count rather than only `Running`

#### Scenario: Part of generation fails

- **WHEN** the newest run has completed and failed scopes
- **THEN** chat states that completed work was preserved
- **AND** offers retry of failed or incomplete scope only

#### Scenario: Run is interrupted

- **WHEN** a durable run can resume after interruption
- **THEN** chat offers Resume and does not invite a duplicate run

### Requirement: Results connect directly to editor changes

A result SHALL summarise what changed and identify the touched story or timeline entities. The frontier result SHALL expose `Show changes`, and SHALL expose `Undo` only while undoing reverses that run alone.

#### Scenario: User shows changes

- **WHEN** the user activates `Show changes` on the frontier result
- **THEN** the editor opens the applicable view and selects or seeks to the changed entities

#### Scenario: User undoes result

- **WHEN** the frontier result exposes `Undo` and the user activates it
- **THEN** the existing command ledger reverses that settled agent application as one step
- **AND** `Undo` is no longer offered

#### Scenario: Result conflicts with newer work

- **WHEN** entity fencing holds a result rather than applying it
- **THEN** the result explains the conflict and, while it is the frontier, offers review or re-plan
- **AND** it does not offer a misleading successful-change summary

### Requirement: Desktop chat width supports workflow content

At desktop widths, chat SHALL be one resizable pane constrained to a usable range of 380–520 CSS pixels, and its width SHALL persist as local chrome state. When horizontal space is constrained, the contextual inspector SHALL collapse before chat shrinks below its minimum.

#### Scenario: User resizes chat

- **WHEN** the user drags the chat boundary within its allowed range
- **THEN** the pane and editor reflow without covering controls or losing composer access

#### Scenario: Desktop width becomes constrained

- **WHEN** chat, editor, and inspector cannot all retain their minimum widths
- **THEN** the inspector collapses before chat becomes narrower than 380 CSS pixels

### Requirement: Continuous history does not steal reading position

Chat SHALL preserve the user's reading position when new events arrive unless the user is already at the latest content. It SHALL expose unread state and a `Jump to latest` action, and completed run activity SHALL remain closed by default.

#### Scenario: User reads older messages during a run

- **WHEN** new progress arrives while the user is scrolled away from the bottom
- **THEN** chat preserves the current scroll position
- **AND** reports unread newer content

#### Scenario: User is already at latest

- **WHEN** new content arrives while the user is at the bottom
- **THEN** chat keeps the latest content and composer boundary visible

### Requirement: Chat controls remain keyboard and assistive-technology operable

Chat SHALL expose semantic controls, visible focus, accessible names, and live status appropriate to urgency. Enter SHALL send from the composer, Shift+Enter SHALL insert a newline, and focus SHALL return predictably when a decision or sheet closes.

#### Scenario: Keyboard user sends multiline instruction

- **WHEN** focus is in the composer
- **THEN** Shift+Enter inserts a newline and Enter submits the instruction

#### Scenario: Run status changes

- **WHEN** progress, required input, completion, or failure changes
- **THEN** assistive technology receives a concise status announcement without replaying the whole transcript

#### Scenario: Pinned decision resolves

- **WHEN** the user answers or stops a pinned decision
- **THEN** focus returns to the composer or the next explicitly opened surface

#### Scenario: Reduced motion is requested

- **WHEN** the operating system reports a reduced-motion preference
- **THEN** activity expansion, pane resize, and card transitions occur without nonessential motion

### Requirement: Phone provides Editor and Chat views of one workspace

At phone width, the content workspace SHALL expose `Editor` and `Chat` views. Editor SHALL continue to show stage and timeline together. Switching views SHALL preserve editor selection, playhead, chat draft, queued instruction, pending decision, and active run state, and SHALL NOT navigate routes or reload the project.

#### Scenario: User moves from selected clip to chat

- **WHEN** the user selects a clip in Editor and switches to Chat
- **THEN** the composer shows that clip as context

#### Scenario: User returns after a result

- **WHEN** the user activates `Show changes` from Chat
- **THEN** the workspace switches to Editor and highlights the changed entity

#### Scenario: Run continues while Editor is visible

- **WHEN** a run is active and the user switches to Editor
- **THEN** a compact reachable indicator reports run state
- **AND** returning to Chat shows the same run card

#### Scenario: Decision is pending while Editor is visible

- **WHEN** a run parks on an approval or clarification while Editor is visible
- **THEN** the run indicator reports that input is required
- **AND** activating it opens Chat with the pinned decision focused

#### Scenario: Keyboard opens in Chat

- **WHEN** the on-screen keyboard opens while Chat is visible
- **THEN** the composer and any pinned decision remain visible above it

#### Scenario: Reduced motion is requested

- **WHEN** the operating system reports a reduced-motion preference
- **THEN** switching between Editor and Chat occurs without nonessential transition
