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
import {
	currentTextSelection,
	runPrompt,
	setTextProviderSelectionReader,
} from "../../../../../../lib/text-runner.ts";
import { withTextSelection } from "../../../../../../lib/text-selection-scope.ts";
import { z } from "zod";
import { createEngineRegistry } from "../../../engine/registry.ts";
import { defineOperation } from "../../../engine/types.ts";
import { runToolFlow } from "../../../engine/host.ts";
import { runValidatedTool } from "../../../tool-executor.ts";
import type { WorkflowDefinition } from "@maleo/shared";
import { AgentLanguageModel, agentModel, resolveAgentModel } from "../../model.ts";
import {
	textEndpointIdentity,
	discoverTextModels,
} from "../../../../../../lib/ai-provider/providers/api/discovery.ts";
import { capturedTextSelectionSchema } from "@maleo/shared";
import { savedVideoRun } from "../support/video-fixture.ts";
import { loadRun, saveRun } from "../../../run-repository.ts";
import { runContext } from "../../../service.ts";
import { clearAgentJobsForTests } from "../../../session-store.ts";

interface SeenRequest {
	model?: string;
	reasoning_effort?: string;
	stream?: boolean;
}

const seen: SeenRequest[] = [];
let inFlight = 0;
let maxInFlight = 0;
let delayMs = 0;
let availableModels = ["gpt-5-mini", "gpt-5.5"];

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
		if (new URL(req.url).pathname.endsWith("/models"))
			return Response.json({ data: availableModels.map((id) => ({ id })) });
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
	availableModels = ["gpt-5-mini", "gpt-5.5"];
	process.env.MALEO_AI_API_BASE_URL = BASE_URL;
	process.env.MALEO_AI_API_KEY = "sk-test";
});

