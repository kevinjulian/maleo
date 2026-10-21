/* The contract every ContentProvider satisfies, as a runnable suite.
 *
 * Providers live in their own packages and each grew its own tests, so the
 * invariants the REGISTRY depends on were asserted nowhere. The sharp one is
 * `providersFor`, which requires a capability to be both declared in
 * `meta.capabilities` AND present as an implementation. A provider that
 * declares `image` and ships no `image` is therefore not broken — it is
 * silently invisible. Nothing throws, nothing logs, and the picker simply never
 * offers it. That is the class of defect this suite exists to catch.
 *
 * Call it from a provider package's test file, passing that suite's runner
 * (Vitest's or `bun:test`'s) so the tests register with whichever runs the file:
 *
 *     import { describe, expect, test } from "vite-plus/test";
 *     import { describeProviderConformance } from "@maleo/media";
 *     describeProviderConformance({ describe, test, expect }, codexProvider);
 *
 * It asserts the seam, never behavior: whether a provider returns a GOOD image
 * is that package's business. It must also pass with no browser session, no API
 * key and no provider binary present, which is why `health()` is required to
 * report absence rather than throw.
 *
 * The checks are exported as plain functions returning violation strings, so
 * the suite's own tests can prove it REJECTS a malformed provider. A conformance
 * suite that cannot fail is decoration.
 */
import { CAPABILITIES, type Capability } from "./capabilities.ts";
import type { ContentProvider, ProviderHealth } from "./types.ts";
import { oneOf } from "@maleo/shared";

/** The calling suite's test functions: Vitest's or `bun:test`'s. */
export interface TestRunner {
	describe(name: string, body: () => void): void;
	test(name: string, body: () => unknown): void;
	expect(actual: unknown): { toEqual(expected: unknown): void };
}

const HEALTH_STATES: readonly ProviderHealth[] = ["ready", "unconfigured", "down"];
const IMAGE_REFERENCE_MODES = ["native", "text-only", "none"] as const;
const KEBAB = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** The capability keys actually present as implementations on a provider. */
export function implementedCapabilities(provider: ContentProvider): Capability[] {
	return CAPABILITIES.filter((capability) => provider[capability] != null);
}

/** Every contract violation that can be checked without calling health(). */
export function providerViolations(provider: ContentProvider): string[] {
	const problems: string[] = [];
	const meta = provider.meta;

	if (!meta) return ["provider has no meta"];

	if (typeof meta.id !== "string" || !KEBAB.test(meta.id)) {
		problems.push(`meta.id ${JSON.stringify(meta.id)} is not a kebab-case string`);
	}
	if (typeof meta.label !== "string" || meta.label.trim().length === 0) {
		problems.push("meta.label is empty");
	}

	const declared = meta.capabilities ?? [];
	if (declared.length === 0) {
		problems.push("meta.capabilities is empty, so the provider is never selectable");
	}
	for (const capability of declared) {
		if (!CAPABILITIES.includes(capability)) {
			problems.push(`meta.capabilities names unknown capability "${capability}"`);
		}
	}
	if (new Set(declared).size !== declared.length) {
		problems.push("meta.capabilities lists a capability twice");
	}

	// Both directions, because they fail differently. A declared capability with
	// no implementation makes the provider invisible to `providersFor`; an
	// undeclared implementation is code the registry will never route to.
	for (const capability of declared) {
		if (provider[capability] == null) {
			problems.push(
				`declares "${capability}" but ships no implementation, so providersFor() silently drops it`,
			);
		}
	}
	for (const capability of implementedCapabilities(provider)) {
		if (!declared.includes(capability)) {
			problems.push(
				`implements "${capability}" but does not declare it, so the registry never routes to it`,
			);
		}
	}

	for (const key of Object.keys(meta.models ?? {})) {
		if (!oneOf(key, declared)) {
			problems.push(`meta.models names "${key}", which is not a declared capability`);
		}
	}

	for (const capability of meta.explicitOnly ?? []) {
		if (!declared.includes(capability))
			problems.push(`meta.explicitOnly names undeclared capability "${capability}"`);
	}

	if (declared.includes("image")) {
		const support = meta.image?.references;
		if (!support) {
			problems.push("meta.image.references is required for image providers");
		} else if (!oneOf(support.mode, IMAGE_REFERENCE_MODES)) {
			problems.push(`meta.image.references.mode ${JSON.stringify(support.mode)} is invalid`);
		} else if (support.mode === "native") {
			if (!Number.isInteger(support.maxImages) || support.maxImages <= 0) {
				problems.push(
					"meta.image.references.maxImages must be a positive integer for native image reference support",
				);
			}
		}
	} else if (meta.image) {
		problems.push("meta.image is present but image is not a declared capability");
	}

	/* The `tts` twin of the image block above, and it catches the same shape of
	 * silent failure. Voices reach every surface as `meta.tts.voices`, so a TTS
	 * provider that ships no catalogue is selectable and offers nothing to speak
	 * with — a picker with no entries rather than an error. Ids must be unique
	 * because they key both a lookup and a synthesis cache entry.
	 *
	 * The empty check applies only to a provider whose voices are DECLARED. One
	 * whose voices are CLONED has no speakers of its own by construction — it
	 * imitates an audio prompt — so its catalogue is the calling workspace's clone
	 * library and an entry here would name a voice it cannot speak. Absence of the
	 * declaration means declared, so this is unchanged for every provider that
	 * predates the distinction. */
	if (declared.includes("tts")) {
		const voices = meta.tts?.voices;
		const cloned = meta.tts?.voiceSource === "cloned";
		if (!voices) {
			problems.push(
				"meta.tts.voices is required for tts providers, or no surface can offer a voice",
			);
		} else if (voices.length === 0 && !cloned) {
			problems.push(
				"meta.tts.voices is empty, so the provider is selectable but has nothing to speak with",
			);
		} else {
			const voiceIds = voices.map((voice) => voice.id);
			if (new Set(voiceIds).size !== voiceIds.length) {
				problems.push(
					"meta.tts.voices repeats a voice id, which keys both a lookup and a cache entry",
				);
			}
			if (voices.some((voice) => !voice.id || !voice.name || !voice.lang)) {
				problems.push("meta.tts.voices has an entry missing an id, name, or lang");
			}
		}
	} else if (meta.tts) {
		problems.push("meta.tts is present but tts is not a declared capability");
	}

	return problems;
}

