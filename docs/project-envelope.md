# Project envelope

The project envelope is the portable form of one project. Every client reads,
stores and refuses a project in this form. The shared engine owns the rules
(`crates/editor-core/src/envelope.rs`). TypeScript callers use `admitEnvelope`
from `@maleo/shared/editor`.

The envelope holds references to media, not media bytes.

## Format

```json
{
	"format": "maleo.project",
	"formatVersion": 1,
	"compatibility": { "schemaVersion": 2, "minReaderVersion": 1 },
	"project": { "id": "…", "type": "video", "title": "…" },
	"scope": {
		"doc": { "schemaVersion": 2, "clips": [], "markers": [] },
		"mediaAssets": [],
		"slides": [],
		"posts": []
	},
	"head": { "sceneTextClipMigrationVersion": null, "pacingDevices": null, "presentation": null },
	"manifest": [{ "id": "…", "url": "/api/media/…", "state": "ready" }]
}
```

| Field                            | Content                                                                                                                                                                                                                                  |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `format`                         | Always `maleo.project`.                                                                                                                                                                                                                  |
| `formatVersion`                  | The envelope version that wrote this envelope. The current version is 1.                                                                                                                                                                 |
| `compatibility.schemaVersion`    | The document schema version. It must equal `scope.doc.schemaVersion`.                                                                                                                                                                    |
| `compatibility.minReaderVersion` | The lowest envelope version a reader needs to keep every field.                                                                                                                                                                          |
| `project`                        | The project id, its type (`video`, `image` or `text`) and its title.                                                                                                                                                                     |
| `scope`                          | The editable scope that editor commands change: the document, the project media library (`mediaAssets`), slides and posts.                                                                                                               |
| `head`                           | The stored-document fields outside the scope, as the server writes them: `sceneTextClipMigrationVersion`, `pacingDevices`, `presentation`, and the agent's `unit_lifecycle` and `artifacts` when present. The engine does not read them. |
| `manifest`                       | One asset-manifest entry for each media identity that `scope` or `head` references. Each entry has a string `id`, `url` and `state`.                                                                                                     |

`storyboardWithScope(head, scope)` rebuilds the stored storyboard document. No
stored field is lost.

A field that the engine does not know is kept unchanged at every level:
envelope, document, clip, library entry and `head`. Admitting an envelope and
writing it again gives the same JSON text.

## What the envelope excludes

- Editor chrome, chat history and editor settings (`editor_state_json`).
- Media bytes.
- Device paths, `blob:` URLs, large or non-image `data:` URLs, and signed
  storage URLs. Media appears only by stable media URL (`/api/media/<id>`) or
  by external URL. A small inline `data:image/` value is document content and
  is kept.

## Admission and refusal

A client admits an envelope before it replaces any stored project state with
it. Admission does not change anything. A refused envelope leaves the stored
state as it was.

A refusal has a `reason`, the `path` of the field that caused it (for example
`scope.doc.clips[0].video.url`) and a `message`.

| Reason                       | Cause                                                                                         |
| ---------------------------- | --------------------------------------------------------------------------------------------- |
| `wrong-format`               | `format` is not `maleo.project`.                                                              |
| `unsupported-format-version` | `formatVersion` or `compatibility.minReaderVersion` is newer than the engine reads.           |
| `unsupported-schema`         | `scope.doc.schemaVersion` is not 2.                                                           |
| `invalid-field`              | A required field is absent or has the wrong type, or the input is not JSON.                   |
| `missing-manifest-entry`     | `scope` or `head` references a managed media identity that the manifest does not list.        |
| `device-url`                 | A media field holds a `blob:` URL, a large or non-image `data:` URL, or a signed storage URL. |
| `unpreservable-field`        | The engine cannot keep a field. For example, `head` holds a key that the scope owns.          |

The engine finds media references the same way the asset manifest does: every
media field of the document and `head`, and the `url` of each library entry.

## Server route

`GET /projects/:id/envelope` returns the current envelope to a member of the
project's workspace. Other callers get the same `404` as the other project
routes. The route sends the envelope through the engine before it answers. If
the engine refuses the stored project, the route answers `409` with
`{ "error": "envelope_incompatible", "reason", "path" }`.

## Changing the format

- A new field that older readers can ignore keeps `formatVersion` and
  `minReaderVersion`. Unknown fields round-trip, so older readers keep it.
- A change that older readers would lose raises `formatVersion` and
  `minReaderVersion`. Older engines then refuse the envelope with
  `unsupported-format-version` before any write.

## Fixtures

`packages/shared/src/editor/envelope-fixtures/` holds one directory per case,
each with `input.json` and `expected.json`. The Rust suite
(`crates/editor-core/tests/envelope.rs`) and the web wrapper suite
(`packages/shared/src/editor/envelope.test.ts`) run the same files.
`managed-ids.reference.json` holds both media walks equal. Regenerate it with
`MALEO_UPDATE_REFERENCE=1 bun run --cwd packages/shared test src/editor/envelope-references.test.ts`.
