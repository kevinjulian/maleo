import { join } from "node:path";

import { defineConfig } from "vite-plus";
import { configDefaults } from "vite-plus/test/config";

import antiSlop from "./oxlint.config.ts";

/* `tsconfigPaths` resolves each workspace's `paths` aliases, as Bun does. */
const project = (name: string, root: string) => ({
	extends: true,
	resolve: { tsconfigPaths: true },
	test: { name, root },
});

export default defineConfig({
	fmt: {
		useTabs: true,
		/* Machine-written files keep the bytes their writer emits: each is regenerated
		 * by the named tool, and some are compared byte for byte. */
		ignorePatterns: [
			"tools/oxlint/anti-slop/**", // vendored upstream source
			"vendor/vello_shaders/**", // retained upstream source and Cargo metadata
			"crates/renderer/tests/fixtures/*.json", // tests/fixtures/build.ts and production pixel probes
			".agents/**", // agent skills and prompts written by `openspec update`
			".codex/**",
			"packages/shared/src/editor/engine-types.generated.ts", // asserted by crates/editor-core/tests/typescript.rs
			"packages/shared/src/editor/reference/**", // UPDATE_EDITOR_REFERENCE in scripts/editor-time.test.ts
			"packages/shared/src/editor/corpus/**", // scripts/export-editor-corpus.ts
			"apps/api/src/modules/agents/core/__tests__/support/*.json", // written back by parity and acceptance tests
			"apps/api/src/modules/agents/core/runtime/__tests__/support/**/*.json", // planning baseline and differential recorders
			"apps/web/visual/fixtures/*.har", // recorded, then rewritten by visual/fixtures/build.ts
		],
	},
	/* Pre-commit checks the staged paths with the same policy as `vp check`, and
	 * never rewrites them: a fix is `vp check --fix`, run and reviewed by hand.
	 * Type checking of the whole program and the tests stay in `bun run ci`. */
	/* Nothing is cached: every typecheck, test and build runs. Package scripts
	 * are uncached by default and config tasks cached; this states both. */
	run: {
		cache: false,
	},
	/* Portable suites run on Vitest, one project per workspace; `vp test` runs them
	 * all, and a workspace's `test` script runs its own project. Suites whose
	 * production code needs the Bun runtime are named `*.bun.test.ts`: Vitest
	 * excludes them and the workspace script runs them with `bun test .bun.test`.
	 * Bun has no exclude option, so the name is what keeps the two sets disjoint.
	 * The guard runs before every test file, ahead of any runtime import. */
	test: {
		include: ["**/*.test.{ts,tsx,mts}"],
		exclude: [...configDefaults.exclude, "**/*.bun.test.*"],
		setupFiles: [join(import.meta.dirname, "scripts/test-db-guard.ts")],
		/* Coverage measures the Vitest suites only, over two risky groups: the
		 * TypeScript side of editor commands and the credit policy. A file in a
		 * group that no test imports still counts, as uncovered. Bun suites and
		 * Playwright are not measured here. */
		coverage: {
			provider: "v8",
			include: ["packages/shared/src/editor/*.ts", "packages/shared/src/credits.ts"],
			exclude: ["**/*.test.ts", "packages/shared/src/editor/engine-types.generated.ts"],
			reporter: ["text", "json-summary"],
			/* Branch floors from the measured baseline (editor 333/375, credits
			 * 27/35; private historical record).
			 * Raise them as tests land; never lower them to pass. */
			thresholds: {
				"packages/shared/src/editor/*.ts": { branches: 88 },
				"packages/shared/src/credits.ts": { branches: 77 },
			},
		},
		projects: [
			project("inngest", "packages/inngest"),
			project("scripts", "scripts"),
			project("shared", "packages/shared"),
			project("web", "apps/web"),
			project("api", "apps/api"),
			project("db", "packages/db"),
			project("media", "packages/media"),
			project("video", "packages/video"),
			project("stock", "packages/stock"),
			project("auth", "packages/auth"),
		],
	},
	staged: {
		"*": "vp check --no-error-on-unmatched-pattern",
	},
	lint: {
		...antiSlop,
		jsPlugins: [...antiSlop.jsPlugins, { name: "vite-plus", specifier: "vite-plus/oxlint-plugin" }],
		rules: { ...antiSlop.rules, "vite-plus/prefer-vite-plus-imports": "error" },
		options: { typeAware: true, typeCheck: true },
	},
});
