# ADR 0003: One workspace-scoped entity owns a reference's identity and role

- Status: Accepted
- Date: 2026-07-30
- Deciders: Kevin Julian
- Related: OpenSpec `reference-entity-model`, amended `workspace-tenancy` + `generation-cast-selection`

## Context

A "reference" (character, environment, product, style) had no single owner. Eight stores held
overlapping pieces of one concept, and `content_references.kind` carried two orthogonal axes in one
free-text column with no constraint:

```
kind
 ├─ ASSET TYPE:  note · audio · research · image
 └─ SCENE ROLE:  character · environment · product · style · video
```

Every consumer therefore began with a defensive filter, and the five that existed disagreed — three
different exclusion sets and three different fallbacks for an unrecognised value:

| Site                       | Excluded              | Unknown →     |
| -------------------------- | --------------------- | ------------- |
| `projectRoster`            | note, audio           | `"character"` |
| `resolveRefImages`         | note, audio           | `"character"` |
| `parseProjectRefs`         | note, audio, research | raw `kind`    |
| `referencePrimaryTag` (UI) | —                     | `"style"`     |

So one reference rendered as **Style** in the library and bound as **Character** at generation. Two
data-corruption paths followed directly from the same shape:

- **Role edit forked the row.** `upsertContentReference` had `kind` in its dedupe key, so changing a
  primary tag inserted a duplicate instead of updating. The UI deduped by logical id on reload, so
  the edit appeared to work and then reverted.
- **URL collision stole identity.** With no logical-id match, the fallback matched any row sharing
  `(kind, scope, scene_key, voice_key, source_url)` _without comparing the id_, then overwrote that
  row's `meta_json.id`. Two references on one image destroyed one identity; scenes holding the lost
  id generated with no reference and no error.

Identity was doubled throughout: the row PK competed with a client-generated `meta_json.id`, so
nearly every query read `WHERE id = ? OR json_extract(meta_json,'$.id') = ?`.

### Key discovery

`openspec/specs/generation-cast-selection` **already specified** the target model — keyed entities
with stable ids, the exact five-role vocabulary, an image url and a text description, and a roster
that is a subset of the library. It was written; the implementation went its own way. Two of its
requirements were unmet in production:

1. The entity/description model itself.
2. **Roster-size cast defaulting.** `selectCast` encoded the rule (roster 1 → auto-cast; roster ≥2 →
   primary backfills an empty cast) and had _zero production callers_. The live path implemented none
   of it, so a project with exactly one character got no reference on any scene the planner left
   untagged.

This work was therefore substantially about making the code satisfy a spec it already had.

## Decision

**One workspace-scoped `reference_entity` owns identity, role, one canonical image, and a
description. Projects and scenes SELECT entities; they never copy them.**

```
reference_entity  (workspace)          role CHECK: character|environment|product|prop|style
      │
      ▼
project_reference  (project)           project_id · entity_id · scene_key · is_primary
      │                                UNIQUE(project_id, entity_id, ifnull(scene_key,''))
      ▼
scene cast ⊆ project selection ⊆ workspace library
```

Consequences worth stating, because each was a judgement call:

- **Role left every uniqueness key.** That is what makes the role-edit fork impossible rather than
  patched. Same for `meta_json.id` — there is no shadow PK to steal.
- **Workspace scope, not project scope.** This reverses `workspace-tenancy`'s "reachable as project
  references" wording deliberately. Project scope was never actually tenanted: `content_projects` had
  no `workspace` column at all, so it had to be added either way. Every existing project was assigned
  a single `default` workspace — no derivable owner existed (`campaign_id` null on all 18,150 rows,
  `workflow_run.workspace_id` null on all 47).
- **Non-castable things left the reference store.** Citations → `project_citation`; per-project style
  locks → `project_style_lock`; text notes → `project_note`; voice definitions → `project_speaker`. A
  cited webpage reaching the roster meant it could be attached to a scene as a character reference.
- **`is_primary` is per-project, not per-entity.** The same character can lead one project and be
  background in another.
- **No `FOREIGN KEY` clauses.** This schema declares none anywhere and never sets
  `PRAGMA foreign_keys`, so one would be inert and imply enforcement that does not exist. Integrity —
  including the cross-workspace selection refusal — is enforced in the accessors.
- **`origin` left `source_type` in `content_assets`.** Origin was encoded in `source_type`, which is
  half of `UNIQUE(source_type, source_ref)`, so flipping linked↔generated changed the key, inserted a
  row, and orphaned the old one. One real instance of this existed in the data.

## Consequences

**Good**

- Both corruption paths are structurally impossible, not patched.
- One `Role` union and one `roleOf` resolver replace six divergent definitions (a sixth copy turned up
  in `mention-textarea.tsx`, resolving role in the _reverse_ order of every other consumer).
- Roster-size cast defaulting now actually happens.
- The reference map carries each entity's **description**, not its bare label — a far stronger binding
  signal, and what the spec always required.
- ~60 tests encode the specific defects (role-edit-forks-row, url-collision-steals-identity,
  cap-must-continue-not-break, text-save-must-not-clear-image). These outlive the migration.

**Costs and risks**

- Two reference paths coexist until `retire-content-references`. Anyone adding a reader must add it to
  the entity path, not the fallback.
- Migrations are one-shot; DB snapshots are the only rollback.
- `flatten-project-references` is larger than it looks: `ProjectReferences` is embedded in the
  persisted `TimelineDoc` for 8,354 storyboards, making it a document migration.

## Implementation history

The phased rollout notes that used to live here were moved to
[`history/0003-implementation-log.md`](./history/0003-implementation-log.md).
