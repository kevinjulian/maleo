import { afterEach, describe, expect, test } from "bun:test";
import { compositionConfigSchema, MOTION_EXAMPLES } from "@maleo/shared";
import {
	authorMotionDesign,
	motionIntentRequest,
	type MotionAuthorInput,
} from "./motion-author.ts";
import { setTextRunnerForTests } from "./text-runner.ts";

const headline = MOTION_EXAMPLES.find((e) => e.presentation === "headline")!;
const input: MotionAuthorInput = {
	sourceText: headline.sourceText,
	presentation: "headline",
	spanSec: headline.spanSec,
	aspect: "16:9",
	visualStyle: "flat editorial, coral accent",
};

/** Answers each prompt in turn and keeps what was asked. */
function scripted(replies: Array<string | Error>) {
	const prompts: string[] = [];
	setTextRunnerForTests(async (prompt) => {
		prompts.push(prompt);
		const reply = replies.shift();
		if (reply instanceof Error) throw reply;
		return { stdout: reply ?? "", stderr: "" };
	});
	return prompts;
}

afterEach(() => setTextRunnerForTests(null));

describe("authorMotionDesign", () => {
	test("compiles and lints a valid first answer", async () => {
		const prompts = scripted([JSON.stringify(headline.intent)]);
		const result = await authorMotionDesign(input);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.attempts).toBe(1);
		expect(compositionConfigSchema.parse(result.config)).toEqual(result.config);
		expect(result.findings).toEqual([]);
		expect(prompts).toHaveLength(1);
		expect(prompts[0]).toContain("Ship faster");
		expect(prompts[0]).toContain("flat editorial, coral accent");
	});

	test("retries once with the refusal attached, then succeeds", async () => {
		const invented = structuredClone(headline.intent);
		invented.layers[1]!.content = "Ship 240% faster";
		const prompts = scripted([
			JSON.stringify(invented),
			"```json\n" + JSON.stringify(headline.intent) + "\n```",
		]);
		const result = await authorMotionDesign(input);
		expect(result).toMatchObject({ ok: true, attempts: 2 });
		expect(prompts[1]).toContain('text "Ship 240% faster" must be quoted from the source text');
	});

	test("returns the failure after two refused answers", async () => {
		scripted(["not json", "{}"]);
		const result = await authorMotionDesign(input);
		expect(result.ok).toBe(false);
		expect(result.attempts).toBe(2);
		expect(!result.ok && result.error).toMatch(/layers/);
	});

	test("does not retry a provider failure", async () => {
		const prompts = scripted([new Error("provider timed out")]);
		expect(await authorMotionDesign(input)).toEqual({
			ok: false,
			error: "provider timed out",
			attempts: 1,
		});
		expect(prompts).toHaveLength(1);
	});
});

test("the request carries the template id and an example of the same presentation", () => {
	const request = motionIntentRequest({ ...input, presentation: "explainer", sourceText: "a\nb" });
	expect(request.id).toBe("prompt:content:authorMotionIntent");
	expect(request.text).toContain("Renders run on your GPU");
	expect(request.text).not.toContain("Your previous answer was refused");
});
