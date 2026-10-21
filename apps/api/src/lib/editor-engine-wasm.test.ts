/* The production API engine: native/WASM parity, the frozen TS execution
 * contract across every command type, and refusal without partial commit. */
import { beforeAll, describe, expect, test } from "vite-plus/test";
import { readFileSync } from "node:fs";
import {
	EDITOR_COMMAND_TYPES,
	instantiateEngine,
	type EditorCommand,
	type EditScope,
	type Engine,
} from "@maleo/shared/editor";
import {
	buildEditorWasm,
	executorDigest,
	generatedEdits,
	loadParityInputs,
	parityCases,
	runNativeParity,
	runParityCases,
	type ParityCase,
} from "../../../../scripts/editor-engine.mts";

let engine: Engine;
let cases: ParityCase[];

/* Cargo reuses the build, so this costs a fresh build only once per checkout. */
beforeAll(async () => {
	engine = await instantiateEngine(readFileSync(buildEditorWasm()));
	cases = parityCases();
});

describe("editor engine (WASM) in the API runtime", () => {
	test("imports nothing from its host", async () => {
		/* No imports means no clock, no IO and no platform API can be reached. */
		const module = await WebAssembly.compile(readFileSync(buildEditorWasm()));
		expect(WebAssembly.Module.imports(module)).toEqual([]);
	});

	test("matches native Rust on every parity case", () => {
		const inBun = runParityCases(engine, cases);
		expect(runNativeParity(cases)).toEqual(inBun);
	}, 300_000);

	test("matches the frozen TS executor reference", () => {
		const { fixtures, corpus } = loadParityInputs();
		const pairs: { scope: EditScope; command: EditorCommand }[] = [
			// Caption commands postdate this frozen TS reference; verify their new goldens separately.
			...fixtures.filter(({ command }) => command.type !== "caption.edit"),
			...corpus.flatMap((scope) => generatedEdits(scope).map((command) => ({ scope, command }))),
		];
		const compared = new Map<string, number>();
		// SAFETY: frozen TS reference, checked before deleting the prior executor.
		const reference = JSON.parse(
			readFileSync(
				new URL(
					"../../../../packages/shared/src/editor/reference/executor-parity.json",
					import.meta.url,
				),
				"utf8",
			),
		) as { cases: [string, string][] };
		expect(pairs).toHaveLength(reference.cases.length);
		for (const [index, { scope, command }] of pairs.entries()) {
			const result = engine.executeOnce(JSON.stringify(scope), JSON.stringify(command));
			const digest = result.ok ? executorDigest(JSON.parse(result.value)) : "threw";
			expect([command.type, digest], `case ${index}: ${command.type}`).toEqual(
				reference.cases[index]!,
			);
			if (result.ok) compared.set(command.type, (compared.get(command.type) ?? 0) + 1);
		}
		/* Every type in the vocabulary was compared at least once, not just the common ones. */
		expect(
			EDITOR_COMMAND_TYPES.filter((type) => type !== "caption.edit" && !compared.has(type)),
		).toEqual([]);
		expect([...compared.values()].reduce((sum, n) => sum + n, 0)).toBeGreaterThan(500);
	});

	test("a refused edit commits nothing and the handle stays usable", () => {
		const { corpus } = loadParityInputs();
		const scope = corpus.find((candidate) => candidate.doc.clips.length > 0);
		if (!scope) throw new Error("the corpus has a scope with clips");
		const opened = engine.open(JSON.stringify(scope));
		if (!opened.ok) throw new Error(opened.error.message);
		const before = engine.read(opened.value);
		const refusals = [
			`{"type":"clip.setKeys","id":${JSON.stringify(scope.doc.clips[0]!.id)},"property":"opacity","keys":[],"ripple":true}`,
			'{"type":"clip.teleport","id":"x"}',
			`{"type":"clip.move","id":${JSON.stringify(scope.doc.clips[0]!.id)},"patch":{"startSec":1},"ripple":true}`,
			'{"type":"clip.move","id":"x","patch":{"startSec":"soon"}}',
			"not json",
		];
		for (const command of refusals) {
			expect(engine.execute(opened.value, command).ok, command).toBe(false);
			expect(engine.read(opened.value), command).toEqual(before);
		}
		expect(engine.execute(opened.value, '{"type":"noop"}').ok).toBe(true);
		expect(engine.close(opened.value).ok).toBe(true);
		expect(engine.close(opened.value).ok).toBe(false);
		expect(engine.openCount()).toBe(0);
	});
});
