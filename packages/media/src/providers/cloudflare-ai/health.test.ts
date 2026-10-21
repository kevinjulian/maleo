import { beforeEach, describe, expect, it } from "vite-plus/test";
import { cloudflareImageHealth } from "./health.ts";

beforeEach(() => {
	process.env.MALEO_CF_ACCOUNT_ID = "";
	process.env.MALEO_CF_API_TOKEN = "";
	process.env.MALEO_CF_IMAGE_MODEL = "";
});

describe("provider health", () => {
	// The case every CI runner is in. `provider-conformance` requires absence to
	// be a value, not an exception.
	it("reports unconfigured with no credentials, without throwing", () => {
		expect(cloudflareImageHealth()).toBe("unconfigured");
	});

	it("stays unconfigured when only one credential is present", () => {
		process.env.MALEO_CF_ACCOUNT_ID = "acct-1";
		expect(cloudflareImageHealth()).toBe("unconfigured");

		process.env.MALEO_CF_ACCOUNT_ID = "";
		process.env.MALEO_CF_API_TOKEN = "token-1";
		expect(cloudflareImageHealth()).toBe("unconfigured");
	});

	it("is ready once both credentials are present", () => {
		process.env.MALEO_CF_ACCOUNT_ID = "acct-1";
		process.env.MALEO_CF_API_TOKEN = "token-1";
		expect(cloudflareImageHealth()).toBe("ready");
	});

	it("is not ready when the configured model cannot be described", () => {
		process.env.MALEO_CF_ACCOUNT_ID = "acct-1";
		process.env.MALEO_CF_API_TOKEN = "token-1";
		process.env.MALEO_CF_IMAGE_MODEL = "@cf/not/a-model";
		expect(cloudflareImageHealth()).toBe("unconfigured");
	});
});
