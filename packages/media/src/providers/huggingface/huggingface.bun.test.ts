/* Attribution regression: the ledger, provider metrics, and the settings picker
 * all read these fields off provider meta, so they are contract, not labels. */
import { beforeEach, describe, expect, it, test } from "bun:test";
import { describeProviderConformance } from "../conformance.ts";
import { PROVIDERS, providersFor } from "../registry.ts";
import { resolveProvider } from "../selection.ts";
import { huggingfaceProvider } from "./index.ts";

describeProviderConformance({ describe, test, expect }, huggingfaceProvider);

beforeEach(() => {
	process.env.HF_TOKEN = "";
	process.env.MALEO_HF_IMAGE_MODEL = "";
	process.env.MALEO_PROVIDER_IMAGE = "";
});

describe("huggingface provider adapter", () => {
	it("attributes generations to the huggingface provider", () => {
		expect(huggingfaceProvider.meta.id).toBe("huggingface");
		expect(huggingfaceProvider.meta.label).toBe("Hugging Face Inference Providers");
	});

	it("implements image only", () => {
		expect(huggingfaceProvider.meta.capabilities).toEqual(["image"]);
		expect(huggingfaceProvider.image).toBeDefined();
		expect(huggingfaceProvider.tts).toBeUndefined();
	});

	it("reports the configured model, not a load-time snapshot", () => {
		expect(huggingfaceProvider.meta.models?.image).toBe("black-forest-labs/FLUX.1-schnell");
		process.env.MALEO_HF_IMAGE_MODEL = "Qwen/Qwen-Image";
		expect(huggingfaceProvider.meta.models?.image).toBe("Qwen/Qwen-Image");
	});

	it("is unconfigured for image without a token, and never ready for other capabilities", async () => {
		expect(await huggingfaceProvider.meta.health("image")).toBe("unconfigured");
		process.env.HF_TOKEN = "hf_test";
		expect(await huggingfaceProvider.meta.health("image")).toBe("ready");
		expect(await huggingfaceProvider.meta.health("tts")).toBe("unconfigured");
	});
});

describe("registering huggingface does not take the default", () => {
	it("leaves cloudflare-ai leading for image", () => {
		expect(providersFor("image")[0]?.meta.id).toBe("cloudflare-ai");
		expect(resolveProvider("image").meta.id).toBe("cloudflare-ai");
	});

	it("is reachable only by explicit selection", () => {
		// Permissive by decision (design D12): it ignores reference inputs and keeps
		// whatever size comes back, so a 9:16 request can succeed as a square. That
		// is a deliberate explicit choice, never a default anyone lands on.
		const ids = PROVIDERS.map((p) => p.meta.id);
		expect(ids.indexOf("huggingface")).toBeGreaterThan(ids.indexOf("cloudflare-ai"));
		expect(resolveProvider("image", { project: { image: "huggingface" } }).meta.id).toBe(
			"huggingface",
		);
	});
});
