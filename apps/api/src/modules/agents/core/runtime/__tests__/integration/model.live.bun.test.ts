/* adopt-mastra-internal-agent 1.2, live: a real API model makes a native tool
 * call that Mastra executes, through the same configuration the text provider
 * reads.
 *
 * Opt-in — it reaches a real endpoint. Any OpenAI-compatible server works; a
 * local Ollama is enough and free:
 *
 *   MALEO_LIVE_PROVIDER_TESTS=1 MALEO_AI_API_BASE_URL=http://127.0.0.1:11434/v1 \
 *   MALEO_AI_API_KEY=ollama MALEO_LIVE_AGENT_MODEL=llama3.2 bun test model.live
 */
import { describe, expect, test } from "bun:test";
import { Agent } from "@mastra/core/agent";
import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { agentModel } from "../../model.ts";

const LIVE = (process.env.MALEO_LIVE_PROVIDER_TESTS ?? "").trim() === "1";
const MODEL = process.env.MALEO_LIVE_AGENT_MODEL?.trim() || "gpt-5-mini";

describe.skipIf(!LIVE)("an API model's tool call is executed by Mastra", () => {
	test("the model calls the tool, Mastra runs it, and the answer carries its result", async () => {
		const executed: string[] = [];
		const sceneCount = createTool({
			id: "get_scene_count",
			description:
				"Returns the number of scenes in a project. The count cannot be known without calling this.",
			inputSchema: z.object({ projectId: z.string() }),
			execute: async ({ projectId }) => {
				executed.push(projectId);
				return { count: 7319 };
			},
		});
		const agent = new Agent({
			id: "live-probe",
			name: "live-probe",
			instructions: "Use the get_scene_count tool to answer. Reply with the number only.",
			model: agentModel(MODEL),
			tools: { get_scene_count: sceneCount },
		});

		const result = await agent.generate("How many scenes are in project p1?", { maxSteps: 3 });

		expect(executed).toEqual(["p1"]);
		expect(result.text).toContain("7319");
		expect(result.usage?.inputTokens ?? 0).toBeGreaterThan(0);
		console.info(
			JSON.stringify({
				model: MODEL,
				usage: result.usage,
				steps: result.steps?.length,
				text: result.text,
			}),
		);
	}, 120_000);
});
