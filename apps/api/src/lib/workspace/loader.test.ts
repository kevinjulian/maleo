import { afterEach, beforeEach, describe, expect, test } from "vite-plus/test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadWorkspaceFromString } from "./loader.ts";
import { resolveWriterStyle } from "@maleo/shared";

let tmp: string;

beforeEach(() => {
	tmp = mkdtempSync(join(tmpdir(), "maleo-test-"));
});

afterEach(() => {
	rmSync(tmp, { recursive: true, force: true });
});

describe("workspace loader", () => {
	test("loads minimal valid workspace", () => {
		const yaml = `name: minimal\n`;
		const p = loadWorkspaceFromString(yaml);
		expect(p.name).toBe("minimal");
		expect(p.character.type).toBe("real");
		expect(p.voice.punctuation_style).toBe("standard");
	});

	describe("writer_style", () => {
		test("a workspace that never chose one loads with none", () => {
			const p = loadWorkspaceFromString(`name: minimal\n`);
			expect(p.writer_style).toBeUndefined();
			expect(resolveWriterStyle(p.writer_style)).toBeUndefined();
		});

		test("a chosen key loads and resolves to its profile", () => {
			const p = loadWorkspaceFromString(`name: styled\nwriter_style: plainspoken_reportage\n`);
			expect(p.writer_style).toBe("plainspoken_reportage");
			expect(resolveWriterStyle(p.writer_style)?.key).toBe("plainspoken_reportage");
		});

		/* Retiring a profile must not make an existing workspace unloadable. The key
		 * is stored as a plain string precisely so this degrades to "no writer style"
		 * at resolution rather than failing the parse. */
		test("a retired or misspelled key still loads and resolves to none", () => {
			const p = loadWorkspaceFromString(`name: stale\nwriter_style: retired_profile\n`);
			expect(p.name).toBe("stale");
			expect(resolveWriterStyle(p.writer_style)).toBeUndefined();
		});

		test("a malformed value does not take the rest of the config down with it", () => {
			const p = loadWorkspaceFromString(
				`name: broken\nwriter_style: [not, a, key]\ncharacter:\n  type: fictional\n`,
			);
			expect(p.name).toBe("broken");
			expect(p.character.type).toBe("fictional");
			expect(resolveWriterStyle(p.writer_style)).toBeUndefined();
		});
	});

	test("loads workspace identity anchors", () => {
		const yaml = `
name: kunti
character:
  type: fictional
  archetype: kuntilanak
voice:
  signature_laugh: hihihi
  common_interjections: [yailah, eh]
  forbidden_words: [sebagai AI]
  punctuation_style: minimal_caps
  emoji_usage: rare
`;
		const p = loadWorkspaceFromString(yaml);
		expect(p.character.type).toBe("fictional");
		expect(p.voice.signature_laugh).toBe("hihihi");
		expect(p.voice.forbidden_words).toContain("sebagai AI");
	});

	test("rejects missing name", () => {
		expect(() => loadWorkspaceFromString(`language:\n  primary: en\n`)).toThrow();
	});

	test("rejects invalid enum value", () => {
		expect(() =>
			loadWorkspaceFromString(`name: bad\nvoice:\n  emoji_usage: sometimes\n`),
		).toThrow();
	});
});

/* `WorkspaceSchema` declares a dozen keys of a document real workspaces carry
 * twenty-nine of. As a closed `z.object` it dropped the rest, which is how a
 * consumer handed the parsed result whole could read `workspace.niche` as
 * `undefined` with no error.
 *
 * It cannot be closed correctly either: `collections_${collection}` is a key
 * built from a caller's argument, so the key set is not statically knowable.
 *
 * These fail against the closed schema, naming the keys that vanish. */
describe("workspace config keys survive the parse", () => {
	const config = [
		"name: acme",
		"niche: woodworking",
		"tone: dry",
		"audience: hobbyists",
		"platforms:",
		"  - tiktok",
		"tools:",
		"  - shopee_search",
		"collections_characters:",
		"  - id: anna",
		"image_policy:",
		"  default_preset: wide",
	].join("\n");

	test("keeps a key the schema does not declare", () => {
		const parsed = loadWorkspaceFromString(config) as Record<string, unknown>;

		expect(parsed.niche).toBe("woodworking");
		expect(parsed.tone).toBe("dry");
		expect(parsed.audience).toBe("hobbyists");
		expect(parsed.platforms).toEqual(["tiktok"]);
	});

	/* `tools:` was a declared key until the route it gated was removed. A config
	 * written before that removal still carries it, and must still load: the key
	 * is now undeclared like `niche`, preserved rather than rejected. */
	test("keeps a grant key that used to be declared", () => {
		const parsed = loadWorkspaceFromString(config) as Record<string, unknown>;

		expect(parsed.tools).toEqual(["shopee_search"]);
	});

	test("keeps a runtime-keyed section no schema could declare", () => {
		// `collections_${collection}` — the reason this object cannot be closed.
		const parsed = loadWorkspaceFromString(config) as Record<string, unknown>;

		expect(parsed.collections_characters).toEqual([{ id: "anna" }]);
	});

	test("loses no key the file carries", () => {
		const parsed = loadWorkspaceFromString(config) as Record<string, unknown>;
		const inFile = config
			.split("\n")
			.filter((line) => /^\w/.test(line))
			.map((line) => line.split(":")[0]!);

		expect(inFile.filter((key) => !(key in parsed))).toEqual([]);
	});

	test("still checks the keys it does declare", () => {
		// Passthrough is not "anything goes" — a declared key keeps its contract.
		expect(() =>
			loadWorkspaceFromString("name: acme\nvoice:\n  emoji_usage: sometimes\n"),
		).toThrow();
	});
});
