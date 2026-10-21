/* Kokoro against the shared provider contract, alongside its siblings. The
 * registry suite covers it too, but a provider-local file is what fails with
 * this provider's name on it rather than an index into PROVIDERS. */
import { describe, expect, it, test } from "vite-plus/test";
import { describeProviderConformance } from "../conformance.ts";
import { kokoroProvider } from "./index.ts";

describeProviderConformance({ describe, test, expect }, kokoroProvider);

describe("kokoro provider surface", () => {
	it("declares tts and ships an implementation, so providersFor sees it", () => {
		expect(kokoroProvider.meta.capabilities).toEqual(["tts"]);
		expect(kokoroProvider.tts).toBeDefined();
	});

	it("refuses to synthesize with no service configured, naming the variable", async () => {
		const prior = process.env.MALEO_KOKORO_URL;
		try {
			delete process.env.MALEO_KOKORO_URL;
			await expect(
				kokoroProvider.tts!.synthesize({ text: "hello" }, { workspaceId: "w" }),
			).rejects.toThrow(/MALEO_KOKORO_URL/);
		} finally {
			if (prior === undefined) delete process.env.MALEO_KOKORO_URL;
			else process.env.MALEO_KOKORO_URL = prior;
		}
	});
});
