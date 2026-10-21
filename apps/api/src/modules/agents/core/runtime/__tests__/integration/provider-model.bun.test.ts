/* adopt-mastra-internal-agent 2.7: the agent runs on the user's text selection.
 *
 * A local OpenAI-compatible server stands in for the API, so what the agent
 * actually sends (model, reasoning effort) and what it records (usage, model,
 * provider) are checked against a real HTTP exchange, offline. */
import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Agent } from "@mastra/core/agent";
import { ModelRouterLanguageModel } from "@mastra/core/llm";
import { closeMaleoDb } from "@maleo/db/connection";
import { Semaphore } from "../../../../../../lib/ai-provider/semaphore.ts";
import { listUsageRecords } from "../../../../../../lib/credit-service.ts";
import { setTextProviderSelectionReader } from "../../../../../../lib/text-runner.ts";
import { AgentLanguageModel, agentModel, resolveAgentModel } from "../../model.ts";

interface SeenRequest {
	model?: string;
	reasoning_effort?: string;
	stream?: boolean;
}

const seen: SeenRequest[] = [];
let inFlight = 0;
let maxInFlight = 0;
let delayMs = 0;

const usage = { prompt_tokens: 21, completion_tokens: 7, total_tokens: 28 };

/** One streamed chat-completions chunk: its choices, and usage on the last. */
type ChunkBody = {
	choices: Array<{
		index: number;
		delta: { role?: string; content?: string };
		finish_reason: string | null;
	}>;
	usage?: typeof usage;
};

function sse(model: string): Response {
	const chunk = (body: ChunkBody) =>
		`data: ${JSON.stringify({ id: "c1", object: "chat.completion.chunk", created: 1, model, ...body })}\n\n`;
	const text =
		chunk({
			choices: [
				{ index: 0, delta: { role: "assistant", content: "Planned." }, finish_reason: null },
			],
		}) +
		chunk({ choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage }) +
		"data: [DONE]\n\n";
	return new Response(text, { headers: { "content-type": "text/event-stream" } });
}

const server = Bun.serve({
	port: 0,
	fetch: async (req) => {
		// SAFETY: the agent posts an OpenAI chat-completions body; only these fields are read.
		const body = (await req.json()) as SeenRequest;
		seen.push(body);
		inFlight += 1;
		maxInFlight = Math.max(maxInFlight, inFlight);
		await Bun.sleep(delayMs);
		inFlight -= 1;
		const model = body.model ?? "unknown";
		if (body.stream) return sse(model);
		return Response.json({
			id: "c1",
			object: "chat.completion",
			created: 1,
			model,
			choices: [
				{ index: 0, message: { role: "assistant", content: "Planned." }, finish_reason: "stop" },
			],
			usage,
		});
	},
});
const BASE_URL = `http://127.0.0.1:${server.port}/v1`;

const priorUrl = process.env.MALEO_AI_API_BASE_URL;
const priorKey = process.env.MALEO_AI_API_KEY;

function restoreEnv(name: string, value: string | undefined): void {
	if (value === undefined) delete process.env[name];
	else process.env[name] = value;
}

beforeEach(() => {
	seen.length = 0;
	inFlight = 0;
	maxInFlight = 0;
	delayMs = 0;
	process.env.MALEO_AI_API_BASE_URL = BASE_URL;
	process.env.MALEO_AI_API_KEY = "sk-test";
});
afterEach(() => {
	setTextProviderSelectionReader(() => ({}));
	restoreEnv("MALEO_AI_API_BASE_URL", priorUrl);
	restoreEnv("MALEO_AI_API_KEY", priorKey);
});
afterAll(async () => {
	void server.stop(true);
	await closeMaleoDb();
});

describe("the selected API provider runs the agent", () => {
	test("its model and thinking reach the endpoint, and the call's actual usage is recorded against them", async () => {
		setTextProviderSelectionReader(() => ({
			default: { providerId: "api", model: "gpt-5-mini", thinking: "high" },
		}));
		const resolved = await resolveAgentModel();
		expect(resolved).toMatchObject({ providerId: "api", modelId: "gpt-5-mini", thinking: "high" });

		const before = (await listUsageRecords()).length;
		const result = await new Agent({
			id: "a",
			name: "a",
			instructions: "x",
			model: resolved.model,
		}).generate("plan it");
		expect(result.text).toBe("Planned.");

		expect(seen).toHaveLength(1);
		expect(seen[0]).toMatchObject({ model: "gpt-5-mini", reasoning_effort: "high" });
		const records = await listUsageRecords();
		expect(records.length).toBe(before + 1);
		expect(records[0]).toMatchObject({
			operation: "llm",
			provider: "api",
			model: "gpt-5-mini",
			quantity: 28,
		});
		expect(records[0]!.provider_cost_usd).toBeGreaterThan(0);
	});

	test("a streamed call records its usage when it finishes, and frees its slot", async () => {
		setTextProviderSelectionReader(() => ({ default: { providerId: "api", model: "gpt-5-mini" } }));
		const resolved = await resolveAgentModel();
		const before = (await listUsageRecords()).length;
		const streamed = await new Agent({
			id: "s",
			name: "s",
			instructions: "x",
			model: resolved.model,
		}).stream("plan it");
		expect(await streamed.text).toBe("Planned.");
		expect(seen.at(-1)?.stream).toBe(true);
		const records = await listUsageRecords();
		expect(records.length).toBe(before + 1);
		expect(records[0]).toMatchObject({ provider: "api", model: "gpt-5-mini", quantity: 28 });
	});

	test("with no model chosen, the provider's first declared model runs", async () => {
		setTextProviderSelectionReader(() => ({ default: { providerId: "api" } }));
		expect((await resolveAgentModel()).modelId).toBe("gpt-5.5");
	});
});

describe("a selection the agent cannot run on fails visibly, with no fallback", () => {
	test("an API provider with no key is reported as unconfigured", async () => {
		delete process.env.MALEO_AI_API_KEY;
		setTextProviderSelectionReader(() => ({ default: { providerId: "api" } }));
		await expect(resolveAgentModel()).rejects.toThrow(/provider "api" is unconfigured/);
		expect(seen).toEqual([]);
	});

	test("a provider that is not an API model is refused by name", async () => {
		setTextProviderSelectionReader(() => ({ default: { providerId: "fake" } }));
		await expect(resolveAgentModel()).rejects.toThrow(/text provider "fake" cannot run the agent/);
		expect(seen).toEqual([]);
	});
});

describe("the provider's concurrency limit", () => {
	test("bounds the agent's model calls for their whole length", async () => {
		delayMs = 40;
		const slots = new Semaphore(1);
		const model = () =>
			new AgentLanguageModel(new ModelRouterLanguageModel(agentModel("gpt-5-mini")), slots, {
				provider: "api",
				model: "gpt-5-mini",
			});
		const agent = (id: string) => new Agent({ id, name: id, instructions: "x", model: model() });
		await Promise.all([
			agent("a").generate("one"),
			agent("b").generate("two"),
			agent("c").generate("three"),
		]);
		expect(seen).toHaveLength(3);
		expect(maxInFlight).toBe(1);
		expect(slots.inFlight).toBe(0);
	});
});
