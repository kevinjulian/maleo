/* Proof for task 4.7: a job names its provider and carries no credential.
 *
 * Job payloads are logged, retried, and persisted by Inngest. A credential placed
 * in one is a credential in the event stream, in retry state, and in every log
 * line that echoes the job — none of which a secret can be withdrawn from
 * afterwards. The worker resolves configuration for itself, which is the whole
 * reason the config service exists. */
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { PROVIDERS } from "../providers/registry.ts";

/* Every key any registered provider declares as a secret. Derived from the
 * registry, never retyped — a hand-written list stops guarding the moment a
 * provider adds a credential. */
const SECRET_KEYS = PROVIDERS.flatMap((provider) =>
	(provider.meta.config ?? []).filter((field) => field.kind === "secret").map((field) => field.key),
);

function sourceFiles(dir: string): string[] {
	const out: string[] = [];
	for (const entry of readdirSync(dir)) {
		const path = join(dir, entry);
		if (statSync(path).isDirectory()) out.push(...sourceFiles(path));
		else if (entry.endsWith(".ts") && !entry.includes(".test.")) out.push(path);
	}
	return out;
}

describe("generation job payloads", () => {
	test("providers declare secrets, so this guard has something to guard", () => {
		expect(SECRET_KEYS.length).toBeGreaterThan(0);
	});

	test("no credential key is named anywhere in the generation path", () => {
		const offenders: string[] = [];
		for (const file of sourceFiles(import.meta.dir)) {
			const text = readFileSync(file, "utf8");
			for (const key of SECRET_KEYS) {
				if (text.includes(key)) offenders.push(`${file} names ${key}`);
			}
		}
		expect(offenders).toEqual([]);
	});

	// The positive half: the payload names the PROVIDER, which is what lets the
	// worker resolve credentials itself instead of being handed them.
	test("the event payload carries a provider id", () => {
		const fn = readFileSync(join(import.meta.dir, "function.ts"), "utf8");
		expect(fn).toContain("providerId");
	});

	test("the event schema declares no credential-shaped field", () => {
		const worker = readFileSync(join(dirname(import.meta.dir), "worker.ts"), "utf8");
		const schema = /SelectionSchema\s*=\s*\{[\s\S]*?\};/.exec(worker)?.[0] ?? "";
		expect(schema).not.toMatch(/token|key|secret|password|credential/i);
	});
});
