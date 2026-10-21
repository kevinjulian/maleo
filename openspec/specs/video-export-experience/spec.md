# video-export-experience Specification

## Purpose

Make project video exports browsable within their workspace and keep export status accessible from both the project and Video collection after navigation or reload.

## Requirements

### Requirement: Video uses the shared media collection structure

Video SHALL present project export attempts through the same page hierarchy as Images and Speech: heading, count, search/filter toolbar, collection, and pagination. Export records SHALL lead with a preview and project identity rather than a job identifier. Active and failed attempts SHALL remain visible alongside completed exports. Counts SHALL identify export attempts and SHALL NOT imply that unfinished jobs are completed videos.

#### Scenario: Operator opens Video

- **WHEN** an operator opens Video
- **THEN** they see newest export attempts with project identity, status, creation time, and known duration
- **AND** the heading, toolbar, and collection use the same structural hierarchy as Images and Speech

#### Scenario: Technical details are secondary

- **WHEN** an operator browses exports
- **THEN** project identity and output preview are prominent
- **AND** job identifiers and render diagnostics remain available through export details

### Requirement: Export discovery respects workspace scope before pagination

The collection SHALL show only exports belonging to the active authorized workspace. Search by project title and filters by project and export status SHALL execute before pagination and counting. Project options SHALL derive from accessible exports. Results SHALL use deterministic newest-first order, including a stable tie breaker. Filter state SHALL survive reload through the URL without creating a browser history entry for every edit.

#### Scenario: Workspace changes

- **WHEN** an operator changes workspace
- **THEN** exports, project options, and counts reload for the new workspace
- **AND** delayed responses from the previous workspace cannot replace them

#### Scenario: Accessible exports lie beyond another workspace's first page

- **WHEN** unrelated jobs precede exports matching the current workspace and filters
- **THEN** matching exports still fill the requested page without counting or exposing unrelated jobs

#### Scenario: Older exports are reachable

- **WHEN** more matching attempts exist than fit on one page
- **THEN** pagination reaches the remaining attempts without duplicates or omissions in an unchanged dataset

#### Scenario: Filtered URL is reopened

- **WHEN** an operator reopens an export collection URL with search, project, and status filters
- **THEN** the same filters apply to the named workspace
- **AND** changing a filter returns to the first page

### Requirement: Project export status reconnects after reload

Opening or reloading a video project SHALL discover its existing export jobs and fetch their current status before deciding whether export is idle. If any export is active, the project SHALL restore progress and resume monitoring without submitting another job. With multiple active jobs, the newest active job SHALL be the primary indicator and other attempts SHALL remain accessible in history. A completed latest job SHALL expose its existing output. Terminal failure and cancellation SHALL remain distinguishable from idle.

#### Scenario: Refresh during export

- **WHEN** an operator refreshes a project while its export runs
- **THEN** progress reconnects to the same job identifier
- **AND** activating the in-progress export button opens status rather than submitting another export

#### Scenario: Export completes while the project is closed

- **WHEN** an operator returns after the export completes
- **THEN** current completion and existing output actions are available without another render

#### Scenario: Browser closes before recording the render association

- **WHEN** the server accepts an export but the browser closes before finishing project bookkeeping
- **THEN** reopening the project discovers the accepted job through its persisted project ownership
- **AND** recovery does not create another output or render attempt

#### Scenario: Project changes during recovery

- **WHEN** an operator switches projects while a status request is pending
- **THEN** the previous project's response cannot replace the new project's export state

### Requirement: Project and collection show current execution status

The project button, export details, and Video collection SHALL resolve status from the same execution job. Stored project records SHALL NOT override newer execution status. Reconciling existing linked project/output records SHALL be idempotent and SHALL NOT rewrite storyboard content. Status checks SHALL NOT submit, retry, or charge for rendering.

#### Scenario: Stored status is stale

- **WHEN** a saved project render says queued but its execution job is completed
- **THEN** both project and collection show completion and offer the completed output
- **AND** reconciliation updates existing linked records without creating another attempt

#### Scenario: New export appears while the collection is idle

- **WHEN** an operator returns focus to Video after an export started elsewhere
- **THEN** the collection refreshes and shows that attempt
- **AND** active attempts continue updating until terminal status

