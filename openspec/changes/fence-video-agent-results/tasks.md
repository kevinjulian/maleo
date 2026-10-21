## 1. Scene Identity

- [ ] 1.1 Carry a stable scene identity on the agent wire so a returned scene names the scene it corresponds to, minting one for a scene the model newly drafted. Proof: tests cover round-trip of an existing scene, a newly drafted one, and a mix.
- [ ] 1.2 Match `mergeAgentScenes` by stable scene id instead of `prev[i]`, with no positional fallback. Proof: tests prove a reorder during a run still pairs each returned scene with the same editor scene, and that an unmatched scene is treated as new rather than matched to whatever sits at its index.
- [ ] 1.3 Repair scenes persisted without a stable id at the load boundary. Proof: fixture tests cover an id-less legacy document and one with duplicate ids.

## 2. Preservation Is Unchanged

- [ ] 2.1 Pin every field the merge carries from `before` with its own assertion — id, pinned timeline, admitted media asset, cast default, and each blueprint field. Proof: per-field tests fail if any single rule stops carrying, rather than one whole-object assertion that passes for the wrong reason.

## 3. Fenced, Scoped, Undoable

- [ ] 3.1 Build one `EditScope` for a settled video result covering scenes, overlays and characters, and route it through the existing `settle()` fence-then-apply helper. Proof: tests cover apply, hold-on-conflict, and preservation of an unrelated scene edited during the run.
- [ ] 3.2 Keep the live running patch as a direct preview write, unfenced. Proof: test shows a running patch still renders while a conflicting edit exists, and that the settled pass is what fences.
- [ ] 3.3 Make one settled video run one undo step covering scenes, overlays and characters together. Proof: editor command test undoes a settled video result and asserts all three came back.
- [ ] 3.4 Exclude identity and derived timeline values from the scene fingerprint. Proof: test proves a reorder or a recomputed derived value does not mark every scene as touched.

## 4. Verification

- [ ] 4.1 Update the owning codemap with video result fencing and scene identity. Proof: `bun run check:references` passes.
- [ ] 4.2 Add a `CHANGELOG.md` Unreleased entry. Proof: `bun run check:version` and `bun run check:references` pass.
- [ ] 4.3 Drive the live app through a video run with a concurrent scene edit, a held conflict, and an undo. Proof: browser evidence records assertions and screenshots for each path.
- [ ] 4.4 Run `bun run ci` and `openspec validate fence-video-agent-results --strict`. Proof: both commands pass, or remaining unrelated failures are reported with exact output and ownership.
