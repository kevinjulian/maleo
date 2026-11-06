/* The envelope's media walk (`p1-envelope-inspector` design E3) against the
 * manifest's. `collectAssetReferences` decides which identities a manifest
 * lists; the Rust envelope admission walks the scope again to refuse a missing
 * entry. Both are held to `envelope-fixtures/managed-ids.reference.json`: this
 * suite pins the TS walk to it, and `crates/editor-core/tests/envelope.rs` pins
 * the Rust walk to the same file. Regenerate with `MALEO_UPDATE_REFERENCE=1`. */
import { describe, expect, test } from "vite-plus/test";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { collectAssetReferences } from "../asset-manifest.ts";

const EDITOR = import.meta.dirname;
const REFERENCE = join(EDITOR, "envelope-fixtures", "managed-ids.reference.json");

interface Source {
	name: string;
	scope: Record<string, unknown>;
	head: Record<string, unknown>;
}

const readJson = (path: string): Record<string, unknown> =>
	JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;

/* Every scope the repository holds: command fixtures (before and after), the
 * sanitized corpus, and the envelope fixtures with their heads. */
function sources(): Source[] {
	const found: Source[] = [];
	const fixtures = join(EDITOR, "fixtures");
	for (const kind of readdirSync(fixtures).sort())
		for (const file of readdirSync(join(fixtures, kind)).sort()) {
			if (!file.endsWith(".json")) continue;
			const fixture = readJson(join(fixtures, kind, file));
			for (const key of ["scope", "expectedScope"] as const)
				if (fixture[key])
					found.push({
						name: `fixtures/${kind}/${file}#${key}`,
						scope: fixture[key] as Record<string, unknown>,
						head: {},
					});
		}
	const corpus = join(EDITOR, "corpus", "scopes");
	for (const file of readdirSync(corpus).sort())
		found.push({ name: `corpus/scopes/${file}`, scope: readJson(join(corpus, file)), head: {} });
	const envelopes = join(EDITOR, "envelope-fixtures");
	for (const name of readdirSync(envelopes).sort()) {
		const input = join(envelopes, name, "input.json");
		if (!existsSync(input)) continue;
		const envelope = readJson(input);
		found.push({
			name: `envelope-fixtures/${name}`,
			scope: envelope.scope as Record<string, unknown>,
			head: envelope.head as Record<string, unknown>,
		});
	}
	return found;
}

/** The managed identities the manifest route would list for this scope and head, sorted. */
function manifestIds({ scope, head }: Source): string[] {
	const { mediaAssets, ...document } = scope;
	const ids = collectAssetReferences({ ...document, head }, mediaAssets).flatMap((ref) =>
		ref.type === "managed" ? [ref.id] : [],
	);
	return [...new Set(ids)].sort();
}

describe("envelope media walk", () => {
	const actual = Object.fromEntries(sources().map((source) => [source.name, manifestIds(source)]));

	test("the manifest walk matches the recorded reference the Rust walk is held to", () => {
		if (process.env.MALEO_UPDATE_REFERENCE === "1")
			writeFileSync(REFERENCE, `${JSON.stringify(actual, null, "\t")}\n`);
		expect(actual).toEqual(readJson(REFERENCE));
	});

	test("the reference covers scopes that reference managed media", () => {
		expect(Object.values(actual).filter((ids) => ids.length > 0).length).toBeGreaterThan(10);
	});
});
