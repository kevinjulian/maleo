import { describe, expect, it } from "vite-plus/test";
import { CLOUDFLARE_IMAGE_MODELS, DEFAULT_IMAGE_MODEL_ID, resolveImageModel } from "./models.ts";

describe("Cloudflare image model table", () => {
	it("falls back to the documented default when nothing is configured", () => {
		expect(resolveImageModel(undefined).id).toBe(DEFAULT_IMAGE_MODEL_ID);
		expect(resolveImageModel("  ").id).toBe(DEFAULT_IMAGE_MODEL_ID);
	});

	it("defaults to a model that accepts both dimensions and references", () => {
		const model = resolveImageModel(undefined);
		expect(model.dimensions).not.toBeNull();
		expect(model.maxReferences).toBeGreaterThan(0);
	});

	it("refuses an unknown model id instead of passing it through", () => {
		expect(() => resolveImageModel("@cf/some/other-model")).toThrow(
			/unknown Cloudflare image model/,
		);
	});

	it("names the known ids in the refusal, so the fix is in the message", () => {
		expect(() => resolveImageModel("nope")).toThrow(/flux-2-klein-4b/);
	});

	it("declares flux-1-schnell as accepting neither dimensions nor references", () => {
		const schnell = CLOUDFLARE_IMAGE_MODELS.find((m) => m.id.endsWith("flux-1-schnell"));
		expect(schnell?.dimensions).toBeNull();
		expect(schnell?.maxReferences).toBe(0);
	});
});
