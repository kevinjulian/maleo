import { expect, test } from "bun:test";
import { createTemplateRegistry, promptTemplates } from "./registry.ts";

test("a template with an unknown include fails to load naming both ids", () => {
	expect(() =>
		createTemplateRegistry([
			{ id: "prompt:test:outer", body: [{ type: "include", prompt: "prompt:test:missing" }] },
		]),
	).toThrow('template "prompt:test:outer" includes unknown template "prompt:test:missing"');
});

test("a rendered prompt carries its template id", () => {
	const registry = createTemplateRegistry([
		{ id: "prompt:test:hello", body: ["Hello ", { type: "slot", path: "name" }] },
	]);
	expect(registry.render("prompt:test:hello", { name: "seed" })).toEqual({
		id: "prompt:test:hello",
		text: "Hello seed",
	});
});

test("the production registry loads", () => {
	expect(promptTemplates.list().length).toBeGreaterThanOrEqual(0);
});

const MODEL_REQUESTS = [
	"prompt:content:directionRouterPrompt",
	"prompt:clarification:storyClarificationPrompt",
	"prompt:evidence:evidenceDecisionPrompt",
	"prompt:content:storyFramePrompt",
	"prompt:content:storyDraftPrompt",
	"prompt:sequence:storySequenceDirectionPrompt",
	"prompt:content:generateStyleBible",
	"prompt:content:authorStoryBible",
	"prompt:content:authorMotionIntent",
];

test("every model-request template names its response contract and no fragment does", () => {
	const withResponse = promptTemplates
		.list()
		.filter((template) => template.response)
		.map((template) => template.id);
	expect(new Set(withResponse)).toEqual(new Set(MODEL_REQUESTS));
});

test("a response contract naming unregistered code fails to load", () => {
	expect(() =>
		createTemplateRegistry([
			{
				id: "prompt:test:ask",
				body: ["x"],
				response: { parser: "json.fenced", schema: "nope", policy: "style.bestEffort" },
			},
		]),
	).toThrow('template "prompt:test:ask" names unknown schema "nope"');
});

test("a fragment sent as a model request is refused before any provider call", async () => {
	const { runPrompt, setTextRunnerForTests } = await import("../text-runner.ts");
	let called = false;
	setTextRunnerForTests(async () => {
		called = true;
		return { stdout: "", stderr: "" };
	});
	try {
		await expect(
			runPrompt(
				promptTemplates.render("prompt:constraints:lockedConstraintBlock", {
					locked: { rules: "x" },
				}),
			),
		).rejects.toThrow("is not a model request");
		expect(called).toBe(false);
	} finally {
		setTextRunnerForTests(null);
	}
});
