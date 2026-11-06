/* Envelope admission through the WASM wrapper (`p1-envelope-inspector` task 1.5):
 * the same fixtures `crates/editor-core/tests/envelope.rs` runs, with the same results. */
import { describe, expect, test } from "vite-plus/test";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { editorEngine } from "./engine-registry.ts";
import { admitEnvelope, type EnvelopeRefusal } from "./envelope.ts";
import { SCOPE_OWNED_KEYS } from "./storyboard-scope.ts";

const FIXTURES = join(import.meta.dirname, "envelope-fixtures");

interface Expected {
	envelope?: unknown;
	refusal?: Pick<EnvelopeRefusal, "reason" | "path">;
}

const cases = readdirSync(FIXTURES)
	.filter((name) => existsSync(join(FIXTURES, name, "input.json")))
	.sort()
	.map((name) => ({
		name,
		input: readFileSync(join(FIXTURES, name, "input.json"), "utf8"),
		// SAFETY: the committed fixture file; the Rust suite reads the same shape.
		expected: JSON.parse(readFileSync(join(FIXTURES, name, "expected.json"), "utf8")) as Expected,
	}));

describe("project envelope admission", () => {
	test("the fixture set is present", () => {
		expect(cases.length).toBeGreaterThanOrEqual(12);
	});

	test.each(cases)("$name admits or refuses as recorded", ({ input, expected }) => {
		const admission = admitEnvelope(editorEngine(), input);
		if (expected.refusal) {
			expect(admission.ok).toBe(false);
			if (admission.ok) return;
			expect({ reason: admission.refusal.reason, path: admission.refusal.path }).toEqual(
				expected.refusal,
			);
			expect(admission.refusal.message).not.toBe("");
		} else {
			expect(admission).toEqual({ ok: true, envelope: expected.envelope });
		}
	});

	test("a round trip writes the input's exact text", () => {
		for (const { name, input, expected } of cases) {
			if (expected.refusal) continue;
			const result = editorEngine().envelopeAdmit(input);
			expect(result.ok, name).toBe(true);
			if (result.ok) expect(result.value, name).toBe(JSON.stringify(JSON.parse(input)));
		}
	});

	test("input that is not JSON is refused as an invalid field", () => {
		const admission = admitEnvelope(editorEngine(), "{");
		expect(admission.ok ? null : admission.refusal.reason).toBe("invalid-field");
	});

	test("the engine refuses in head exactly the keys the scope owns", () => {
		const rust = readFileSync(
			join(import.meta.dirname, "../../../../crates/editor-core/src/envelope.rs"),
			"utf8",
		);
		const list = /const SCOPE_KEYS: \[&str; \d+\] =\s*\[([^\]]*)\]/.exec(rust)?.[1] ?? "";
		expect([...list.matchAll(/"([^"]+)"/g)].map((match) => match[1])).toEqual([
			...SCOPE_OWNED_KEYS,
		]);
	});
});
