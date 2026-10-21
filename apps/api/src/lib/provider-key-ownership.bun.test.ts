/* A configuration value has exactly one editor.
 *
 * `ALLOWED_KEYS` is the raw `.env` table under Security & Privacy — the escape
 * hatch for when a provider's own form is the broken part. A key that appears in
 * BOTH that table and a provider's declaration has two editors with different
 * rules: one generates its input from the declaration, validates the value and
 * writes it to encrypted storage that survives a restart; the other writes a
 * `.env` file that a container restart discards. An operator would have no way to
 * know which one they were using, or which one won.
 */
import { describe, expect, test } from "bun:test";
import { ALLOWED_KEYS } from "./dashboard-env.ts";
import { allDeclaredConfigKeys } from "./provider-catalog.ts";

describe("provider keys have one owner", () => {
	const declared = new Set(allDeclaredConfigKeys().map((k) => k.key));

	test("providers declare configuration at all", () => {
		expect(declared.size).toBeGreaterThan(5);
	});

	test("no declared key is also listed in the raw env table", () => {
		expect([...ALLOWED_KEYS].filter((key) => declared.has(key))).toEqual([]);
	});

	// The raw table still has a job: deploy-level wiring no provider declares.
	test("the raw env table still carries deploy-level keys", () => {
		expect(ALLOWED_KEYS.length).toBeGreaterThan(0);
	});
});
