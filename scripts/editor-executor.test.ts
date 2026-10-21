/* The engine as the web editor's executor (`migrate-editor-to-shared-rust-core`,
 * task 4.5): every generated corpus edit gives the TS executor's scope and
 * inverse, the rebuilt scope reuses every clip object the edit did not replace,
 * a refused edit leaves the document untouched, and a chain of edits rides one
 * handle without reopening it. */
import { beforeAll, describe, expect, test } from "vite-plus/test";
import { readFileSync } from "node:fs";
import {
	describeFailures,
	engineExecutor,
	EngineCommandError,
	execute,
	executorConformance,
	EXECUTOR_CONFORMANCE_RULES,
	instantiateEngine,
	type EditScope,
	type Engine,
} from "../packages/shared/src/editor/index.ts";
import { generatedEdits } from "../packages/shared/src/editor/engine-parity.ts";
import { buildEditorWasm, executorDigest, loadParityInputs } from "./editor-engine.mts";

let engine: Engine;
beforeAll(async () => {
	engine = await instantiateEngine(readFileSync(buildEditorWasm()));
});

/* The web's own envelope order, so the comparison is of content, not key order. */
const canonical = (scope: EditScope): string =>
	JSON.stringify({
		mediaAssets: scope.mediaAssets,
		doc: scope.doc,
		slides: scope.slides,
		posts: scope.posts,
	});

describe("engine executor", () => {
	test("every generated corpus edit matches the frozen TS reference and shares untouched clips", () => {
		const { corpus } = loadParityInputs();
		// SAFETY: frozen outputs of the retired TS executor in fixture/corpus order.
		const reference = JSON.parse(
			readFileSync(
				new URL("../packages/shared/src/editor/reference/executor-parity.json", import.meta.url),
				"utf8",
			),
		) as { cases: [string, string][]; unchanged: number[] };
		// Caption commands postdate the retired TS executor; their golden fixtures are separate.
		let compared = loadParityInputs().fixtures.filter(
			({ command }) => command.type !== "caption.edit",
		).length;
		for (const scope of corpus) {
			for (const command of generatedEdits(scope)) {
				const executor = engineExecutor(engine);
				const rust = executor.execute(scope, command);
				expect([command.type, executorDigest(rust)], `case ${compared}`).toEqual(
					reference.cases[compared]!,
				);
				if (reference.unchanged.includes(compared))
					expect(rust.scope, `${command.type} changed nothing`).toBe(scope);
				const named = JSON.stringify(command);
				for (const clip of scope.doc.clips.filter(
					(clip) => !named.includes(JSON.stringify(clip.id)),
				)) {
					if (
						rust.scope.doc.clips.some(
							(kept) => kept.id === clip.id && JSON.stringify(kept) === JSON.stringify(clip),
						)
					) {
						expect(rust.scope.doc.clips.find((kept) => kept.id === clip.id)).toBe(clip);
					}
				}
				compared++;
			}
		}
		expect(compared).toBe(reference.cases.length);
		expect(compared).toBeGreaterThan(1000);
		/* Over 1000 engine round trips: 1.4 s alone on Node, several times that
		 * under coverage beside the other suites. */
	}, 30_000);

	test("a chain of edits and its undo ride one handle", () => {
		const scope = loadParityInputs().corpus.find((candidate) => candidate.doc.clips.length >= 2)!;
		const executor = engineExecutor(engine);
		const [first, second] = scope.doc.clips;
		const opened = engine.openCount();
		const a = executor.execute(scope, {
			type: "clip.move",
			id: first!.id,
			patch: { startSec: first!.startSec + 1 },
		});
		const b = executor.execute(a.scope, {
			type: "clip.move",
			id: second!.id,
			patch: { startSec: second!.startSec + 2 },
		});
		const undone = executor.execute(executor.execute(b.scope, b.inverse).scope, a.inverse);
		expect(canonical(undone.scope)).toBe(canonical(scope));
		expect(engine.openCount() - opened).toBe(1);
	});

	test("a refused edit throws and leaves the handle's document as it was", () => {
		const scope = loadParityInputs().corpus.find((candidate) => candidate.doc.clips.length >= 2)!;
		const executor = engineExecutor(engine);
		const moved = executor.execute(scope, { type: "noop" });
		expect(() =>
			executor.execute(moved.scope, { type: "clip.remove", id: "no-such-clip" }),
		).toThrow(EngineCommandError);
		const clip = scope.doc.clips[0]!;
		const after = executor.execute(moved.scope, {
			type: "clip.move",
			id: clip.id,
			patch: { startSec: 3 },
		});
		expect(canonical(after.scope)).toBe(
			canonical(execute(scope, { type: "clip.move", id: clip.id, patch: { startSec: 3 } }).scope),
		);
	});

	test("the engine passes the executor conformance suite on every corpus scope", () => {
		for (const scope of loadParityInputs().corpus.filter(
			(candidate) => candidate.doc.clips.length > 0,
		)) {
			const clip = scope.doc.clips[0]!;
			const report = executorConformance({
				create: () => engineExecutor(engine),
				scope,
				acceptable: { type: "clip.move", id: clip.id, patch: { startSec: clip.startSec + 1 } },
				rejectable: { type: "clip.remove", id: "no-such-clip" },
			});
			expect(describeFailures(report)).toBeUndefined();
			expect(report.checks.map((one) => one.rule)).toEqual([...EXECUTOR_CONFORMANCE_RULES]);
		}
	});

	test("the suite catches an executor that breaks the contract", () => {
		const scope = loadParityInputs().corpus.find((candidate) => candidate.doc.clips.length > 0)!;
		const report = executorConformance({
			create: () => ({ execute: (before) => ({ scope: before, inverse: { type: "noop" } }) }),
			scope,
			acceptable: { type: "clip.move", id: scope.doc.clips[0]!.id, patch: { startSec: 99 } },
			rejectable: { type: "clip.remove", id: "no-such-clip" },
		});
		expect(report.checks.some((one) => !one.passed)).toBe(true);
	});
});
