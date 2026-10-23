# project-media-library Specification

## Purpose

A project's media library: the assets its timeline references or keeps ready to place, how local files are imported into it (including while they upload), what is known about each asset, and how assets are placed, replaced and removed without losing what the timeline authored.

## Requirements

### Requirement: The project's media set is what the timeline references

The project's media set SHALL contain the assets that at least one clip in the document points at, and the assets that have been explicitly admitted to the project without yet being placed. The two SHALL be distinguishable, because they mean different things: the first is what the render will consume, the second is what an operator has decided to keep but not yet positioned.

A referenced asset SHALL enter the set once its first clip references it. It SHALL NOT leave when its last clip stops — it becomes an unplaced asset, still admitted, until it is deleted.

Membership in the referenced half SHALL be derived from the document rather than from a separate record. Membership in the unplaced half SHALL be exactly the admitted assets the document does not reference.

Reference-library entities SHALL NOT appear in the project's media set on the strength of being reference-library entities. A prompt-generated entity image is shown in the reference library; it enters the project's media set only by being admitted, which every placement path does and which browsing the library alone does not.

#### Scenario: An asset is placed

- **WHEN** a clip is created that references an asset
- **THEN** the asset is in the project's media set, in the referenced half

#### Scenario: The last clip using an asset is removed

- **WHEN** the only clip referencing an asset is deleted
- **THEN** the asset moves to the unplaced half of the project's media set rather than leaving it

#### Scenario: An asset is saved but not placed

- **WHEN** an asset is admitted from an external source without being placed on the timeline
- **THEN** it appears in the unplaced half of the project's media set, and admitting it again does not create a second asset

#### Scenario: A saved asset is then placed

- **WHEN** a clip is created referencing an asset that was already admitted and unplaced
- **THEN** one asset exists, and it appears in the referenced half rather than in both halves

#### Scenario: A reference-library entity that was never admitted

- **WHEN** a reference entity's image exists in the library and no clip references it and it has not been admitted to the project
- **THEN** it is shown in the reference library and not in the project's media set

#### Scenario: Assets admitted before the unplaced half existed

- **WHEN** a project is loaded whose stored assets include some that no clip references
- **THEN** they appear in the unplaced half, without migration and without being discarded

### Requirement: Every kind of placement records which asset it used

Every path that introduces media into a project SHALL admit it and record the resulting asset identity on whatever it creates or modifies — whatever surface the media came from, and whether it arrives by placement, by generation, or by an agent acting on the operator's behalf.

This SHALL hold for a scene frame, an additional visual within a scene, an overlay clip, an audio clip, a generated voiceover, a generated scene image, an animated video, and a clip written by an agent job or by caption realignment. A path that can set a media URL without admitting is a defect, not a variant.

An asset's identity SHALL NOT be inferred from its URL at read time. A placement that records only a URL is indistinguishable from one whose asset was never admitted, which is what makes the project's media set computable.

#### Scenario: Each placement path is attributable

- **WHEN** media is placed as a scene frame, as an additional visual in a scene, as an overlay clip, or as an audio clip
- **THEN** in every case the resulting clip records the asset's identity

#### Scenario: Generated media is attributable

- **WHEN** a voiceover is synthesised, a scene image is generated, or a frame is animated into a video
- **THEN** the result is admitted to the project and the clip records its identity, as if it had been placed from a browsing surface

#### Scenario: Agent-written media is attributable

- **WHEN** an agent job or a caption realignment writes clips carrying media URLs
- **THEN** each such clip records the identity of an admitted asset

#### Scenario: A clip that predates the recording

- **WHEN** a clip references media but carries no asset identity
- **THEN** it is reconciled into one rather than treated as an error

### Requirement: The project's media record repairs itself

The project SHALL reconcile its media record against its document: any clip or scene frame holding a media URL with no asset identity SHALL be admitted, and the identity SHALL be recorded on it. Reconciliation SHALL run when the document changes and when a project is loaded.

