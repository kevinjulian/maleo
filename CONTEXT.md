# Domain language

Terms the code should use verbatim. Names here are the good seams: a module that
owns one of these concepts owns it everywhere.

## References

**Reference entity** — a workspace-scoped subject the generator can bind an image
to (character, product, environment, prop, style). Lives in `reference_entity`.
Carries a role, a canonical image, a label, a description, and a primary flag.

**Workspace library** — every reference entity in the workspace. Typically far
larger than any one project uses.

**Project roster** — the entities a project has attached (`project_reference`
rows). Generation resolves ids through the roster: an id outside it contributes
nothing, silently. Roster size drives cast defaulting — 0 attaches nothing, 1
auto-casts into every scene, 2+ uses the declared cast with the lead subject
backfilling an empty one.

**Project selection** — the entities a project has locked for generation
(`ProjectSelection.entityIds`). Selecting also attaches, because a lock outside
the roster renders nothing. Unselecting does not detach.

**Lead subject** — the project's primary entity (`project_reference.is_primary`).
Exactly one per project; drives roster-size backfill.

**Scene cast** — the entities a scene casts (`scene.refIds`). Castable only from
the project selection; the workspace library requires an explicit add step.

**Effective refs** — the entities a given scene actually generates with:
the project selection (unless the scene sets `useGlobalReferences: false`) plus
the scene cast, deduplicated. One rule, one module — it has drifted before and
shipped bugs both on the web side and on the agent path.

**Subject cap** — subject-role entities beyond `DEFAULT_CAST_SUBJECT_CAP` are
dropped primary-last at generation to curb identity bleed. Non-subject roles
(environment, style, prop) are never capped. Any surface that counts references
counts the capped set, or it describes a different set than the render.

**Reference map** — the index-keyed text block that tells the model which
reference image is which subject. Falls back description → label → id.

## Timeline

**Timeline document** — the clip-first `EditorDoc` (schemaVersion 2: `clips[]` +
`markers[]`), the single source of truth for the video editor. The seven legacy
per-type arrays are projections of it, not state. It persists as a _version_:
`content_storyboards` appends a row per write, so the document must be
self-contained — restoring version N reproduces what version N rendered without
consulting anything outside it. Provenance belongs here for that reason: the
entities locked for the generation, and the artifacts it produced.

**Editor state** — the mutable desk the document sits on: chat log, media
library, saved hook takes, creative direction, editing preferences. One
overwritten cell (`content_projects.editor_state_json`), last write wins, no
history. Losing it costs convenience, never output.

**Placement test** — if restoring storyboard version N needs a field to come back
with it for N to render as N, the field belongs to the document; otherwise it is
editor state. All sixteen persisted fields now obey it. The last two to move were
`track_flags` and the render-affecting half of `settings`, which the render
filtered clips by while they lived unversioned — so a restored version rendered
differently depending on when it was restored. They persist as the document's
`trackFlags` and `presentation` (aspect, brand, background fill); the editor
state keeps a working copy, but the document's is what a restored version
renders with. The rest of `settings` — `renderBackend`, the voice and template
preferences — stays editor state: it changes how a render is PRODUCED, or what
the next generation does, not what this version contains.

**Command** — a typed, invertible edit over the edit scope (doc + slides +
posts). Every document mutation becomes one; the command stack is undo/redo.
