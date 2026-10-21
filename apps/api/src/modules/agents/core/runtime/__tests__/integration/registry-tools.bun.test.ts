/* adopt-mastra-internal-agent 2.1: the registry as the agent's Mastra tools.
 *
 * A scripted model drives a real Mastra agent over a real video project; every
 * call must go through the agent's executor and its boundaries. */
import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { Agent } from "@mastra/core/agent";
import { RequestContext } from "@mastra/core/request-context";
import { closeMaleoDb } from "@maleo/db/connection";
import { clearWorkflowRunsForTests, listToolRuns } from "@maleo/db/workflow-run-db";
import { toolByName } from "../../../registry.ts";
import { loadRun } from "../../../run-repository.ts";
import type { AgentJob } from "../../../model.ts";
import { agentTools, agentToolsFor, type AgentRunContext } from "../../tools/registry-tools.ts";
import { agentWorkflowsFor, definitionToolsFor } from "../../agent.ts";
import { answer, callTool, scriptedModel } from "../support/scripted-model.ts";
import { savedVideoRun } from "../support/video-fixture.ts";

let job: AgentJob;

function contextFor(run: AgentJob, projectId = run.projectId) {
	return new RequestContext<AgentRunContext>([
		["runId", run.id],
		["projectId", projectId],
		["contentType", run.contentType],
	]);
}

/** Run one scripted tool call through a real agent; returns what the model saw. */
async function drive(toolName: string, input: unknown, context = contextFor(job)) {
	const model = scriptedModel([callTool(toolName, input), answer("done")]);
	const agent = new Agent({
		id: "probe",
		name: "probe",
		instructions: "Use tools.",
		model,
		tools: agentToolsFor,
	});
	const result = await agent.generate("go", { maxSteps: 3, requestContext: context });
	const offered = (model.doGenerateCalls[0]?.tools ?? []).map(
		(tool: { name: string }) => tool.name,
	);
	const output = JSON.stringify(result.toolResults?.[0]?.payload ?? result.steps);
	return { offered, output };
}

beforeEach(async () => {
	await clearWorkflowRunsForTests();
	job = await savedVideoRun("Starter tips");
});
afterAll(async () => {
	await closeMaleoDb();
});

describe("a registry tool called by the agent", () => {
	test("runs through the executor on the run's own job, and the model gets its note", async () => {
		const { output } = await drive("view_timeline", {});
		expect(output).toContain("Feed it daily");
		expect((await listToolRuns(job.id)).map((row) => [row.tool_name, row.status])).toEqual([
			["view_timeline", "completed"],
		]);
	});

	test("the same call made twice in one run runs twice, each a durable tool run of its own", async () => {
		const model = scriptedModel([
			callTool("view_timeline", {}, "first"),
			callTool("view_timeline", {}, "second"),
			answer("done"),
		]);
		const agent = new Agent({
			id: "probe",
			name: "probe",
			instructions: "Use tools.",
			model,
			tools: agentToolsFor,
		});
		const result = await agent.generate("go", { maxSteps: 4, requestContext: contextFor(job) });
		const outputs = result.steps
			.flatMap((step) => step.toolResults ?? [])
			.map((toolResult) => JSON.stringify(toolResult.payload));
		expect(outputs).toHaveLength(2);
		for (const output of outputs) expect(output).toContain("Feed it daily");
		expect((await listToolRuns(job.id)).map((row) => row.status)).toEqual([
			"completed",
			"completed",
		]);
	});

	test("invalid arguments are refused before any effect, and the model is told", async () => {
		const { output } = await drive("update_scene", { index: "first", name: 7 });
		expect(output.toLowerCase()).toContain("validation failed for update_scene");
		expect((await loadRun(job.id))!.scenes.map((scene) => scene.name)).toEqual(["Feed it daily"]);
		expect(await listToolRuns(job.id)).toEqual([]);
	});

	test("a run that belongs to another project is refused", async () => {
		const { output } = await drive("view_timeline", {}, contextFor(job, "someone-elses-project"));
		expect(output).toContain("this run does not belong to the project");
		expect(await listToolRuns(job.id)).toEqual([]);
	});
});

describe("which tools the agent is offered", () => {
	test("a run is offered exactly its content type's tools, without the runtime's own", async () => {
		const { offered } = await drive("view_timeline", {});
		expect(offered.sort()).toEqual(Object.keys(agentTools("video")).sort());
		expect(offered).toContain("update_scene");
		expect(offered).not.toContain("plan_story");
		expect(offered).not.toContain("ask_user");
		expect(offered).not.toContain("finish");
		// Carousel and thread tools are retired; no content type is offered them.
		for (const contentType of ["video", "image", "text"] as const) {
			for (const retired of [
				"view_carousel",
				"build_carousel",
				"update_slide",
				"view_thread",
				"build_text",
				"update_post",
			])
				expect(Object.keys(agentTools(contentType))).not.toContain(retired);
		}
	});

	test("workflow-plan_story is the only planner a video run is offered, and nothing plans elsewhere", () => {
		const planners = (contentType: "video" | "image" | "text") =>
			Object.keys(agentTools(contentType)).filter(
				(name) => toolByName.get(name)?.proposes === "story_plan",
			);
		// Planning is the plan_story definition on the engine; no registry tool plans.
		expect(planners("video")).toEqual([]);
		const definitions = (contentType: "video" | "image" | "text") =>
			Object.keys(
				definitionToolsFor(new RequestContext<AgentRunContext>([["contentType", contentType]])),
			);
		expect(definitions("video")).toEqual(["workflow-plan_story", "create_story_video"]);
		const workflows = (contentType: "video" | "image" | "text") =>
			Object.keys(
				agentWorkflowsFor({
					requestContext: new RequestContext<AgentRunContext>([["contentType", contentType]]),
				}),
			);
		// Generation stays a Mastra workflow until it is ported to a definition.
		expect(workflows("video")).toEqual(["generate_story_assets"]);
		// Image and text are retired: no workflow at all.
		for (const contentType of ["image", "text"] as const) {
			expect(planners(contentType)).toEqual([]);
			expect(workflows(contentType)).toEqual([]);
			expect(definitions(contentType)).toEqual([]);
		}
	});
});