Reconciliation SHALL be idempotent. Admitting a URL that is already admitted SHALL yield the existing asset rather than a second one, so that a reconciliation pass over an already-consistent document performs no write.

Reconciliation SHALL NOT write, and SHALL NOT signal a change, when it finds nothing to repair. A reconciler that writes on every pass would drive the document change that triggers it.

Reconciliation is a safety net, not the mechanism. Every writer SHALL record the identity itself; the reconciler exists so that a writer which fails to do so degrades the record's timeliness rather than its completeness.

#### Scenario: A project holding unattributed media is opened

- **WHEN** a project is loaded whose clips carry media URLs with no asset identity
- **THEN** those assets are admitted and appear in the project's media set, without a migration step

#### Scenario: A writer omits the identity

- **WHEN** a clip is created with a media URL and no asset identity
- **THEN** reconciliation admits the asset and records the identity on that clip

#### Scenario: Reconciling an already-consistent document

- **WHEN** reconciliation runs over a document in which every media URL already carries an asset identity
- **THEN** no asset is created, no clip is modified, and no change is signalled

#### Scenario: The same URL on two clips

- **WHEN** two clips carry the same media URL and neither has an asset identity
- **THEN** one asset is admitted and both clips record its identity

### Requirement: Media survives the clip that used it

An asset admitted to a project SHALL remain in the project's media set after the clips referencing it are removed, so that the set answers what the project has ever held rather than only what it currently renders.

Removing such an asset SHALL require deleting it explicitly, which is available precisely because no clip holds it.

#### Scenario: The clip using generated media is deleted

- **WHEN** the only clip referencing a generated voiceover is removed
- **THEN** the voiceover remains in the project's media set as an unplaced asset, available to place again

#### Scenario: Re-placing media whose clip was removed

- **WHEN** an operator places an unplaced asset whose earlier clip was deleted
- **THEN** one asset exists and the new clip records its identity

### Requirement: One path admits an asset to the project

Admission to the project's media set SHALL go through a single operation that deduplicates on the asset's URL and returns the identity of the asset — the existing one when the URL is already admitted, a newly minted one otherwise. The server SHALL decide admission against the project's stored library, so two clients that admit the same URL receive one asset.

Every surface that can place an asset SHALL admit it through that operation before creating the clip, so that placing and saving cannot produce two assets for the same file. A client MAY show the admitted asset before the server confirms it, and SHALL adopt the server's identity when the server already held the URL.

#### Scenario: The same asset arrives twice

- **WHEN** the same URL is admitted a second time, from the same surface or a different one
- **THEN** one asset exists and both callers receive the same identity

#### Scenario: Saving and then placing

- **WHEN** an asset is saved from a browsing surface and then dragged onto the timeline
- **THEN** one asset exists, and the clip references it

#### Scenario: Two devices admit the same file

- **WHEN** two clients of one project admit the same URL before either has read the other's admission
- **THEN** the project holds one asset, and both clients show it under one identity after their next read

### Requirement: Any browsing surface can place an asset directly

An asset SHALL be placeable on the timeline by dragging it from the surface the operator found it on. Placing SHALL admit the asset and create the clip as one action, requiring no prior save.

This SHALL hold for the project's own media, for external stock results, and for reference-library entries alike. A surface that shows a placeable asset and cannot place it is a defect.

Saving without placing MAY remain available where it is useful, and SHALL admit through the same operation as placing.

#### Scenario: Placing from stock

- **WHEN** the operator drags a stock result onto the timeline
- **THEN** the clip is created and the asset is admitted, without a separate save step

#### Scenario: Placing from the reference library

- **WHEN** the operator drags a reference entry onto the timeline
- **THEN** the clip is created and the entity is copied into the project, carrying its provenance

#### Scenario: The same stock item placed twice

- **WHEN** the operator drags the same stock result onto the timeline twice
- **THEN** two clips exist and both reference one asset

### Requirement: Placed audio keeps the kind it was dragged as

An audio asset placed on the timeline SHALL produce a clip of the kind it was dragged as. A sound effect SHALL NOT be placed as background music, and background music SHALL NOT be placed as a sound effect.

