/* Proof for tasks 3.2-3.4: a declared key is the key the provider actually
 * resolves.
 *
 * Asserted behaviourally rather than by reading the source. A declaration that
 * names a key nothing reads produces a form field an operator fills in that
 * changes nothing — the provider stays unconfigured and the surface offers no
 * clue why. Supplying every required key must make health `ready`; supplying all
 * but one must not. */
import { afterEach, describe, expect, test } from "bun:test";
import { PROVIDERS } from "./registry.ts";
import { setConfigSource, type ConfigSource } from "./config.ts";
import type { ContentProvider } from "./types.ts";

function sourceOf(values: Record<string, string>): ConfigSource {
	return { resolve: (key) => values[key] };
}

/* A plausible value per kind. `url` has to parse as one: a provider that
 * validates its endpoint would otherwise reject the probe and look like a
 * mis-declared key. */
function sampleFor(kind: string, key: string): string {
	if (kind === "url") return "http://127.0.0.1:9999";
	if (kind === "secret") return `test-secret-${key}`;
	return `test-${key}`;
}

function requiredFields(provider: ContentProvider) {
	return (provider.meta.config ?? []).filter((f) => f.required);
}

const declaring = PROVIDERS.filter((p) => requiredFields(p).length > 0);

afterEach(() => setConfigSource(null));

describe("declared configuration is the configuration providers read", () => {
	test("there are providers declaring required configuration", () => {
		expect(declaring.length).toBeGreaterThan(0);
	});

	for (const provider of declaring) {
		const fields = requiredFields(provider);
		const capability = provider.meta.capabilities[0];

		test(`${provider.meta.id}: every required key supplied makes it ready`, async () => {
			const values: Record<string, string> = {};
			for (const field of fields) values[field.key] = sampleFor(field.kind, field.key);
			setConfigSource(sourceOf(values));
			expect(await provider.meta.health(capability)).toBe("ready");
		});

		for (const omitted of fields) {
			test(`${provider.meta.id}: omitting ${omitted.key} leaves it unconfigured`, async () => {
				const values: Record<string, string> = {};
				for (const field of fields) {
					if (field.key === omitted.key) continue;
					values[field.key] = sampleFor(field.kind, field.key);
				}
				setConfigSource(sourceOf(values));
				// If this reports ready, the key is declared required but nothing
				// reads it — a form field that does nothing.
				expect(await provider.meta.health(capability)).not.toBe("ready");
			});
		}
	}
});
