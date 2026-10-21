# ADR 0003: One workspace-scoped entity owns a reference's identity and role — implementation log

Moved out of [`../0003-reference-entity-model.md`](../0003-reference-entity-model.md) so the decision record states the
decision and its consequences, not the sequence of work that carried it out.
Kept verbatim for history. Nothing here is current guidance.

## Migration state — historical, completed 2026-07-30

**This section is a record of how the transition was staged, not a warning about the code as it
stands.** Verified 2026-08-02: `content_references` is gone from the schema, and every live
fallback listed below has no remaining caller — `legacyProjectRoster` and `deleteContentReference`
are deleted, `resolveRefImages` survives only in comments explaining what replaced it, and
`persistNoteRef` kept its name but writes to `project_note` through `saveProjectNote`. The
follow-up chain at the end of this section is complete.

The DB was **coherent but transitional** while the work was in flight. That was intentional: the
data model and its consumers were landed as separate revertible steps.

| Store                | Status                 | Rows  |
| -------------------- | ---------------------- | ----- |
| `reference_entity`   | **authoritative**      | 89    |
| `project_reference`  | **authoritative**      | 666   |
| `project_style_lock` | authoritative          | 6,270 |
| `project_citation`   | authoritative          | 1,977 |
| `project_speaker`    | authoritative          | 397   |
| `project_note`       | authoritative          | 280   |
| `content_references` | **read fallback only** | 7,224 |

**6,550 rows are duplicated on purpose.** `note` (280) and `style` (6,270) exist in both
`content_references` and their new tables. They were copied but not deleted because
`parse-loaded-project.ts` still reads them, so deleting before the reader moved would silently drop
library entries and every note. `research` (1,977) and `audio` (397) had no remaining reader and
_were_ deleted.

Live fallbacks that exist only until `content_references` retires:

- `legacyProjectRoster` + `resolveRefImages` (`visual-gen.ts`)
- `parseProjectRefs`' legacy branch
- `persistNoteRef` still WRITES `kind='note'`
- the dual id lookup in `deleteContentReference` — correct while two id spaces exist

Follow-up changes, in order: `flatten-project-references` → `consolidate-reference-ui` →
`retire-content-references`.

## Lessons that changed how the work was done

- **Expand → migrate → contract, always.** Every task phrased as "rewrite in place" or "move" had to
  be re-planned (five of them). Adding alongside and deleting later kept the build green throughout;
  the one plan that mattered most — 5.4's gate — was simply wrong, because it gated eviction on the
  server read path moving while the UI still read those rows.
- **Investigate before writing the task list.** The plan asserted `job.characters` was unread (it is
  read, and duplicated on re-apply), that all no-logical-id rows were non-castable (62 are castable),
  that `audio` rows were notes (they are voice definitions), and that `character-files.ts` needed
  folding in (it is dead code, zero importers).
- **Row counts here are contaminated.** The test suite writes the production DB via
  `resolveDataDir()` — 18,150 projects across 137 distinct titles, 3 renders total. Worth fixing
  before any change whose blast radius is measured in those numbers.
