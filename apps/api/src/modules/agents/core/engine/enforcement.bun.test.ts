/* Declared-capability enforcement at the chokepoints: an operation that sends an
 * undeclared prompt, retrieves without declaring research_topic, or generates
 * media without media:generate is refused before any provider call or charge.
 * The same calls outside an engine operation are unaffected. */
import { afterAll, afterEach, beforeEach, expect, test } from "bun:test";
import { closeMaleoDb } from "@maleo/db/connection";
import { listUsageRecords, listCreditTransactions } from "../../../../lib/credit-service.ts";
import { resetFake, setFakeScript } from "../../../../lib/ai-provider/providers/fake/index.ts";
import { runPrompt, setTextProviderSelectionReader } from "../../../../lib/text-runner.ts";
import { directionRouterRequest, storyFrameRequest } from "../../../../lib/content-generator.ts";
import { meter } from "../../../../lib/metering/meter.ts";
import { runInOperationScope, UndeclaredUseError } from "../../../../lib/capability-scope.ts";
import { getResearchProvider, setResearchProviderForTests } from "../services/research.ts";

const declared = {
	id: "op.route",
	prompts: ["prompt:content:directionRouterPrompt"],
	tools: [],
	capabilities: ["llm:text" as const],
};
let providerCalls = 0;

beforeEach(() => {
	resetFake();
	providerCalls = 0;
	setTextProviderSelectionReader(() => ({ default: { providerId: "fake", model: "fake-1" } }));
	setFakeScript([
		{
			when: () => {
				providerCalls++;
				return true;
			},
			reply: "{}",
		},
	]);
	setResearchProviderForTests({
		search: async () => [],
		readPage: async () => ({ title: "", text: "" }),
	});
});
afterEach(() => {
	resetFake();
	setTextProviderSelectionReader(() => ({}));
	setResearchProviderForTests(null);
});
afterAll(closeMaleoDb);

const llmRows = async () =>
	(await listUsageRecords()).filter((record) => record.operation === "llm").length;

test("an undeclared prompt is refused before the provider and the ledger", async () => {
	const before = await llmRows();
	await expect(
		runInOperationScope(declared, () => runPrompt(storyFrameRequest("seeds", 30, 2, undefined))),
	).rejects.toThrow(
		'operation "op.route" did not declare prompt "prompt:content:storyFramePrompt"',
	);
	await expect(runInOperationScope(declared, () => runPrompt("free text"))).rejects.toBeInstanceOf(
		UndeclaredUseError,
	);
	await expect(
		runInOperationScope({ ...declared, capabilities: [] }, () =>
			runPrompt(directionRouterRequest("x")),
		),
	).rejects.toThrow("did not declare llm:text");
	expect(providerCalls).toBe(0);
	expect(await llmRows()).toBe(before);
	await runInOperationScope(declared, () => runPrompt(directionRouterRequest("x")));
	expect(providerCalls).toBe(1);
});

test("retrieval without research_topic is refused before a provider opens", async () => {
	await expect(runInOperationScope(declared, () => getResearchProvider())).rejects.toThrow(
		'did not declare tool "research_topic"',
	);
	await expect(
		runInOperationScope({ ...declared, tools: ["research_topic"] }, () => getResearchProvider()),
	).resolves.toBeDefined();
});

test("media generation without media:generate is refused before any charge", async () => {
	let ran = false;
	const ledger = (await listCreditTransactions()).length;
	await expect(
		runInOperationScope(declared, () =>
			meter({
				operation: "image",
				quantity: 1,
				provider: "sandbox",
				model: "sandbox",
				reference: "image:test",
				run: async () => {
					ran = true;
					return "ok";
				},
			}),
		),
	).rejects.toThrow("did not declare media:generate");
	expect(ran).toBe(false);
	expect((await listCreditTransactions()).length).toBe(ledger);
});

test("calls outside an engine operation are unaffected", async () => {
	await runPrompt("untemplated text outside any operation");
	await expect(getResearchProvider()).resolves.toBeDefined();
	expect(providerCalls).toBe(1);
});
