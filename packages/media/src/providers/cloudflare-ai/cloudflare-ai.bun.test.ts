/* Attribution regression: the ledger, provider metrics, and the settings picker
 * all read these fields off provider meta, so they are contract, not labels. */
import { beforeEach, describe, expect, it, test } from "bun:test";
import { describeProviderConformance } from "../conformance.ts";
import { PROVIDERS, providersFor } from "../registry.ts";
import { resolveProvider } from "../selection.ts";
import { cloudflareAiProvider } from "./index.ts";

describeProviderConformance({ describe, test, expect }, cloudflareAiProvider);

beforeEach(() => {
	process.env.MALEO_CF_ACCOUNT_ID = "";
	process.env.MALEO_CF_API_TOKEN = "";
	process.env.MALEO_CF_IMAGE_MODEL = "";
	process.env.MALEO_PROVIDER_IMAGE = "";
});

describe("cloudflare-ai provider adapter", () => {
	it("attributes generations to the cloudflare provider", () => {
		expect(cloudflareAiProvider.meta.id).toBe("cloudflare-ai");
		expect(cloudflareAiProvider.meta.label).toBe("Cloudflare Workers AI");
	});

	it("implements image only", () => {
		expect(cloudflareAiProvider.meta.capabilities).toEqual(["image"]);
		expect(cloudflareAiProvider.image).toBeDefined();
		expect(cloudflareAiProvider.tts).toBeUndefined();
	});

	it("reports the configured model, not a load-time snapshot", () => {
		expect(cloudflareAiProvider.meta.models?.image).toBe("@cf/black-forest-labs/flux-2-klein-4b");
		process.env.MALEO_CF_IMAGE_MODEL = "@cf/black-forest-labs/flux-1-schnell";
		// generation/impl.ts records meta.models?.image into the ledger, so this
		// has to follow configuration rather than whatever was set at import.
		expect(cloudflareAiProvider.meta.models?.image).toBe("@cf/black-forest-labs/flux-1-schnell");
	});

	it("is unconfigured for image without credentials, and never ready for other capabilities", async () => {
		expect(await cloudflareAiProvider.meta.health("image")).toBe("unconfigured");
		process.env.MALEO_CF_ACCOUNT_ID = "acct-1";
		process.env.MALEO_CF_API_TOKEN = "token-1";
		expect(await cloudflareAiProvider.meta.health("image")).toBe("ready");
		expect(await cloudflareAiProvider.meta.health("tts")).toBe("unconfigured");
	});
});

describe("cloudflare-ai leads the image capability", () => {
	it("is the default when nothing is selected", () => {
		expect(providersFor("image")[0]?.meta.id).toBe("cloudflare-ai");
		expect(resolveProvider("image").meta.id).toBe("cloudflare-ai");
	});

	it("leads the permissive provider it was chosen over", () => {
		// Positional rather than index-0, so appending a provider later does not
		// turn a correct registry into a failing test. cloudflare-ai leads
		// huggingface because it refuses what its model cannot honour instead of
		// returning a mis-framed image reporting success.
		const ids = PROVIDERS.map((p) => p.meta.id);
		expect(ids.indexOf("cloudflare-ai")).toBeLessThan(ids.indexOf("huggingface"));
	});
});
