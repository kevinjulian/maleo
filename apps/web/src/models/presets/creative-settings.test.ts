/* `presetSettings` replaced `bundle.settings as Partial<GlobalSettings>` at six
 * call sites. That cast claimed a shape nothing had checked, so a preset written
 * by a build that disagreed about a field's type applied it anyway.
 *
 * The narrowing is only safe if the parse stays as tolerant as the cast it
 * replaces — a bundle is a SNAPSHOT and may predate a field, carry one added
 * later, or hold a wrong-kinded value. Those are the cases asserted here. */
import { describe, expect, test } from "vite-plus/test";
import { presetSettings } from "./creative-settings.ts";

describe("presetSettings", () => {
	test("carries a stored block through unchanged", () => {
		const stored = {
			aspectRatio: "16:9",
			timelineTemplateId: "tpl-1",
			voiceProvider: "kokoro",
			voice: "Kore",
			language: "en",
			renderBackend: "lambda",
		} as const;

		expect(presetSettings(stored)).toEqual({ ...stored });
	});

	test("drops a field whose stored value is the wrong kind, keeping the rest", () => {
		// The cast applied this verbatim: `aspectRatio` reached the editor as a
		// number typed `string`.
		const out = presetSettings({ aspectRatio: 16, voice: "Kore" });

		expect(out.aspectRatio).toBeUndefined();
		expect(out.voice).toBe("Kore");
	});

	/* This used to check the stored provider against a closed union of the two
	 * provider names the app knew. That union is gone: the set of TTS providers is
	 * the server's registry, and a copy of it here could only go stale. It also
	 * failed the wrong way — a document stored before a provider was retired
	 * dropped the field, so the id could never be reported back to an operator as
	 * the stale configuration it was.
	 *
	 * The check that remains is the one this layer can actually make: a provider
	 * id is a string. Whether it names a registered provider is decided where the
	 * registry is, and an unknown one falls back to the effective provider. */
	test("keeps any provider id, and rejects a value that is not one", () => {
		expect(presetSettings({ voiceProvider: 42 }).voiceProvider).toBeUndefined();
		expect(presetSettings({ voiceProvider: "kokoro" }).voiceProvider).toBe("kokoro");
		// A retired provider survives parsing rather than taking the document with it.
		expect(presetSettings({ voiceProvider: "canvas" }).voiceProvider).toBe("canvas");
		// "" is a member: it means "follow the app-wide default".
		expect(presetSettings({ voiceProvider: "" }).voiceProvider).toBe("");
	});

	test("keeps a key written by a later build", () => {
		const out = presetSettings({ voice: "Kore", futureKey: 42 }) as Record<string, unknown>;

		expect(out.futureKey).toBe(42);
	});

	test("a bundle that predates the block parses to nothing, not a throw", () => {
		expect(presetSettings(undefined)).toEqual({});
		expect(presetSettings("not-an-object")).toEqual({});
		expect(presetSettings({})).toEqual({});
	});
});
