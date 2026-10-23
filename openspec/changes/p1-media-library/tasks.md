# Tasks

## 1. Library storage

- [ ] 1.1 Add migration `0011_project_media_assets.sql` (D1, D2, D5: the table, nullable `content_project_commands.version`, `content_projects.media_library_imported_at`) and confirm the migration suites pass on a throwaway cluster.
- [ ] 1.2 Add `packages/db/src/db/project-media-assets.ts` (read the library, apply a before/after difference, admit one asset with a versionless `media.admit` entry) with `*.bun.test.ts` cases for insert, update, delete, URL deduplication and the versionless entry.
- [ ] 1.3 Import the stored list on first scope read (D5), with tests for editor-state and document lists merged by URL, a second read importing nothing, and two concurrent first reads importing once.
- [ ] 1.4 Prune versionless entries behind the oldest retained versioned entry (D4), with a test that a pruned range reads as a snapshot and `MAX(seq)` never decreases; document the table and rule in `packages/db/AGENTS.md` and `docs/CODEMAPS/db.md`, and confirm `bun run check:references` passes.

## 2. Server

- [ ] 2.1 Give the server scope the rows' `mediaAssets` (`storyboard-scope.ts` and `lib/project-commands.ts`), and write the row difference with a versioned or versionless entry (D2); route tests for a library-only submission (no new version), admit and place in one submission (one version, both commands), and a snapshot carrying the library.
- [ ] 2.2 Admit a finished import through the db function (D3), with a media-import integration test that the row and a `media.admit` entry exist after finish and a second finish adds nothing.
- [ ] 2.3 Move server-side generators that admit media (agent persistence, caption realignment, generated narration) to the same function, with one test per path that the asset is a row.
- [ ] 2.4 Return the library from rows in the project read and ignore `mediaAssets` in `PUT /projects/:id/editor-state`, with tests for both; describe the changes in `docs/CODEMAPS/backend.md` and confirm `bun run check:references` passes.

## 3. Web client

- [ ] 3.1 Load the library from the project read and remove `withLocalMedia` from `command-sync.ts`, keeping pending-import assets when a delivered library is applied; update the `command-sync.test.ts` media case to expect the server's library plus local pending assets.
- [ ] 3.2 Drop `mediaAssets` from the editor-state bundle in `use-content-persistence.ts`, compare `mediaAssets` in `sync-bridge.ts` (a change around the stack is sent as `media.update`), and move remaining direct list writers to `media.admit`; Vitest cases for both bridge rules.
- [ ] 3.3 In the running app with two browser contexts on one project, upload a file in one and confirm it appears in the other's library before it is placed; admit the same stock result in both and confirm one asset; record the steps in this task's proof.
- [ ] 3.4 Measure the library-carrying `scope.replace` size on the largest development project and record it in this task's proof.
- [ ] 3.5 Update `docs/CODEMAPS/timeline-editor.md` and the `project-command-log` spec's media-library rule (now server-owned), add a `CHANGELOG.md` `Unreleased` entry, and confirm `bun run check:references` passes.

## 4. Integration checks

- [ ] 4.1 Confirm `cargo test`, `bun run typecheck`, `bun run test` and `bunx vp check` pass.
- [ ] 4.2 Confirm `openspec validate p1-media-library --strict` passes.
