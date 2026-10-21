/* Proves the conformance suite REJECTS the shapes it claims to. A suite that
 * cannot fail is decoration, so every rule gets a fixture that violates it. */
import { describe, expect, test } from "vite-plus/test";
import {
	providerViolations,
	healthViolations,
	registryViolations,
	implementedCapabilities,
} from "./conformance.ts";
import type { ContentProvider, ProviderHealth, ProviderMeta, TtsVoice } from "./types.ts";

const noopImage = { generate: async () => ({ url: "x" }) };
const noopTts = { synthesize: async () => ({ path: "x" }) };

/** `meta` is overridden field-by-field, so it is Partial independently of the rest. */
type ProviderOverride = Omit<Partial<ContentProvider>, "meta"> & { meta?: Partial<ProviderMeta> };

function provider(over: ProviderOverride = {}): ContentProvider {
	const { meta: metaOver, ...rest } = over;
	return {
		meta: {
			id: "fixture",
			label: "Fixture",
			capabilities: ["image"],
			image: { references: { mode: "native", maxImages: 4 } },
			health: async (): Promise<ProviderHealth> => "unconfigured",
			...metaOver,
		},
		image: noopImage,
		...rest,
	} as ContentProvider;
}

function voice(): TtsVoice {
	return { id: "v1", name: "Voice", desc: "Female · US English", gender: "female", lang: "en-US" };
}

/** The tts counterpart of `provider()`: declares tts, ships one, catalogues one voice. */
function ttsProvider(over: ProviderOverride = {}): ContentProvider {
	const { meta: metaOver, ...rest } = over;
	return provider({
		meta: { capabilities: ["tts"], image: undefined, tts: { voices: [voice()] }, ...metaOver },
		image: undefined,
		tts: noopTts,
		...rest,
	});
}

describe("a conforming provider", () => {
	test("has no violations", () => {
		expect(providerViolations(provider())).toEqual([]);
	});

	test("passes the health probe", async () => {
		expect(await healthViolations(provider())).toEqual([]);
	});
});

describe("declaration and implementation must agree", () => {
	test("rejects a declared capability with no implementation", () => {
		// The silently-invisible case: providersFor() filters it out without a word.
		const p = { meta: provider().meta } as ContentProvider;
		const problems = providerViolations(p);
		expect(problems.some((m) => m.includes("ships no implementation"))).toBe(true);
	});

	test("rejects an implementation that is not declared", () => {
		const p = provider({ tts: noopTts });
		const problems = providerViolations(p);
		expect(problems.some((m) => m.includes("does not declare it"))).toBe(true);
	});

	test("accepts a provider implementing several declared capabilities", () => {
		const p = provider({
			meta: { capabilities: ["image", "tts"], tts: { voices: [voice()] } },
			tts: noopTts,
		});
		expect(providerViolations(p)).toEqual([]);
	});
});

describe("meta shape", () => {
	test("rejects an empty id", () => {
		expect(
			providerViolations(provider({ meta: { id: "" } })).some((m) => m.includes("kebab-case")),
		).toBe(true);
	});

	test("rejects a non-kebab id", () => {
		expect(
			providerViolations(provider({ meta: { id: "Codex_Imagegen" } })).some((m) =>
				m.includes("kebab-case"),
			),
		).toBe(true);
	});

	test("rejects an empty label", () => {
		expect(
			providerViolations(provider({ meta: { label: "  " } })).some((m) => m.includes("label")),
		).toBe(true);
	});

	test("rejects no declared capabilities", () => {
		const p = { meta: { ...provider().meta, capabilities: [] } } as unknown as ContentProvider;
		expect(providerViolations(p).some((m) => m.includes("never selectable"))).toBe(true);
	});

	test("rejects a duplicate capability", () => {
		const p = provider({ meta: { capabilities: ["image", "image"] } });
		expect(providerViolations(p).some((m) => m.includes("twice"))).toBe(true);
	});

	test("rejects a model naming an undeclared capability", () => {
		const p = provider({ meta: { models: { tts: "some-voice" } } });
		expect(providerViolations(p).some((m) => m.includes("meta.models"))).toBe(true);
	});

	test("accepts a model naming a declared capability", () => {
		const p = provider({ meta: { models: { image: "imagegen" } } });
		expect(providerViolations(p)).toEqual([]);
	});

	test("rejects an image provider without reference support metadata", () => {
		const p = provider({ meta: { image: undefined } });
		expect(providerViolations(p).some((m) => m.includes("meta.image.references"))).toBe(true);
	});

	test("rejects an invalid image reference mode", () => {
		const p = provider({
			meta: { image: { references: { mode: "sometimes" as "native", maxImages: 1 } } },
		});
		expect(providerViolations(p).some((m) => m.includes("references.mode"))).toBe(true);
	});

	test("rejects native image references without a positive maxImages", () => {
		const p = provider({ meta: { image: { references: { mode: "native", maxImages: 0 } } } });
		expect(providerViolations(p).some((m) => m.includes("maxImages"))).toBe(true);
	});

	test("accepts text-only image reference support", () => {
		const p = provider({ meta: { image: { references: { mode: "text-only" } } } });
		expect(providerViolations(p)).toEqual([]);
	});

	test("rejects image metadata on a non-image provider", () => {
		const p = provider({
			meta: {
				capabilities: ["tts"],
				models: { tts: "voice" },
				tts: { voices: [voice()] },
				image: { references: { mode: "none" } },
			},
			image: undefined,
			tts: noopTts,
		});
		expect(providerViolations(p).some((m) => m.includes("meta.image"))).toBe(true);
	});
});

