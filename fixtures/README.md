# Fixtures

Real persisted payloads, redacted, kept outside any package's `src/` so they are
never bundled and are reachable from every workspace by path.

## `persisted-storyboards.json`

Five video `content_storyboards.storyboard_json` documents sampled from a
development database, one per generation still present in the data:

| key            | shape                                                                                                     |
| -------------- | --------------------------------------------------------------------------------------------------------- |
| `v2`           | clip-first (`schemaVersion: 2`), with `captions` and agent `artifacts`                                    |
| `v2Flat`       | clip-first carrying a flat `projectReferences.entityIds` selection                                        |
| `preV2Full`    | the legacy per-type arrays, plus `media_assets` and `chat` from when editor state lived in the storyboard |
| `preV2Snake`   | a sparse legacy document                                                                                  |
| `preV2Minimal` | the oldest shape — `outline` and `scenes` only                                                            |

Collections are trimmed to two entries each: these pin decode rules per field, not
volume. Every url and every string over 40 characters is replaced with a
placeholder, so the shape is real and the content is not.

Sampled 2026-08-03 for `declare-storyboard-document`. Counts at that date: 86,249
`v2`, 4,593 `v2Flat`, 923 pre-v2. No four-bucket `projectReferences` remained in
the data — `flatten-project-references` had already retired it.
