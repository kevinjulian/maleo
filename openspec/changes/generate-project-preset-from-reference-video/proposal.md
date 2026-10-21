## Why

Operators can review the arc chosen for one generated story, but reusable story structure still comes from code-owned definitions and cannot be learned from a reference video, inspected before use, or saved as workspace-owned generation context. Turning a reference video into a reviewable Project Preset removes that hidden logic while preserving the existing `Project Preset = Project Materials + Video Template` product model.

## What Changes

- Add a full-page `Generate from video` flow under Library > Project Presets: paste a YouTube URL, provide a timestamped transcript and frame-readable source media, analyze it, review the result, select one or more exact timestamp frames, and save.
- Derive a transferable story structure from the timestamped transcript, with ordered chapter functions, obligations, relative position windows, default emotions, source-time evidence, and confidence. Never copy narration or request creator/channel imitation.
- Make reusable story structure structured content of Story Material. Built-in and workspace-owned structures use the same planning contract; generated projects retain snapshot semantics.
- Generate a Visual Material from operator-selected frame references using existing roles and `referenceUse`; preserve source video id, URL, and timestamp provenance for each captured frame.
- Generate an ordinary Video Template from measurable source behavior. Review UI distinguishes values inferred from evidence, safe defaults, and operator changes; unsupported properties are defaulted rather than fabricated.
- Present one review workspace with Structure, Frames, Video Template, and Save steps. Structure is visible first and editable; frame selection uses a persistent source player and frame-accurate seek controls; advanced template fields remain progressively disclosed.
- Save Story Material, Visual Material, Video Template, frame Reference entities, and Project Preset atomically. Failed or cancelled saves leave no partial library records.
- Require confirmation of source and frame reuse rights before analysis or persistence. The URL identifies and embeds the source; v1 analysis uses operator-supplied SRT/VTT/timestamped text and local video or timestamped screenshots. The system SHALL NOT add a generic YouTube downloader, scrape captions, import browser cookies, or circumvent source controls.

## Capabilities

### New Capabilities

- `reference-video-preset-generation`: authorized source ingestion, transcript and video analysis, evidence-backed review UI, exact frame selection, source-file recovery, and atomic creation of the resulting reusable records.

### Modified Capabilities

- `story-arc-structure`: allow workspace-owned structured story recipes to drive the same skeleton, coverage, persistence, and review behavior as built-in arcs.
- `project-materials`: let Story Material carry a structured story recipe and let generated Visual Material retain selected typed frame references without creating another top-level style system.
- `content-presets`: add reference-video generation as a Library creation path while preserving the preset as material identities plus one Video Template identity.
- `reference-entity-model`: retain source-video and timestamp provenance for exact frames saved as canonical workspace reference entities.

## Impact

- `apps/web`: Project Presets entry action, full-page generation/review flow, story-structure editor, source player/frame picker, inferred/defaulted template summary, recovery states, and success actions.
- `apps/api`: validated source-identity and analysis endpoints, durable analysis state, uploaded transcript/measurement processing, staged frame capture, atomic library-record creation, and outbound-request safety.
- `packages/shared`: custom story-structure schemas, Story Material payload, analysis/review contracts, frame provenance, and backward-compatible planning resolution.
- `packages/db`: unified-schema storage for analysis state and any new structured material/reference metadata; no schema mutation outside the unified schema owner.
- Existing Material, Reference, Video Template, Project Preset, planner, and fixture/read-only-copy paths gain focused contract and integration tests.
- Contributor-facing workflow and UI changes require an `Unreleased` changelog entry. Provider/dependency choice remains a design decision and is not fixed by this proposal.
