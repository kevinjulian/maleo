/* The golden fixtures are the contract for the command vocabulary. They were
 * generated from the closure implementation this replaced, and any other
 * implementation of `execute` (a Rust core behind WASM or FFI) must pass the
 * same files. A fixture changes only with a deliberate change to its command. */
import { describe, expect, test } from "vite-plus/test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { EDITOR_COMMAND_TYPES, type EditorCommand } from "./commands.ts";
import { applyCommand, execute } from "./engine-registry.ts";
import type { EditScope } from "./scope.ts";

const FIXTURES = join(import.meta.dirname, "fixtures");

interface Fixture {
	scope: EditScope;
	command: EditorCommand;
	expectedScope: EditScope;
	expectedInverse: EditorCommand;
	expectedRestored: EditScope;
}

const asJson = <T>(value: T): T => JSON.parse(JSON.stringify(value));

/** Kinds in the vocabulary that have no fixture directory with at least one file. */
function kindsWithoutFixtures(kinds: readonly string[], root = FIXTURES): string[] {
	return kinds.filter((kind) => {
		const dir = join(root, kind);
		return !existsSync(dir) || !readdirSync(dir).some((name) => name.endsWith(".json"));
	});
}

describe("golden fixtures", () => {
	test("every command kind has at least one fixture", () => {
		expect(kindsWithoutFixtures(EDITOR_COMMAND_TYPES)).toEqual([]);
	});

	test("a kind added without a fixture is reported", () => {
		expect(kindsWithoutFixtures([...EDITOR_COMMAND_TYPES, "clip.teleport"])).toEqual([
			"clip.teleport",
		]);
	});

	for (const kind of EDITOR_COMMAND_TYPES) {
		const dir = join(FIXTURES, kind);
		if (!existsSync(dir)) continue;
		for (const name of readdirSync(dir).filter((n) => n.endsWith(".json"))) {
			test(`${kind}/${name}`, () => {
				const fixture: Fixture = JSON.parse(readFileSync(join(dir, name), "utf8"));
				const result = execute(fixture.scope, fixture.command);
				expect(asJson(result.scope)).toEqual(fixture.expectedScope);
				expect(asJson(result.inverse)).toEqual(fixture.expectedInverse);
				expect(asJson(applyCommand(result.scope, result.inverse))).toEqual(
					fixture.expectedRestored,
				);
			});
		}
	}
});

describe("serialization", () => {
	test("a command and its inverse behave the same after a JSON round trip", () => {
		for (const kind of EDITOR_COMMAND_TYPES) {
			const dir = join(FIXTURES, kind);
			for (const name of readdirSync(dir).filter((n) => n.endsWith(".json"))) {
				const fixture: Fixture = JSON.parse(readFileSync(join(dir, name), "utf8"));
				const original = execute(fixture.scope, fixture.command);
				const parsed = execute(fixture.scope, asJson(fixture.command));
				expect(asJson(parsed.scope)).toEqual(asJson(original.scope));
				expect(asJson(applyCommand(parsed.scope, asJson(parsed.inverse)))).toEqual(
					asJson(applyCommand(original.scope, original.inverse)),
				);
			}
		}
	});
});

describe("immutability", () => {
	test("execute never mutates the scope it is given", () => {
		for (const kind of EDITOR_COMMAND_TYPES) {
			const dir = join(FIXTURES, kind);
			for (const name of readdirSync(dir).filter((n) => n.endsWith(".json"))) {
				const fixture: Fixture = JSON.parse(readFileSync(join(dir, name), "utf8"));
				const snapshot = JSON.stringify(fixture.scope);
				execute(fixture.scope, fixture.command);
				expect(JSON.stringify(fixture.scope)).toBe(snapshot);
			}
		}
	});

	test("a command that changes nothing returns the input scope itself", () => {
		const fixture: Fixture = JSON.parse(
			readFileSync(join(FIXTURES, "clip.trim-before", "outside-clip-is-noop.json"), "utf8"),
		);
		expect(applyCommand(fixture.scope, fixture.command)).toBe(fixture.scope);
		expect(applyCommand(fixture.scope, { type: "noop" })).toBe(fixture.scope);
	});
});
