/* The tool layer and the service layer do not import each other.
 *
 * They used to, one way: `services/assets.ts` and `services/longform-assets.ts`
 * imported constants and helpers out of `tools/_shared/`. That edge is why a tool
 * could not import its service directly — the reverse edge would have closed a
 * cycle — which is the entire reason the 22-member `ToolCaps`/`ToolFlows` bag
 * existed. The shared values were never tools; they sat under `tools/` because
 * that is who imported them first.
 *
 * This is a source-shape test on purpose: the property is about the import graph,
 * which is exactly what reading the source can see and what no runtime assertion
 * would catch. */
import { describe, expect, test } from "vite-plus/test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const AGENT_DIR = join(import.meta.dirname);
const SERVICES_DIR = join(AGENT_DIR, "services");

function tsFilesUnder(dir: string): string[] {
	const out: string[] = [];
	for (const entry of readdirSync(dir)) {
		const path = join(dir, entry);
		if (statSync(path).isDirectory()) out.push(...tsFilesUnder(path));
		else if (entry.endsWith(".ts")) out.push(path);
	}
	return out;
}

const IMPORT_SOURCE = /from\s+"([^"]+)"/g;

function importsOf(path: string): string[] {
	const src = readFileSync(path, "utf8");
	return [...src.matchAll(IMPORT_SOURCE)].map((m) => m[1]!);
}

describe("the agent's tool and service layers point one way", () => {
	test("there are services to check", () => {
		expect(tsFilesUnder(SERVICES_DIR).length).toBeGreaterThan(2);
	});

	test("no service imports from the tool layer", () => {
		const offenders: string[] = [];
		for (const file of tsFilesUnder(SERVICES_DIR)) {
			for (const source of importsOf(file)) {
				// `../tools/...` from services/, or any path that walks into tools/.
				if (/(^|\/)tools\//.test(source))
					offenders.push(`${file.split("/agent/")[1]} -> ${source}`);
			}
		}
		expect(offenders).toEqual([]);
	});

	test("shared values live outside the tool layer", () => {
		// If `_shared` comes back under tools/, the cycle comes back with it.
		const toolFiles = tsFilesUnder(join(AGENT_DIR, "tools"));
		const revived = toolFiles.filter((f) => f.includes("/_shared/"));
		expect(revived).toEqual([]);
	});
});
