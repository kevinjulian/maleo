# Project Chat Context

## Purpose

One continuous chat per content project, and the typed context every command in it
receives. The chat owns transcript, recorded decisions and pending action; the
envelope owns what a run reads, how its focus resolves, and how its settled
result is fenced back onto the document by entity identity.

## Requirements

### Requirement: Each project has one continuous chat

The system SHALL maintain exactly one continuous chat transcript for each content project, together with the typed decisions recorded from it. Agent runs SHALL be execution units inside that chat and SHALL NOT create threads, branches, folders, tasks, or alternate conversation identities.

#### Scenario: User sends several instructions

- **WHEN** the user sends multiple instructions in one project
- **THEN** every instruction and its run append to the same chat in chronological order
- **AND** no thread or task selection is introduced

#### Scenario: User opens another project

- **WHEN** the user opens a different content project
- **THEN** the chat and recorded decisions shown belong only to that project

#### Scenario: Project reloads

- **WHEN** the user reloads a project
- **THEN** its single transcript, recorded decisions, pending action, and active run are restored without creating another conversation

### Requirement: Every command receives an authoritative context envelope

Before starting a run, the system SHALL compile a typed context envelope from current project state. The envelope SHALL include compact representations of the brief, creative direction, approved story, storyboard, timeline, clips, Project Materials, project references, generated assets, pending action, editor focus, and normalized conversation memory applicable to the command.

The user SHALL NOT need to restate project information already available through that envelope.

#### Scenario: Command follows an unsaved editor change

- **WHEN** the user edits the live document and immediately sends a chat command
- **THEN** the run reads a context envelope containing that live change
- **AND** the envelope is not delayed by debounced autosave

#### Scenario: Command depends on project guidance

- **WHEN** the user asks for an edit governed by audience, brand, voice, visual, or rules materials
- **THEN** the applicable structured project guidance is present in the run context without the user repeating it

#### Scenario: Context can be audited

- **WHEN** a run is inspected
- **THEN** its trace identifies the resolved focus, context layers, captured entity fingerprints, and conversation-memory entries used for that run
- **AND** the trace contains no secrets and no hidden reasoning

### Requirement: Command focus resolves deterministically

The system SHALL resolve command focus in this precedence order: explicit context chips or typed mentions, active editor selection, object under the playhead, story or timeline entities named in the instruction, then whole-project scope.

Resolution SHALL use stable entity identity rather than display position. Every focusable story or timeline entity — including slides and posts — SHALL carry an identity that survives generation, reordering, and reload. Documents lacking that identity SHALL have it assigned, and colliding identities SHALL be repaired, before the document is used for focus or fencing.

#### Scenario: Explicit mention and selection disagree

- **WHEN** the user selects one clip but explicitly mentions another valid clip in the composer
- **THEN** the explicitly mentioned clip is the resolved focus

#### Scenario: User refers to this

- **WHEN** the user selects a scene or clip and sends an instruction referring to "this" without another explicit target
- **THEN** the selected entity and necessary neighboring context are the resolved focus

#### Scenario: No entity is selected

- **WHEN** no explicit target, selection, playhead object, or named entity resolves
- **THEN** the command receives whole-project scope

#### Scenario: Scope is materially ambiguous

- **WHEN** two plausible targets would produce materially different edits
- **THEN** the agent asks one scoped clarification before mutating either target

#### Scenario: Entities are reordered after focus resolves

- **WHEN** the user reorders slides, posts, or clips after a command captured its focus
- **THEN** the resolved focus still names the same entity it named before the reorder

#### Scenario: Legacy document has no stable identity

- **WHEN** a document persisted before stable identity existed is loaded
- **THEN** each entity is assigned a stable identity and duplicates are repaired
- **AND** no focus or fencing decision is made against positional identity

### Requirement: Decisions are recorded when made and reach later commands

When the user answers an approval or clarification, the system SHALL record a typed conversation decision identifying what was settled, the chosen value, and its source message and run. Recording SHALL NOT require a separate memory store.

Every command SHALL receive normalized conversation memory containing recorded decisions, unresolved questions, and a bounded window of meaningful recent turns. Memory SHALL exclude hidden reasoning, raw tool calls, transient progress events, and redundant generated prose. The system SHALL NOT infer decisions from unstructured prose.

Memory SHALL be built from the conversation state currently visible to the user rather than from a delayed persisted copy, and the receiving boundary SHALL validate it before use.

#### Scenario: User answers an approval

- **WHEN** the user resolves a pinned approval or clarification
- **THEN** a typed decision is recorded with its chosen value and source provenance

#### Scenario: Command follows immediately after an answer

- **WHEN** the user answers a decision and sends the next command before any debounced save completes
- **THEN** that decision is present in the new command's memory

#### Scenario: User continues after reload

- **WHEN** the user reloads and says "continue with the direction we agreed"
- **THEN** the run receives the applicable recorded decision with its provenance

