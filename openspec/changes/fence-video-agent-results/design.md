## Context

`mergeAgentScenes` (`apps/web/src/models/agent/apply-agent-job.ts`) turns the agent's returned scenes into editor scenes. It pairs them positionally:

```ts
const next = scenes.map((s, i): Scene => {
  const before = prev[i];
  // ... carries forward before?.id, timeline, media, blueprint fields
```

`before` is where every preservation rule lives: the scene's stable `id`, its pinned timeline, its admitted media asset, its cast default, and the blueprint fields the Director reads. The rules themselves are right. Only the way `before` is found is wrong.

`applyAgentScenes` (`use-agent-apply.ts`) then writes the merged scenes and the overlay/character collections through their setters. It never calls `runCommand`, so no settled video result has ever been an undo step, and the fencing added by `make-project-chat-context-aware` has nothing to attach to.

## Goals / Non-Goals

**Goals:**

- Scene identity survives generation, reorder and reload.
- A settled video result is fenced per touched entity and applied scoped.
- One settled video run is one undo step.
- Every preservation rule the merge performs today keeps working.

**Non-Goals:**

- Changing what the merge preserves, or when the agent runs, or what it returns.
- Changing the live (running) patch path, which is a preview and is replaced by the settled pass.
- Re-opening the fencing contracts; they exist and are tested.

## Decisions

### 1. Match by scene id, fall back to position only for genuinely new scenes

The agent returns scenes that mostly correspond to scenes the editor already has. Today correspondence is "same index". It becomes "same stable id", carried on the agent scene the way `key` is carried on slides.

A returned scene with no id is one the model has just drafted: it gets a new id, minted against the ids already in use rather than derived from a count, for the reason established in `storyboard-entity-keys` — a count reuses an id after a delete.

Positional fallback is dropped rather than kept as a safety net. A silent positional match is how the wrong scene gets edited, and a fallback that fires invisibly reintroduces exactly the bug this change removes.

Alternative: keep positional matching and fence around it. Rejected — fencing compares the record the id names, so a wrong id means comparing the wrong record and confidently applying to the wrong scene.

### 2. Carrying is unchanged; only finding changes

Every rule that reads `before` keeps reading it. The diff is the one line that computes `before`, plus the id minting. This is the property most at risk of quiet regression, so the tests pin field preservation per field rather than asserting on the merged scene as a whole — an assertion on the whole object passes for the wrong reason as soon as an unrelated field moves.

### 3. Settled video routes through the command seam

`applyAgentScenes` splits: the running patch stays a direct setter write (it is a preview, replaced by the settled pass), and the settled pass builds one `EditScope` and goes through `settle()` — the same fence-then-apply helper slides and posts use.

Overlays, characters and media admission ride along in that scope rather than staying separate setter writes, so the whole settled result is one undo step instead of one step plus four invisible mutations.

### 4. Scene fingerprints exclude presentation

As with slides: the fingerprint covers content, not the fields that move when something else moves. A scene's id is its identity and not part of its value, and derived timeline values recomputed on every merge are excluded, or every result would look like it touched every scene.

## Risks / Trade-offs

- [The merge is the editor's hottest path] → Change only how `before` is found; pin each preservation rule with its own test.
- [Scenes persisted without ids] → Mint at the load boundary, the same way slide and post keys are repaired.
- [Overlays folded into the scope change undo granularity] → That is the intent: one settled run becomes one undo step. Pin it with a test that undoes a video result and checks the overlays came back too.
- [A held video result is invisible until the chat surface renders it] → `onResultHeld` already exists and is rendered by `redesign-project-chat-workspace`; until then a held result is not applied, which is the safe half.

## Open Questions

Whether the live running patch should also be fenced. Current answer: no — it is a preview that the settled pass replaces, and fencing a preview would stall visible progress for a conflict that may not survive to settlement.
