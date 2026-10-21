# Authored visual fixtures

`fixture-data.ts`, `editor-chat-data.ts` and the fixture builders own synthetic
content for the browser suite. Never record real accounts, workspaces, provider
credentials, projects, media or authenticated traffic into these files.

Run `bun run check:fixtures` from the repository root to verify reproducibility.
After editing authored fixture data, run `bun run --cwd apps/web visual/fixtures/build.ts`
and review the generated HAR changes. CI runs the check on every change.

Refresh screenshot baselines only against these authored fixtures. Inspect each
changed image for intended UI changes and synthetic content before accepting it.
Current screenshot baselines remain tracked source assertions; browser output
under `visual/.output` and reports are disposable.
