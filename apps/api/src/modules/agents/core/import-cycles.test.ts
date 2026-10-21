/* The agent path's runtime import graph is a DAG.
 *
 * `tool-layer-direction.test.ts` asserts a narrower property — no file under
 * `services/` names a `tools/` path — and it passed while sixteen cycles existed,
 * because every one of them routed through a third file. The shape was always the
 * same: `trace.ts` imported `registry.ts` to read a tool's `kind`, `registry.ts`
 * eagerly loads all eleven tool barrels, each tool reaches its service, and every
 * service wants `pushNote`. One import edge, sixteen cycles.
 *
 * So assert the property itself. Type-only imports are erased at runtime and
 * cannot cycle, so they don't count; a value import does. */
import { describe, expect, test } from "vite-plus/test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

const AGENT_DIR = join(import.meta.dirname);
// The agent path reaches out of its own directory and back: registry -> tools ->
// services -> ../content-generator.ts -> registry. That cycle was invisible to a
// scan of `agent/` alone, and it bit as a module-init error the first time a test
// imported the registry before anything else had. Scan the parent, and treat the
// agent directory as the subject.
const LIB_DIR = join(AGENT_DIR, "..");

function tsFilesUnder(dir: string): string[] {
	const out: string[] = [];
	for (const entry of readdirSync(dir)) {
		const path = join(dir, entry);
		if (statSync(path).isDirectory()) out.push(...tsFilesUnder(path));
		else if (entry.endsWith(".ts") && !entry.endsWith(".test.ts")) out.push(path);
	}
	return out;
}

// One import statement, captured whole so the clause can be inspected for `type`.
const IMPORT_STATEMENT = /import\s+([\s\S]*?)\s*from\s+"([^"]+)"/g;

// A statement contributes a runtime edge unless the whole clause is type-only
// (`import type { X }`) or every named specifier is (`import { type X, type Y }`).
function isTypeOnly(clause: string): boolean {
	const trimmed = clause.trim();
	if (trimmed.startsWith("type ")) return true;
	const named = trimmed.match(/\{([\s\S]*)\}/);
	if (!named) return false;
	const specifiers = named[1]!
		.split(",")
		.map((s) => s.trim())
		.filter(Boolean);
	return specifiers.length > 0 && specifiers.every((s) => s.startsWith("type "));
}

// Value imports of other files inside the agent path, as repo-relative paths.
function runtimeEdges(path: string): string[] {
	const src = readFileSync(path, "utf8");
	const out: string[] = [];
	for (const [, clause, source] of src.matchAll(IMPORT_STATEMENT)) {
		if (!source!.startsWith(".")) continue;
		if (isTypeOnly(clause!)) continue;
		const target = resolve(dirname(path), source!);
		if (target.startsWith(LIB_DIR)) out.push(target);
	}
	return out;
}

function findCycle(graph: Map<string, string[]>): string[] | null {
	const state = new Map<string, "open" | "done">();
	const stack: string[] = [];
	function walk(node: string): string[] | null {
		if (state.get(node) === "done") return null;
		if (state.get(node) === "open") return [...stack.slice(stack.indexOf(node)), node];
		state.set(node, "open");
		stack.push(node);
		for (const next of graph.get(node) ?? []) {
			const cycle = walk(next);
			if (cycle) return cycle;
		}
		stack.pop();
		state.set(node, "done");
		return null;
	}
	for (const node of graph.keys()) {
		const cycle = walk(node);
		if (cycle) return cycle;
	}
	return null;
}

describe("the agent path has no runtime import cycles", () => {
	const files = tsFilesUnder(LIB_DIR);
	const graph = new Map(files.map((f) => [f, runtimeEdges(f)]));

	test("there is a graph to check", () => {
		expect(files.length).toBeGreaterThan(40);
		expect([...graph.values()].flat().length).toBeGreaterThan(40);
	});

	test("no file reaches itself through value imports", () => {
		const cycle = findCycle(graph);
		const readable = cycle?.map((f) => relative(LIB_DIR, f)).join(" -> ") ?? null;
		expect(readable).toBeNull();
	});

	test("the trace leaf does not import the registry", () => {
		// The single edge that used to close every one of those cycles. The effect
		// kind rides out on the tool result instead (tool-executor stamps it).
		const trace = join(AGENT_DIR, "trace.ts");
		expect(runtimeEdges(trace).map((f) => relative(AGENT_DIR, f))).not.toContain("registry.ts");
	});
});
