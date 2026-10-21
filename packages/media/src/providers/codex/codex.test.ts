/* Attribution regression: the ledger, provider metrics, and the settings picker
 * all read these fields off provider meta, so they are contract, not labels. */
import { describe, expect, it } from "vite-plus/test";
import { codexProvider } from "./index.ts";

describe("codex provider adapter", () => {
	it("attributes generations to the codex provider and model", () => {
		expect(codexProvider.meta.id).toBe("codex");
		expect(codexProvider.meta.label).toBe("Codex Imagegen");
		expect(codexProvider.meta.models?.image).toBe("codex-imagegen");
	});

	it("implements image only", () => {
		expect(codexProvider.meta.capabilities).toEqual(["image"]);
		expect(codexProvider.image).toBeDefined();
		expect(codexProvider.tts).toBeUndefined();
	});
});