### Requirement: Connection failure preserves export context

Initial discovery SHALL distinguish checking, empty, and failure states. A temporary status failure SHALL retain known job identity and progress, identify the connection problem, and offer recovery. An unavailable job SHALL be distinguished from a temporary connection failure. Recovery SHALL NOT silently infer completion, cancellation, or absence of an active job.

#### Scenario: Status request fails temporarily

- **WHEN** an established progress request fails
- **THEN** the last known progress remains visible with a reconnecting or unavailable-status notice
- **AND** the system resumes status checks without starting another export

#### Scenario: Initial job discovery fails

- **WHEN** current export status cannot be determined on project load
- **THEN** the interface explains the failure and offers retry
- **AND** it does not present that uncertainty as a successful idle or empty state

#### Scenario: A known job no longer exists

- **WHEN** the server confirms that a previously known job is missing
- **THEN** the interface identifies unavailable export history rather than polling forever or reporting a successful export

### Requirement: Export actions follow current state

Completed exports SHALL offer authorized playback, download, and navigation to the originating project. Active exports SHALL offer progress details. Failed attempts SHALL offer retry only when existing retry rules allow it, and degraded exports SHALL retain their warnings. Action failures SHALL be visible. Playback and download SHALL reuse stored output without rendering again.

#### Scenario: Completed export is opened

- **WHEN** an operator opens a completed export
- **THEN** its stored video plays with reachable download and project actions
- **AND** no render request is issued

#### Scenario: Validation prevents retry

- **WHEN** an export failed because its authored input needs correction
- **THEN** the interface directs the operator to its project instead of offering an ineffective plain retry

#### Scenario: Retry request fails

- **WHEN** an allowed retry request fails
- **THEN** an actionable error remains visible and the attempt is not falsely shown as queued

### Requirement: Preview media is truthful and authorized

Newly completed exports SHALL provide posters derived from their actual rendered output through authorized managed media delivery. Older exports without posters SHALL remain playable through a named fallback. Missing media SHALL remain identifiable without a broken-image control. Poster failure SHALL NOT turn an otherwise usable completed export into a failed render.

#### Scenario: Export poster is available

- **WHEN** a new export completes with a poster
- **THEN** its collection preview comes from the rendered video and remains accessible after worker recreation
- **AND** poster access follows the export's workspace authorization

#### Scenario: Older export has no poster

- **WHEN** an accessible older export has no poster
- **THEN** a clear fallback identifies it and playback still works when its video exists

### Requirement: Collection and export details remain usable on phones

Video SHALL distinguish loading, first-use empty, filtered-empty, failed load, and missing media. Collection rows and export details SHALL remain readable and operable at 320px and desktop widths. Playback, status, project navigation, and recovery actions SHALL support keyboard and touch without hover-only controls or horizontal clipping.

#### Scenario: Narrow screen browsing

- **WHEN** Video opens at 320px width
- **THEN** preview, project identity, status, and actions remain reachable without horizontal clipping

#### Scenario: Filter matches nothing

- **WHEN** an authorized search succeeds with no matching exports
- **THEN** the collection offers filter reset rather than reporting a server failure or requiring a new export

### Requirement: Export playback uses a locally bundled commercial-compatible player

Stored export playback SHALL use pinned Video.js 10 React components with existing
authorized media delivery. The player SHALL expose playback, seeking, sound,
fullscreen and playback speed through keyboard and touch controls without
submitting render work. Existing export overlays SHALL retain dismissal and focus
ownership. Playback failures SHALL retain the existing unavailable-media state.
Player distribution SHALL include applicable dependency license notices and SHALL
NOT enable analytics or external media services by default. Timeline preview SHALL
continue to use Remotion.

#### Scenario: Operator plays an export with custom controls

- **WHEN** an operator opens a playable export
- **THEN** Video.js controls play and seek the existing MP4 without a render submission
- **AND** download, project navigation, keyboard dismissal and touch access remain available

#### Scenario: Player is distributed with paid SaaS

- **WHEN** the web distribution includes Video.js
- **THEN** the pinned dependency closure is reviewed and required licenses are shipped with the distribution
- **AND** playback requires no third-party hosting or analytics account