#### Scenario: Reload happens immediately after an answer

- **WHEN** the user answers a decision and the session reloads or unmounts before any debounced save would have run
- **THEN** the decision is already durable
- **AND** it is present in memory after the reload

#### Scenario: Activity log is large

- **WHEN** prior runs contain many progress and tool events
- **THEN** those events are absent from conversation memory and do not consume the next run's conversational context

#### Scenario: Memory is malformed

- **WHEN** submitted memory fails schema validation or claims provenance outside the project
- **THEN** the offending entries are rejected
- **AND** the run proceeds with the validated remainder rather than trusting the submission

#### Scenario: Conversation and document conflict

- **WHEN** an older recorded decision conflicts with newer Project Materials or current document state
- **THEN** current structured project state wins
- **AND** the conflicting decision is not applied as an active constraint

### Requirement: Context access is bounded but complete

Every run SHALL receive compact indexes of project story, timeline, materials, references, and generated assets, and full records for resolved focus and required neighbors.

The system SHALL NOT require embeddings or vector retrieval to provide this access.

#### Scenario: Focused clip edit

- **WHEN** a command resolves to one clip
- **THEN** the run receives that clip, its containing story structure, necessary neighboring clips, and attached materials and references in detail
- **AND** unrelated clip detail remains indexed rather than injected in full

#### Scenario: Whole-project critique

- **WHEN** the command requests a whole-project pacing or consistency review
- **THEN** the run receives the complete structural indexes needed to inspect every section and timeline span

#### Scenario: Referenced media is needed

- **WHEN** the run needs a project reference's media
- **THEN** the API resolves the allowed project entity from its id
- **AND** no client-supplied arbitrary fetch URL becomes trusted context

### Requirement: Results are fenced and applied by touched entity identity

The context envelope SHALL carry a stable id and content fingerprint for every entity it describes in detail. A settled result SHALL declare the stable ids of the entities it changes. Before applying the result, the system SHALL re-derive the current fingerprint of those ids and compare it with the captured one. It SHALL NOT compare or block on entities outside the result's touched scope, and SHALL NOT silently overwrite a touched entity that changed after the envelope was captured.

Application SHALL be scoped: the written document SHALL take values from the result only for declared touched ids, and SHALL take every other entity from current project state. A result SHALL NOT restore a captured value for an entity it did not declare.

This governs every settled result the editor applies through its document-shaped command seam.
In this change that seam receives slide and post results. Settled video scene
results still use the existing direct merge path and are therefore outside this
requirement; `fence-video-agent-results` owns moving them through a stable-id,
undoable command seam before extending this guarantee to video.

#### Scenario: Touched scope is unchanged

- **WHEN** a settled result targets entities whose current fingerprints match the captured ones
- **THEN** the result applies through the existing command seam as one undoable user-visible step

#### Scenario: Unrelated edit happened during generation

- **WHEN** the user changes an entity outside the result's touched scope while the run executes
- **THEN** the result still applies to its touched scope
- **AND** the current value of the edited entity is written, not the captured one

#### Scenario: Result returns a whole document

- **WHEN** a settled result carries a full document shaped like the one the run read
- **THEN** only the declared touched entities are taken from it
- **AND** entities it rewrote without declaring are left at their current values

#### Scenario: Undo follows touched scope

- **WHEN** the user undoes a settled agent application
- **THEN** the command ledger reverses exactly the touched entities it changed
- **AND** unrelated edits made during the run are not reverted

#### Scenario: Target changed during generation

- **WHEN** the user changes an entity inside the result's touched scope before the result applies
- **THEN** the system holds the conflicting result for review or re-plans against current context
- **AND** it does not overwrite the newer edit

#### Scenario: Target was edited and reverted

- **WHEN** a touched entity was changed and restored to its captured value before the result applies
- **THEN** its fingerprint matches and the result applies without a spurious conflict

#### Scenario: Target no longer exists

- **WHEN** a touched entity was deleted before the result applies
- **THEN** the system holds the result for review rather than recreating the entity

#### Scenario: Entities were reordered during generation

- **WHEN** the user reorders slides or posts while a run executes
- **THEN** the settled result applies to the entities its declared ids name
- **AND** it does not apply to whichever entities now occupy those positions

### Requirement: Recovery preserves completed project work

Retry and resume operations SHALL rebuild context from current project state while preserving completed, valid output. A targeted retry SHALL operate only on failed or incomplete scope unless the user explicitly requests broader regeneration.

#### Scenario: Some sections fail

- **WHEN** generation completes some sections and fails others
- **THEN** the recovery action identifies failed or incomplete sections
- **AND** retry does not regenerate completed sections

#### Scenario: Interrupted run resumes

- **WHEN** a durable run is interrupted and resumed
- **THEN** it continues from its persisted cursor with the same captured run context
- **AND** any later slide or post result still passes entity fencing before application