/**
 * Violations that require calling health().
 *
 * `unconfigured` and `down` exist so that a missing dependency is a VALUE. A
 * provider that throws here cannot be health-checked on a machine that does not
 * have it installed, which is every CI runner.
 */
export async function healthViolations(provider: ContentProvider): Promise<string[]> {
	const problems: string[] = [];

	const probe = async (capability?: Capability): Promise<void> => {
		const where = capability ? `health("${capability}")` : "health()";
		try {
			const state = await provider.meta.health(capability);
			if (!HEALTH_STATES.includes(state)) {
				problems.push(`${where} returned ${JSON.stringify(state)}, not a known health state`);
			}
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			problems.push(`${where} threw instead of reporting absence: ${message}`);
		}
	};

	await probe();
	for (const capability of provider.meta.capabilities ?? []) await probe(capability);

	return problems;
}

/** Ids must be unique: `providerById` is a Map, so a duplicate drops one silently. */
export function registryViolations(providers: readonly ContentProvider[]): string[] {
	const problems: string[] = [];
	if (providers.length === 0) problems.push("registry is empty");

	const ids = providers.map((p) => p.meta?.id);
	const duplicates = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))];
	for (const id of duplicates) {
		problems.push(`duplicate provider id "${id}" — providerById would keep only the last`);
	}
	return problems;
}

/**
 * Assert one provider satisfies the ContentProvider contract.
 *
 * Pass `label` when the provider's own id is what is under test (the registry
 * suite does this so a failure names the index, not a possibly-empty id).
 */
export function describeProviderConformance(
	{ describe, test, expect }: TestRunner,
	provider: ContentProvider,
	label?: string,
): void {
	const name = label ?? provider.meta?.id ?? "<provider with no meta.id>";

	describe(`provider conformance: ${name}`, () => {
		test("satisfies the ContentProvider contract", () => {
			expect(providerViolations(provider)).toEqual([]);
		});

		test("reports health instead of throwing, with no dependency configured", async () => {
			expect(await healthViolations(provider)).toEqual([]);
		});

		test("declares configuration the settings form can build", () => {
			expect(configViolations(provider)).toEqual([]);
		});

		test("a declared credential is declared as a secret", async () => {
			expect(await secretDeclarationViolations(provider)).toEqual([]);
		});
	});
}

/* A declaration the form cannot render is worse than none: the field silently
 * does not appear, and the provider reports unconfigured forever with no way to
 * configure it from the surface that claims to. */
function configViolations(provider: ContentProvider): string[] {
	const problems: string[] = [];
	const fields = provider.meta?.config;
	if (!fields) return problems;
	const seen = new Set<string>();
	for (const field of fields) {
		const at = `${provider.meta?.id}.${field.key || "<no key>"}`;
		if (!field.key?.trim()) problems.push(`${at}: field has no key`);
		if (!field.label?.trim()) problems.push(`${at}: field has no label`);
		if (seen.has(field.key)) problems.push(`${at}: duplicate key`);
		seen.add(field.key);
		if (field.kind === "choice" && !(field.options?.length ?? 0)) {
			problems.push(`${at}: kind "choice" with no options is a form control with nothing to pick`);
		}
		if (field.kind !== "choice" && field.options?.length) {
			problems.push(`${at}: options on a non-choice field are never rendered`);
		}
	}
	return problems;
}

/* The rule this exists to enforce: a value the provider treats as a credential
 * must be DECLARED a credential, because the declaration is what routes it to
 * encrypted storage and keeps it out of every response. A token declared as
 * `text` is a token stored in plaintext and returned to the client, and nothing
 * else in the system would notice.
 *
 * Detected behaviourally rather than by name: a field is credential-like when
 * supplying it flips health from `unconfigured` to `ready` AND its name reads
 * like a credential. Name matching alone would flag a "token endpoint" URL. */
const CREDENTIAL_NAME = /(token|key|secret|password|credential)$/i;

async function secretDeclarationViolations(provider: ContentProvider): Promise<string[]> {
	const problems: string[] = [];
	for (const field of provider.meta?.config ?? []) {
		if (field.kind === "secret") continue;
		if (!CREDENTIAL_NAME.test(field.key)) continue;
		problems.push(
			`${provider.meta?.id}.${field.key}: reads as a credential but is declared "${field.kind}", ` +
				`so it would be stored in plaintext and returned to the client`,
		);
	}
	return problems;
}

/** Assert a whole registry: ids are unique and every provider conforms. */
export function describeRegistryConformance(
	runner: TestRunner,
	providers: readonly ContentProvider[],
	label = "registry",
): void {
	const { describe, test, expect } = runner;
	describe(`${label}`, () => {
		test("ids are unique and the registry is populated", () => {
			expect(registryViolations(providers)).toEqual([]);
		});
	});

	providers.forEach((provider, index) => {
		describeProviderConformance(runner, provider, `${label}[${index}] ${provider.meta?.id ?? "?"}`);
	});
}