#### Scenario: A sound effect is placed

- **WHEN** the operator drags a sound effect onto the timeline
- **THEN** a sound-effect clip is created

#### Scenario: A music bed is placed

- **WHEN** the operator drags a music bed onto the timeline
- **THEN** a music clip is created

### Requirement: Removing an asset means removing what uses it

The project's media set SHALL NOT offer to delete an asset that a clip references, since such a deletion cannot take effect while the clip holds it. A surface showing the project's media set SHALL instead be able to reveal, on the timeline, the clips that reference the asset, so that an operator who wants it gone can find what is holding it.

An asset that no clip references SHALL be deletable, because nothing holds it and deleting it is the only way to remove it. Deleting one SHALL remove it from the project's stored assets and SHALL NOT affect any clip.

The availability of delete SHALL follow from which half of the set the asset is in, so that an operator can tell before acting which assets they can remove.

#### Scenario: An operator wants a referenced asset gone

- **WHEN** the operator asks to remove an asset that a clip references
- **THEN** they are shown the clips that reference it rather than given a delete action that cannot take effect

#### Scenario: An operator removes an unplaced asset

- **WHEN** the operator deletes an asset that no clip references
- **THEN** the asset is removed from the project and no clip changes

#### Scenario: Delete availability is legible

- **WHEN** the operator inspects an asset in the project's media set
- **THEN** whether it can be deleted is apparent from which half it is in, before they attempt the action

### Requirement: Media dragging makes placement predictable

Dragging ready media SHALL show a stable thumbnail/name ghost, compatible target feedback, and snapped insertion position and duration before placement. Locked, incompatible, or unready targets SHALL show rejection feedback and SHALL NOT mutate the project. Scrolling or zooming during drag SHALL preserve correct placement coordinates. Cancellation SHALL change nothing; keyboard and touch SHALL have an explicit placement action.

#### Scenario: Place while timeline scrolls

- **WHEN** editor drags ready media while timeline scrolls or zoom changes
- **THEN** insertion preview and resulting clip agree on lane and snapped time, and one undo reverses placement

#### Scenario: Invalid drop or cancellation

- **WHEN** editor drops on a locked or incompatible lane or cancels dragging
- **THEN** no asset reference or clip is added and invalid targets provide clear feedback

### Requirement: Project media can be imported from local files

An authorized project editor SHALL import supported image, video, and audio files through file selection, multi-file drag/drop, and clipboard file paste. A chosen supported file SHALL become a pending project asset immediately, before upload and processing finish. Importing to All Media SHALL admit pending assets into Ready to place without creating clips. Dropping onto a timeline lane SHALL admit the file and place it at the requested position immediately, through the same import operation. A pending asset SHALL keep one project identity from the moment it is chosen through completion, so clips placed while it uploads keep referencing it once it is ready. Temporary browser URLs SHALL NOT be persisted.

#### Scenario: Batch files are staged

- **WHEN** an editor selects supported image, video, and audio files in All Media
- **THEN** each appears in Ready to place at once with its upload state, and once ready it survives reload without changing the timeline

#### Scenario: File is dropped onto the timeline

- **WHEN** an editor drops a supported file onto an unlocked compatible lane
- **THEN** a clip referencing the pending asset appears at the requested position at once, and one undo removes it

#### Scenario: Clipboard belongs to a text field

- **WHEN** the editor pastes while a text field or another studio owns keyboard focus
- **THEN** the project media import handler does not intercept that paste

#### Scenario: Caller lacks project access

- **WHEN** a caller imports into an inaccessible project or supplies another project's import identity
- **THEN** the request is refused before media publication or document mutation

### Requirement: Import has bounded work and truthful recovery

Each file SHALL expose queued, uploading, processing, ready, failed, or cancelled state with its filename and available progress. The service SHALL enforce declared byte, batch, decoded-resource, processing-time, and concurrency limits. A failed file SHALL NOT hide successful siblings or enter the project as ready. Retrying SHALL avoid admitting an already successful file twice; cancellation SHALL prevent late results from placing clips in a closed or changed project.

