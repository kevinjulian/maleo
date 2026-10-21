/* @maleo/shared's barrel is bundled into the web client, so nothing reachable
 * from it may import a Node-only module.
 *
 * Written after `provider-config.ts` was exported from the barrel and every
 * settings page died at import with "import_node_async_hooks is not defined".
 * Typecheck passed, 1564 web unit tests passed, and the surface was blank —
 * which is why a UI change is not done until it has been opened in a browser.
 *
 * The module itself is fine and still exists; it is reached through the
 * `@maleo/shared/provider-config` subpath by server-side packages only. */
import { describe, expect, test } from "vite-plus/test";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const SRC = import.meta.dirname;

/* Node built-ins with no browser equivalent. `node:async_hooks` is the one that
 * bit; the rest would fail the same way. */
const NODE_ONLY = [
	"node:async_hooks",
	"node:fs",
	"node:path",
	"node:os",
	"node:child_process",
	"node:crypto",
];

const IMPORT_SOURCE = /(?:^|\n)\s*(?:import|export)[\s\S]*?from\s+"([^"]+)"/g;

function importsOf(file: string): string[] {
	return [...readFileSync(file, "utf8").matchAll(IMPORT_SOURCE)].map((m) => m[1]!);
}

function resolveLocal(from: string, source: string): string | null {
	if (!source.startsWith(".")) return null;
	const path = resolve(dirname(from), source);
	return existsSync(path) ? path : null;
}

/** Everything the barrel pulls in, transitively. */
function reachableFromBarrel(): string[] {
	const seen = new Set<string>();
	const queue = [join(SRC, "index.ts")];
	while (queue.length > 0) {
		const file = queue.pop()!;
		if (seen.has(file)) continue;
		seen.add(file);
		for (const source of importsOf(file)) {
			const local = resolveLocal(file, source);
			if (local) queue.push(local);
		}
	}
	return [...seen];
}

describe("the shared barrel stays browser-safe", () => {
	const files = reachableFromBarrel();

	test("the barrel reaches a real graph", () => {
		expect(files.length).toBeGreaterThan(10);
	});

	test("nothing reachable from index.ts imports a Node-only module", () => {
		const offenders: string[] = [];
		for (const file of files) {
			for (const source of importsOf(file)) {
				if (NODE_ONLY.includes(source)) offenders.push(`${file} imports ${source}`);
			}
		}
		expect(offenders).toEqual([]);
	});

	// The module is still shipped — just not through the barrel.
	test("provider-config is reachable by its own subpath", () => {
		expect(existsSync(join(SRC, "provider-config.ts"))).toBe(true);
		expect(files).not.toContain(join(SRC, "provider-config.ts"));
	});
});
