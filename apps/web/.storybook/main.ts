/* Storybook renders the real app stylesheet through Vite.
 *
 * The app itself is bundled by Bun (`bun-plugin-tailwind`); Storybook needs a
 * Vite builder, so `@tailwindcss/vite` compiles the same `src/app/styles.css`
 * entry here. Aliases are read from tsconfig.json `paths`, so the two builds
 * cannot disagree about where `@components/*` points. Vite's own
 * `resolve.tsconfigPaths` is not used: it follows other workspaces' project
 * references and fails on a stale one. */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { StorybookConfig } from "@storybook/react-vite";
import tailwindcss from "@tailwindcss/vite";

const root = fileURLToPath(new URL("..", import.meta.url));
// SAFETY: tsconfig.json is repo-owned, comment-free JSON, and `tsc` fails without compilerOptions.paths.
const { compilerOptions } = JSON.parse(readFileSync(`${root}tsconfig.json`, "utf8")) as {
	compilerOptions: { paths: Record<string, string[]> };
};
const alias = Object.entries(compilerOptions.paths).map(([key, [target]]) => ({
	find: key.replace("/*", ""),
	replacement: root + target!.replace("/*", ""),
}));

const config: StorybookConfig = {
	framework: "@storybook/react-vite",
	stories: ["../stories/**/*.stories.@(ts|tsx)"],
	core: { disableTelemetry: true },
	viteFinal: (vite) => {
		const existing = vite.resolve?.alias ?? [];
		const inherited = Array.isArray(existing)
			? existing
			: Object.entries(existing).map(([find, replacement]) => ({ find, replacement }));
		/* Pre-bundled up front. Discovered lazily, each first visit to a story
		 * using one of these re-optimised mid-session and reloaded with two
		 * copies of React ("Invalid hook call"). The list is the ui primitives'
		 * third-party imports; add one here when a primitive adds one. */
		const include = [
			"@base-ui/react/button",
			"@base-ui/react/checkbox",
			"@base-ui/react/context-menu",
			"@base-ui/react/input",
			"@base-ui/react/menu",
			"@base-ui/react/popover",
			"@base-ui/react/progress",
			"@base-ui/react/separator",
			"@base-ui/react/switch",
			"@base-ui/react/tabs",
			"@base-ui/react/toggle",
			"@base-ui/react/toggle-group",
			"@base-ui/react/tooltip",
			"lucide-react",
			"react-colorful",
		];
		return {
			...vite,
			plugins: [...(vite.plugins ?? []), tailwindcss()],
			resolve: { ...vite.resolve, alias: [...alias, ...inherited] },
			optimizeDeps: {
				...vite.optimizeDeps,
				include: [...(vite.optimizeDeps?.include ?? []), ...include],
			},
		};
	},
};

export default config;