#### Scenario: Partial batch failure

- **WHEN** one file fails in a batch of three
- **THEN** two successful assets remain available and the failed file exposes its reason and retry action

#### Scenario: Oversized or invalid bytes

- **WHEN** a file exceeds a declared limit or its bytes disagree with its claimed media kind
- **THEN** import fails with an actionable reason and no ready asset is published

#### Scenario: Cancelled work completes late

- **WHEN** a cancelled import completes after the editor changes project
- **THEN** it does not mutate the new project or create an unexpected timeline clip

### Requirement: Imported assets expose probed metadata and compatibility

Imported assets SHALL retain original filename, byte size, detected kind/container, dimensions when applicable, duration when applicable, video frame-rate information, and source-audio presence. Unknown metadata SHALL remain unknown rather than fabricated. Before processing completes, a pending asset SHALL expose the metadata the browser can measure locally and SHALL be replaced by server-measured metadata once ready. Preview and production-render compatibility SHALL be reported separately. A pending asset whose duration cannot be measured locally SHALL NOT be placeable until processing provides it. A pending source the browser cannot decode SHALL be placeable when its duration is known, and SHALL show that its preview is available after processing. A source that cannot meet both paths after processing SHALL remain unavailable for export with an actionable explanation.

#### Scenario: A camera clip is imported

- **WHEN** a video with a known duration, dimensions, and audio stream is imported
- **THEN** it is placeable with its locally measured duration at once, and its media details report the server-measured values once ready

#### Scenario: Variable frame-rate source

- **WHEN** a video uses variable frame rate
- **THEN** its metadata identifies that condition once processed and editing uses source timestamps rather than a fabricated fixed source FPS

#### Scenario: Browser cannot decode the source

- **WHEN** the source codec cannot be previewed in the current browser
- **THEN** its clip shows that preview is available after processing, and the converted preview appears without re-placing it

#### Scenario: Duration cannot be measured locally

- **WHEN** the browser cannot measure a pending video or audio duration
- **THEN** placement waits for processing and says why

### Requirement: Project media supports explicit collection operations

All Media SHALL provide grid/list views, stable ascending/descending sorting by name, type, duration, or size, existing search/type filters, and explicit multiple selection. Selection SHALL be independent from preview and timeline selection. Users SHALL rename a project label without changing original filename or media identity, place selected ready assets in deterministic displayed order, and remove selected unused assets without removing referenced ones. Selection SHALL survive view changes and exclude assets hidden by filters from bulk actions.

#### Scenario: Sort and view switch

- **WHEN** the editor sorts by duration and switches from grid to list
- **THEN** visible order and selected identities are retained and unknown durations have a deterministic position

#### Scenario: Mixed bulk removal

- **WHEN** selected assets include used and unused sources
- **THEN** the editor can remove only unused sources, used sources remain readable, and the result names retained items

#### Scenario: Filter hides selected assets

- **WHEN** the editor applies a filter that hides some selected assets
- **THEN** those hidden assets are removed from the bulk-action selection

#### Scenario: Rename and reload

- **WHEN** an editor renames an asset label and reloads the project
- **THEN** the label is retained and original filename, media identity, and clip timing remain unchanged

### Requirement: Asset use and source repair are explicit

Each asset SHALL expose the count and navigable locations of its uses, including scene visuals and audio. Missing media SHALL remain visible with a recovery action. Replacement or relinking SHALL validate kind, compatibility, and every affected source range before atomically updating project references. It SHALL preserve clip identities, timeline positions, transforms, animation, and provenance history; an incompatible or too-short replacement SHALL fail without partial edits. Repair SHALL NOT change other projects sharing the original source.

#### Scenario: Asset is used several times

- **WHEN** an editor requests usage for an asset referenced by multiple clips
- **THEN** each use is listed and selecting a use seeks and selects the corresponding clip

#### Scenario: Relink a missing file