/* The `tts` twin of the image rules. A TTS provider whose catalogue is missing
 * is selectable and offers nothing to speak with, which reads as an empty
 * picker rather than an error — the same silent shape `providersFor` has. */
describe("tts metadata", () => {
	test("accepts a tts provider that declares voices", () => {
		expect(providerViolations(ttsProvider())).toEqual([]);
	});

	test("rejects a tts provider with no voice catalogue", () => {
		const p = ttsProvider({ meta: { tts: undefined } });
		expect(providerViolations(p).some((m) => m.includes("meta.tts.voices is required"))).toBe(true);
	});

	test("rejects an empty voice catalogue", () => {
		const p = ttsProvider({ meta: { tts: { voices: [] } } });
		expect(providerViolations(p).some((m) => m.includes("nothing to speak with"))).toBe(true);
	});

	test("rejects an empty catalogue from a provider that declares its voices", () => {
		const p = ttsProvider({ meta: { tts: { voices: [], voiceSource: "declared" } } });
		expect(providerViolations(p).some((m) => m.includes("nothing to speak with"))).toBe(true);
	});

	/* A cloning provider has no speakers of its own: it imitates an audio prompt,
	 * so its catalogue is a workspace's clone library and an entry declared here
	 * would name a voice it cannot actually speak. */
	test("accepts an empty catalogue from a provider whose voices are cloned", () => {
		const p = ttsProvider({ meta: { tts: { voices: [], voiceSource: "cloned" } } });
		expect(providerViolations(p)).toEqual([]);
	});

	test("still applies the entry rules to a cloning provider that does declare one", () => {
		const p = ttsProvider({ meta: { tts: { voices: [voice(), voice()], voiceSource: "cloned" } } });
		expect(providerViolations(p).some((m) => m.includes("repeats a voice id"))).toBe(true);
	});

	test("rejects a repeated voice id, which keys a lookup and a cache entry", () => {
		const p = ttsProvider({ meta: { tts: { voices: [voice(), voice()] } } });
		expect(providerViolations(p).some((m) => m.includes("repeats a voice id"))).toBe(true);
	});

	test("rejects a voice missing its language, which a language-locked voice needs", () => {
		const p = ttsProvider({ meta: { tts: { voices: [{ ...voice(), lang: "" }] } } });
		expect(providerViolations(p).some((m) => m.includes("missing an id, name, or lang"))).toBe(
			true,
		);
	});

	test("rejects tts metadata on a non-tts provider", () => {
		const p = provider({ meta: { tts: { voices: [voice()] } } });
		expect(providerViolations(p).some((m) => m.includes("meta.tts is present"))).toBe(true);
	});
});

describe("health must report absence, not throw", () => {
	test("rejects a provider whose health throws", async () => {
		const p = provider({
			meta: {
				health: async () => {
					throw new Error("codex not installed");
				},
			},
		});
		const problems = await healthViolations(p);
		expect(problems.some((m) => m.includes("threw instead of reporting absence"))).toBe(true);
		expect(problems.some((m) => m.includes("codex not installed"))).toBe(true);
	});

	test("rejects an unknown health state", async () => {
		const p = provider({
			meta: { health: async () => "probably-fine" as unknown as ProviderHealth },
		});
		expect((await healthViolations(p)).some((m) => m.includes("not a known health state"))).toBe(
			true,
		);
	});

	test("probes each declared capability, not only the provider", async () => {
		let calls = 0;
		const p = provider({
			meta: {
				capabilities: ["image", "tts"],
				health: async () => {
					calls += 1;
					return "unconfigured" as ProviderHealth;
				},
			},
			tts: noopTts,
		});
		await healthViolations(p);
		expect(calls).toBe(3); // once bare, once per declared capability
	});

	test("accepts every known state", async () => {
		for (const state of ["ready", "unconfigured", "down"] as ProviderHealth[]) {
			const p = provider({ meta: { health: async () => state } });
			expect(await healthViolations(p)).toEqual([]);
		}
	});
});

describe("registry", () => {
	test("rejects duplicate ids", () => {
		const problems = registryViolations([provider(), provider()]);
		expect(problems.some((m) => m.includes("duplicate provider id"))).toBe(true);
	});

	test("rejects an empty registry", () => {
		expect(registryViolations([]).some((m) => m.includes("empty"))).toBe(true);
	});

	test("accepts distinct ids", () => {
		expect(registryViolations([provider(), provider({ meta: { id: "other" } })])).toEqual([]);
	});
});

describe("implementedCapabilities", () => {
	test("lists only what is present", () => {
		expect(implementedCapabilities(provider())).toEqual(["image"]);
		expect(implementedCapabilities(provider({ tts: noopTts }))).toEqual(["image", "tts"]);
	});
});
