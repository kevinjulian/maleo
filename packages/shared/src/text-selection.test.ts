import { describe, expect, test } from "vite-plus/test";
import { capturedTextSelectionSchema, textSelectionSchema } from "./text-selection.ts";

const selection = { providerId: "api", model: "deepseek-flash" };

describe("text selection contract", () => {
	test.each(["deepseek-flash", "vendor/model:free", "gpt-5.5", "model@2026+tools"])(
		"accepts model identifier %s",
		(model) => expect(textSelectionSchema.parse({ ...selection, model }).model).toBe(model),
	);
	test.each([
		{ providerId: "" },
		{ providerId: "https://endpoint.test" },
		{ model: "" },
		{ model: " model " },
		{ model: "model\nsecret" },
		{ model: "m".repeat(257) },
		{ thinking: "ultra" },
		{ thinking: 1 },
		{ apiKey: "secret" },
		{ baseUrl: "https://endpoint.test" },
		{ credentials: {} },
	])("rejects malformed or private input %j", (invalid) => {
		expect(textSelectionSchema.safeParse({ ...selection, ...invalid }).success).toBe(false);
	});
	test("keeps supported thinking and permits legacy omission", () => {
		expect(textSelectionSchema.parse(selection)).toEqual(selection);
		expect(textSelectionSchema.parse({ ...selection, thinking: "high" }).thinking).toBe("high");
	});
	test("capture accepts only selection and opaque endpoint identity", () => {
		const capture = { selection, endpointIdentity: "a".repeat(64) };
		expect(capturedTextSelectionSchema.parse(capture)).toEqual(capture);
		expect(capturedTextSelectionSchema.safeParse({ ...capture, apiKey: "secret" }).success).toBe(
			false,
		);
		expect(
			capturedTextSelectionSchema.safeParse({ ...capture, endpointIdentity: "url" }).success,
		).toBe(false);
	});
});
