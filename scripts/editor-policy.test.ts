/* The Rust edit policies against the kernel they replaced
 * (`migrate-editor-to-shared-rust-core`, tasks 4.2 and 4.10).
 *
 * Until the VUI kernel was retired this ran each generated gesture through the
 * kernel's own transaction machine and through the WASM engine and compared
 * them live. The kernel's answer to every case is now frozen as a digest
 * (`packages/shared/src/editor/reference/edit-policies.json`), so the engine is
 * still held to it: every projection along each gesture and its terminal
 * result, across source clamps, group and link deltas, magnetic and free rows,
 * every overlap strategy, the deliberate and bypass modifiers, refusal and
 * reroute, and one terminal phase. */
import { beforeAll, describe, expect, test } from "vite-plus/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { instantiateEngine, type Engine } from "../packages/shared/src/editor/engine.ts";
import { buildEditorWasm } from "./editor-engine.mts";
import { policyCases, runRust, traceDigest } from "./editor-policy-cases.ts";

const REFERENCE = join(
	import.meta.dirname,
	"../packages/shared/src/editor/reference/edit-policies.json",
);

let engine: Engine;
beforeAll(async () => {
	engine = await instantiateEngine(readFileSync(buildEditorWasm()));
});

describe("edit policies: Rust against the frozen kernel traces", () => {
	test("every generated gesture projects, commits and rejects a second terminal phase as the kernel did", () => {
		// SAFETY: the committed reference file, written once by the kernel comparison it replaces.
		const reference = JSON.parse(readFileSync(REFERENCE, "utf8")) as {
			cases: number;
			digests: string[];
		};
		const cases = policyCases();
		expect(cases).toHaveLength(reference.cases);
		const outcomes = new Map<string, number>();
		const mismatches: string[] = [];
		cases.forEach(({ seed, spec, gesture, endWith }, index) => {
			const trace = runRust(engine, spec, gesture, endWith);
			if (traceDigest(trace) !== reference.digests[index])
				mismatches.push(
					`case ${index}: seed ${seed} ${gesture.policy} ${JSON.stringify(gesture.intent).slice(0, 80)} ${endWith}`,
				);
			const kind = gesture.policy === "trim" ? gesture.intent.kind : "move";
			const key = `${kind}:${(trace.commit as { ok: boolean }).ok ? "ok" : "rejected"}`;
			outcomes.set(key, (outcomes.get(key) ?? 0) + 1);
		});
		expect(mismatches.slice(0, 10)).toEqual([]);
		/* Both outcomes of every policy were exercised, not only the easy ones. */
		for (const kind of ["move", "trim", "ripple", "roll", "slip", "slide"]) {
			expect(outcomes.get(`${kind}:ok`) ?? 0, `${kind} committed`).toBeGreaterThan(0);
		}
		expect(outcomes.get("move:rejected") ?? 0, "a move was rejected").toBeGreaterThan(0);
		expect(engine.gestureOpenCount()).toBe(0);
	}, 300_000);
});
