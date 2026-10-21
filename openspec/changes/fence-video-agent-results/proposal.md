## Why

`make-project-chat-context-aware` fences settled agent results against the entities they touched, so a run that takes minutes cannot overwrite what the user edited while waiting. That fencing reaches results applied through the editor's document-shaped command seam: slides and posts.

Video results do not go through that seam. `applyAgentScenes` writes through `setScenes` and the overlay setters directly, so a settled video run:

- is not fenced — it can overwrite a scene the user edited during the run, silently;
- is not one undo step, because it never enters the command ledger at all.

Underneath that sits a second problem. `mergeAgentScenes` pairs the agent's output with the editor's scenes by array position (`const before = prev[i]`), the same positional identity that was corrected for slides and posts. Scenes already carry stable ids; the merge simply does not use them. Fencing a positionally-merged result would compare the wrong records and apply an edit to the wrong scene — worse than not fencing, because it looks like it worked.

Video is the primary content type, and this is the editor's hottest apply path. It gets its own change rather than being absorbed into the end of another one.

## What Changes

- Match `mergeAgentScenes` by stable scene id instead of array position, so a scene keeps its identity across generation, reorder and reload.
- Preserve the existing field-carrying behaviour of the merge — an agent scene missing a field still inherits it from the scene it corresponds to, now found by id rather than by index.
- Route settled video results through the document-shaped command seam so one settled run is one undoable step.
- Fence video results per touched entity, using the same `touchedScopeOf` / `fenceTouchedResult` / `applyTouchedResult` path the other content types already use.
- Cover overlays, characters and media admission, which share the settled-video apply path and must keep working unchanged.

## Capabilities

### Modified Capabilities

- `project-chat-context`: Extends per-entity fencing and scoped application to settled video scene results.

## Impact

- Web: `apply-agent-job.ts` scene merge, `use-agent-apply.ts` settled video path, scene identity, command ledger coverage for video, visual and browser coverage.
- API, Shared, Database: none. The fencing contracts and fingerprint helpers already exist.
- No new dependency.

## Risks

This is the editor's most heavily used apply path. The merge carries a long tail of field-preservation behaviour (timeline preservation, blueprint fields, media admission, cast defaults) that exists because each piece was needed. Changing how `before` is found must not change what is carried once it is found — that is the property the tests have to pin hardest.

## Dependencies

Depends on `make-project-chat-context-aware` for the context envelope, entity fingerprints, and the fencing and scoped-application helpers this reuses.
