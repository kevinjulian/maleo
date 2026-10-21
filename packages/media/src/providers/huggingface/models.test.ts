import { beforeEach, describe, expect, it } from "vite-plus/test";
import { resolveDimensions } from "./dims.ts";
import { huggingFaceImageHealth } from "./health.ts";
import { DEFAULT_IMAGE_MODEL, billingOrganization, configuredImageModel } from "./models.ts";

beforeEach(() => {
	process.env.HF_TOKEN = "";
	process.env.HF_BILL_TO = "";
	process.env.MALEO_HF_IMAGE_MODEL = "";
});

describe("model configuration", () => {
	it("falls back to the documented default", () => {
		expect(configuredImageModel()).toBe(DEFAULT_IMAGE_MODEL);
		process.env.MALEO_HF_IMAGE_MODEL = "   ";
		expect(configuredImageModel()).toBe(DEFAULT_IMAGE_MODEL);
	});

	it("passes an operator-configured model through, since breadth is the point", () => {
		process.env.MALEO_HF_IMAGE_MODEL = "ByteDance/Hyper-SD";
		expect(configuredImageModel()).toBe("ByteDance/Hyper-SD");
	});

	it("reports a billing organisation only when one is configured", () => {
		expect(billingOrganization()).toBeUndefined();
		process.env.HF_BILL_TO = "acme";
		expect(billingOrganization()).toBe("acme");
	});
});

describe("aspect to dimensions", () => {
	it("maps each supported aspect", () => {
		expect(resolveDimensions("1:1")).toEqual({ width: 1080, height: 1080 });
		expect(resolveDimensions("16:9")).toEqual({ width: 1920, height: 1080 });
		expect(resolveDimensions("9:16")).toEqual({ width: 1080, height: 1920 });
		expect(resolveDimensions("4:5")).toEqual({ width: 1080, height: 1350 });
	});

	it("defaults an absent or unknown aspect to a square", () => {
		expect(resolveDimensions(undefined)).toEqual({ width: 1080, height: 1080 });
		expect(resolveDimensions("21:9")).toEqual({ width: 1080, height: 1080 });
	});
});

describe("provider health", () => {
	// The case every CI runner is in.
	it("reports unconfigured with no token, without throwing", () => {
		expect(huggingFaceImageHealth()).toBe("unconfigured");
	});

	it("is ready once a token is present", () => {
		process.env.HF_TOKEN = "hf_test";
		expect(huggingFaceImageHealth()).toBe("ready");
	});

	it("stays ready regardless of the configured model, since a cold model is a generation error", () => {
		process.env.HF_TOKEN = "hf_test";
		process.env.MALEO_HF_IMAGE_MODEL = "some-org/cold-model";
		expect(huggingFaceImageHealth()).toBe("ready");
	});
});
