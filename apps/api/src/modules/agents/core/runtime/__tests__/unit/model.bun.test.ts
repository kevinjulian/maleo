/* adopt-mastra-internal-agent 1.2: the agent model path.
 *
 * A Mastra agent executes its own tools only when the model hands it the tool
 * call. This proves it with a scripted model — the one tests and CI use, so tool
 * order is deterministic and free — and maps the API provider's configuration
 * onto Mastra's OpenAI-compatible model. The live counterpart against a real
 * endpoint is `model.live.bun.test.ts`. */
import { describe, expect, test } from "bun:test";
import { Agent } from "@mastra/core/agent";
import { createTool } from "@mastra/core/tools";
import { scriptedModel, turn, usage } from "../support/scripted-model.ts";
import { z } from "zod";
import { AGENT_MODEL_PROVIDER_ID, agentModel } from "../../model.ts";

describe("the agent runs its own tools on a scripted model", () => {
	test("the model's tool call is executed by Mastra, and its result reaches the next turn", async () => {
		const executed: Array<{ projectId: string }> = [];
		const sceneCount = createTool({
			id: "get_scene_count",
			description: "Number of scenes in a project.",
			inputSchema: z.object({ projectId: z.string() }),
			execute: async (input) => {
				executed.push(input);
				return { count: 7319 };
			},
		});
		const turns = [
			turn([
				{
					type: "tool-call",
					toolCallId: "call-1",
					toolName: "get_scene_count",
					input: JSON.stringify({ projectId: "p1" }),
				},
				{ type: "finish", finishReason: "tool-calls", usage },
			]),
			turn([
				{ type: "text-start", id: "t1" },
				{ type: "text-delta", id: "t1", delta: "7319" },
				{ type: "text-end", id: "t1" },
				{ type: "finish", finishReason: "stop", usage },
			]),
		];
		const model = scriptedModel(turns);
		const agent = new Agent({
			id: "probe",
			name: "probe",
			instructions: "Answer with tools.",
			model,
			tools: { get_scene_count: sceneCount },
		});

		const result = await agent.generate("How many scenes are in project p1?", { maxSteps: 3 });

		expect(executed).toEqual([{ projectId: "p1" }]);
		expect(result.text).toBe("7319");
		// The second turn saw the tool's result, so the loop is Mastra's, not the model's.
		const calls = [...model.doGenerateCalls, ...model.doStreamCalls];
		const secondPrompt = JSON.stringify(calls[1]?.prompt);
		expect(secondPrompt).toContain("7319");
		expect(model.doStreamCalls.length + model.doGenerateCalls.length).toBe(2);
	});
});

describe("the API provider's configuration becomes the agent's model", () => {
	test("endpoint, key and model map onto Mastra's OpenAI-compatible model", () => {
		expect(
			agentModel("gpt-5-mini", { baseUrl: "https://api.example.test/v1", apiKey: "k" }),
		).toEqual({
			providerId: AGENT_MODEL_PROVIDER_ID,
			modelId: "gpt-5-mini",
			url: "https://api.example.test/v1",
			apiKey: "k",
		});
	});
});
