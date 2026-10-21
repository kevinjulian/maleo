# Live generation, end to end — 2026-08-03

Four changes landed on the generation path in one session and none had been
exercised by a real run. This is that run.

| Change                         | What it moved                                                         |
| ------------------------------ | --------------------------------------------------------------------- |
| `maleo-mono-mntd`              | every TTS call through `meter()` and the workspace quota gate         |
| `consolidate-agent-path-seams` | the reference decode, the tool→service wiring, the subject-cap report |
| `maleo-mono-ovya`              | how a run finalizes when it exhausts its step budget                  |
| `declare-storyboard-document`  | how the agent reads and writes the storyboard                         |

## How it was run without a provider key

No image or TTS key is configured here, which had blocked this twice before. The
repo ships `@maleo/media-provider-sandbox` — a local mock image provider,
registered in `packages/media/src/providers/registry.ts` and selectable per
workspace. `/api/settings/image-provider` reported it `ready` while
`gemini-canvas` was `down`, so the workspace was pointed at it for the run and
restored afterwards.

Project: a 15-second video, roster of four subject entities and one style entity —
four subjects deliberately exceeds `DEFAULT_CAST_SUBJECT_CAP` of 3.

## What the run produced

Seven storyboard versions, 19 clips (7 image, 4 text, 8 audio), 7 markers, through
plan → approval → asset generation.

**The document contract.** The persisted document carries exactly the keys
`writeStoryboardDocument` emits and nothing else:

```
schemaVersion, sceneTextClipMigrationVersion, clips, markers, projectReferences,
captions, pacingDevices, infographicStyle, unit_lifecycle, artifacts
```

`artifacts: [longform_plan]` survived all seven versions — the property the deleted
carry-forward existed to protect.

**Metering.** Usage records for the run:

```
image/image-service    7 calls  $0.2800  (image)
audio/tts-default      4 calls  $0.0060  (character)
llm/codex              3 calls  $0.0000  (estimated_token)
```

7 images at $0.04 each is `PRICES.image` exactly; 84 characters at $0.00126 is
`PRICES.audio` exactly. The decisive evidence for `mntd` is on the audio rows:
`metadata_json = {"workspace":"default"}`. That field is written by `meter()` and
by nothing else — the path this change replaced set no metadata and passed no
workspace, so the quota gate could not have run. It ran.

**The subject cap.** Seven events, one per scene:

```
Skipped 1 reference on "Choose Beans" — over the 3-subject limit: E2E4.
Skipped 1 reference on "Grind Fresh"  — over the 3-subject limit: E2E4.
...
```

The style entity was kept and not capped, which is the two-projection design doing
what it was separated to do. This path was previously silent.

**Finalization.** The run ended `needs_attention` with an `outcome_evaluation` of
`failed` and a final message naming the blocking finding — not the unconditional
`done` the durable driver used to report.

## Cleanup

The test project, its seven storyboard versions, its run rows and the five `E2E*`
entities were removed; `content_projects` is back to its 18,150 baseline. The
workspace image provider was restored to `gemini-canvas`.

**Left in place deliberately:** the usage records and credit ledger entries for
this run (~$0.29 of sandbox spend, 13 credits). Deleting ledger rows without
reversing the account balance would leave the account inconsistent, which is worse
than a small known test entry. Recorded here so the rows are explainable.