describe("captured model recovery", () => {
	test("concurrent projects retain isolated agent and independently entered nested workflow selections", async () => {
		await discoverTextModels(true);
		const first = await savedVideoRun("Model A");
		const second = await savedVideoRun("Model B");
		first.textSelection = {
			selection: { providerId: "api", model: "gpt-5-mini" },
			endpointIdentity: textEndpointIdentity(),
		};
		second.textSelection = {
			selection: { providerId: "api", model: "gpt-5.5" },
			endpointIdentity: textEndpointIdentity(),
		};
		setTextProviderSelectionReader(() => ({ default: { providerId: "api", model: "gpt-5.5" } }));
		const definition: WorkflowDefinition = {
			id: "nested",
			root: {
				type: "sequence",
				id: "root",
				steps: [
					{ type: "step", id: "text", op: "nested.text" },
					{ type: "end", id: "end", outcome: { ok: true, note: "done" } },
				],
			},
		};
		const registry = createEngineRegistry({
			definitions: [definition],
			operations: [
				defineOperation({
					id: "nested.text",
					description: "Exercise scoped text through the production workflow engine",
					input: z.object({}),
					output: z.object({ text: z.string() }),
					prompts: [],
					tools: [],
					capabilities: [],
					unscoped: "Test operation sends a raw fixture prompt",
					run: async (_input, context) => ({
						text: (await runPrompt(`nested ${context.job.id}`)).stdout,
					}),
				}),
			],
			facts: [],
			rules: [],
			contracts: [],
		});
		const before = (await listUsageRecords()).length;
		delayMs = 20;
		await Promise.all(
			[first, second].map(async (job) => {
				const model = await resolveAgentModel(job.textSelection);
				await new Agent({
					id: job.id,
					name: job.id,
					instructions: "x",
					model: model.model,
				}).generate("continue");
				await runToolFlow({
					registry,
					job,
					toolCallId: "nested-call",
					workflow: "nested",
					input: {},
				});
			}),
		);
		expect(seen.map((request) => request.model ?? "").sort((a, b) => a.localeCompare(b))).toEqual(
			["gpt-5-mini", "gpt-5-mini", "gpt-5.5", "gpt-5.5"].sort((a, b) => a.localeCompare(b)),
		);
		const records = (await listUsageRecords()).slice(0, 4);
		expect((await listUsageRecords()).length).toBe(before + 4);
		expect(records.map((record) => record.model ?? "").sort((a, b) => a.localeCompare(b))).toEqual(
			seen.map((request) => request.model ?? "").sort((a, b) => a.localeCompare(b)),
		);
		clearAgentJobsForTests();
		const recovered = (await loadRun(first.id))!;
		await runToolFlow({
			registry,
			job: recovered,
			toolCallId: "nested-call",
			workflow: "nested",
			input: {},
		});
		expect(seen).toHaveLength(4);
		expect((await listUsageRecords()).length).toBe(before + 4);
		expect((await currentTextSelection()).default?.model).toBe("gpt-5.5");
		await withTextSelection(first.textSelection, async () => {
			expect((await currentTextSelection()).default?.model).toBe("gpt-5-mini");
			await withTextSelection(undefined, async () =>
				expect((await currentTextSelection()).default?.model).toBe("gpt-5.5"),
			);
		});
	}, 30_000);
	test("unavailable captured model blocks tool effects and text billing", async () => {
		const job = await savedVideoRun("Removed model");
		job.textSelection = {
			selection: { providerId: "api", model: "removed-model" },
			endpointIdentity: textEndpointIdentity(),
		};
		const scenes = structuredClone(job.scenes);
		const before = (await listUsageRecords()).length;
		await expect(runValidatedTool(job, "add_scene", { name: "Do not add" })).rejects.toThrow(
			"does not offer model",
		);
		expect(job.scenes).toEqual(scenes);
		expect((await listUsageRecords()).length).toBe(before);
		expect(seen).toEqual([]);
	});
	test("restart and changed application default retain persisted run model", async () => {
		const job = await savedVideoRun("Captured model");
		job.textSelection = {
			selection: { providerId: "api", model: "gpt-5-mini", thinking: "high" },
			endpointIdentity: textEndpointIdentity(),
		};
		await saveRun(job);
		clearAgentJobsForTests();
		setTextProviderSelectionReader(() => ({ default: { providerId: "api", model: "gpt-5.5" } }));
		const recovered = await loadRun(job.id);
		const context = runContext(recovered!);
		const captured = capturedTextSelectionSchema.parse(context.get("textSelection"));
		const resolved = await resolveAgentModel(captured);
		await new Agent({
			id: "restored",
			name: "restored",
			instructions: "x",
			model: resolved.model,
		}).generate("continue");
		expect(seen.at(-1)).toMatchObject({ model: "gpt-5-mini", reasoning_effort: "high" });
		expect((await loadRun(job.id))?.textSelection).toEqual(job.textSelection);
	});
	test("changed endpoint and removed model fail before generation", async () => {
		const capture = {
			selection: { providerId: "api", model: "gpt-5-mini" },
			endpointIdentity: textEndpointIdentity(),
		};
		process.env.MALEO_AI_API_BASE_URL = `${BASE_URL}/changed`;
		await expect(resolveAgentModel(capture)).rejects.toThrow("endpoint changed");
		process.env.MALEO_AI_API_BASE_URL = BASE_URL;
		availableModels = ["gpt-5.5"];
		await discoverTextModels(true);
		await expect(resolveAgentModel(capture)).rejects.toThrow("does not offer model");
		expect(seen).toEqual([]);
	});
	test("legacy runs retain global resolution without inventing capture", async () => {
		await discoverTextModels(true);
		const job = await savedVideoRun("Legacy model");
		expect(job.textSelection).toBeUndefined();
		setTextProviderSelectionReader(() => ({ default: { providerId: "api", model: "gpt-5.5" } }));
		expect((await resolveAgentModel(runContext(job).get("textSelection"))).modelId).toBe("gpt-5.5");
		expect((await loadRun(job.id))?.textSelection).toBeUndefined();
	});
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

	test("a custom endpoint requires an explicit model", async () => {
		setTextProviderSelectionReader(() => ({ default: { providerId: "api" } }));
		await expect(resolveAgentModel()).rejects.toThrow("Choose a text model");
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