- **WHEN** an editor supplies a compatible replacement for unavailable media
- **THEN** all project uses become readable without changing clip timing or identity

#### Scenario: Replacement is too short

- **WHEN** replacement cannot cover any affected clip's source range at its rate and direction
- **THEN** replacement is refused and all original references remain unchanged

#### Scenario: Another project shares the source

- **WHEN** an editor replaces a source in one project
- **THEN** another project's source and playback remain unchanged

### Requirement: Pending media shows its upload state wherever it is used

A pending asset SHALL show its current state on its asset card and on every placed clip that uses it, at desktop and phone sizes: uploading with byte progress, processing, failed with its reason, or interrupted. The state SHALL be exposed to assistive technology. Completing an import SHALL update every use in place without moving, re-timing, or re-creating clips, and SHALL NOT add an undo step or clear redo.

#### Scenario: Progress on a placed clip

- **WHEN** a placed clip's pending asset has uploaded 40% of its bytes
- **THEN** the clip and its asset card both report uploading at 40%

#### Scenario: Import completes after edits

- **WHEN** an editor trims and keys a pending clip and its import then becomes ready
- **THEN** the clip keeps its trim and keys, plays the managed media, and undo still reverses the last edit rather than the completion

#### Scenario: Undo across completion

- **WHEN** an editor undoes to a state recorded while the asset was pending, after the import became ready
- **THEN** the restored clip plays the managed media

### Requirement: Pending media recovers from failure and reload

A failed pending asset SHALL keep its clips and SHALL offer retry, choosing the file again, and removal. Reloading or reopening the project while an import is pending SHALL resume it with the same identity when the browser still holds the chosen file. Otherwise the asset SHALL be marked interrupted and ask the editor to choose the file again. Choosing a file again SHALL validate kind and duration against every placed use, as source replacement does.

#### Scenario: Reload mid-upload

- **WHEN** the editor reloads while a placed video is 60% uploaded
- **THEN** the clip remains placed and the upload resumes for the same asset without creating a second asset

#### Scenario: Chosen file no longer available

- **WHEN** a pending asset's file is not available after reopening the project
- **THEN** its clips show interrupted and choosing a compatible file completes the import for the same asset

#### Scenario: Retry after failure

- **WHEN** a pending upload fails and the editor retries
- **THEN** the same asset continues and its clips are untouched

### Requirement: Pending media is not treated as available media

Production export, server-side source processing, and agent edits SHALL treat a pending asset as unavailable and SHALL name the pending files. Agent output SHALL NOT create, remove, or re-point references to a pending asset. A simplified draft export MAY render a pending source from the browser's copy and SHALL disclose that it did.

#### Scenario: Export while uploading

- **WHEN** an editor starts a production export while a placed asset is pending
- **THEN** export is refused before enqueue, naming the pending file, and the document is unchanged

#### Scenario: Agent edits a project with pending media

- **WHEN** an agent result is merged while an asset is pending
- **THEN** clips that reference the pending asset are preserved unchanged

#### Scenario: Source processing on pending media

- **WHEN** an editor opens reverse, rate, or extract-audio controls on a pending clip
- **THEN** the controls are unavailable with the reason that the upload must finish first

### Requirement: Uploads arrive complete or not at all

The import service SHALL accept every file within the advertised import byte limit and SHALL refuse a body whose length differs from the size the client declared. A client that disconnects mid-upload SHALL cause the upload to fail promptly rather than be stored truncated. A refused or interrupted upload SHALL NOT be stored as the import's source or sent for processing.

#### Scenario: Client disconnects mid-upload

- **WHEN** the browser drops the connection after sending part of a file through the web proxy
- **THEN** the API observes an aborted upload and the import fails without storing or processing the partial bytes

#### Scenario: Body shorter than declared

- **WHEN** an upload's body is shorter or longer than its declared file size
- **THEN** the import is refused as incomplete and nothing is processed

#### Scenario: File within the import limit

- **WHEN** an editor uploads a 40 MB video and the import limit is 50 MB
- **THEN** the upload reaches the import service and is processed
