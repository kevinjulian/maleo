/* Guard: UNIFIED_SCHEMA is a template literal, so a backtick anywhere inside it —
 * including inside a SQL `--` comment — silently terminates the string and turns
 * the rest of the file into a syntax error.
 *
 * This is here because it happened three times while writing the reference-model
 * migration: the natural instinct is to quote identifiers as `role` or `kind` in a
 * comment, which is correct Markdown and fatal here. The failure is loud (the
 * module stops parsing) but the cause is not obvious from the error, which points
 * at whatever token follows the stray backtick. */
import { describe, expect, it } from "vite-plus/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SCHEMA_FILE = join(import.meta.dirname, "../../src/db/unified-schema.ts");

/** Extract the lines between the UNIFIED_SCHEMA declaration and its closing backtick. */
function schemaLiteralLines(): { line: string; number: number }[] {
	const lines = readFileSync(SCHEMA_FILE, "utf8").split("\n");
	const start = lines.findIndex((l) => l.startsWith("export const UNIFIED_SCHEMA = `"));
	expect(start).toBeGreaterThanOrEqual(0);
	const out: { line: string; number: number }[] = [];
	for (let i = start + 1; i < lines.length; i++) {
		const line = lines[i]!;
		if (line === "`;" || line === "`") break;
		out.push({ line, number: i + 1 });
	}
	expect(out.length).toBeGreaterThan(100);
	return out;
}

describe("UNIFIED_SCHEMA source hygiene", () => {
	it("contains no backtick inside the template literal", () => {
		const offenders = schemaLiteralLines().filter((l) => l.line.includes("`"));
		expect(offenders.map((o) => `${o.number}: ${o.line.trim()}`)).toEqual([]);
	});

	it("contains no ${ interpolation, which would inject unescaped SQL", () => {
		const offenders = schemaLiteralLines().filter((l) => l.line.includes("${"));
		expect(offenders.map((o) => `${o.number}: ${o.line.trim()}`)).toEqual([]);
	});
});
