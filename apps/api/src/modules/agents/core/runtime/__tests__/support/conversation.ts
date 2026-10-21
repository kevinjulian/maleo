/* A conversation with the internal agent over a real Mastra instance (in-memory
 * storage), so suspend and resume are real: start it, then answer what it asks
 * the way the answer route does. */
import { Mastra } from "@mastra/core/mastra";
import { RequestContext } from "@mastra/core/request-context";
import { InMemoryStore } from "@mastra/core/storage";
import { loadRun, saveRun } from "../../../run-repository.ts";
import { clearAgentJobsForTests } from "../../../session-store.ts";
import type { AgentJob } from "../../../model.ts";
import { AGENT_WORKFLOWS, createInternalAgent } from "../../agent.ts";
import type { AgentRunContext } from "../../tools/registry-tools.ts";
import { scriptedModel, type turn } from "./scripted-model.ts";

export function conversation(job: AgentJob, turns: Array<ReturnType<typeof turn>>) {
	// The model is the external service: it outlives a restart of this process.
	const model = scriptedModel(turns);
	// The store is the durable state a restarted process reads back.
	let storage = new InMemoryStore();
	const boot = () =>
		new Mastra({
			agents: { maleo: createInternalAgent(model) },
			workflows: AGENT_WORKFLOWS,
			storage,
			logger: false,
		}).getAgent("maleo");
	let agent = boot();
	const requestContext = new RequestContext<AgentRunContext>([
		["runId", job.id],
		["projectId", job.projectId],
		["contentType", job.contentType],
	]);
	let runId = "";
	return {
		model,
		/** Synthetic compatibility fixtures capture the actual framework and product state. */
		snapshot: async () => {
			const store = await storage.getStore("workflows");
			if (!store) throw new Error("workflow snapshot store unavailable");
			return { job: await loadRun(job.id), framework: await store.listWorkflowRuns() };
		},
		/** Restore current serialized workflow rows into a new store; product state reloads from Postgres. */
		restoreSnapshot: async () => {
			const source = await storage.getStore("workflows");
			if (!source) throw new Error("workflow snapshot store unavailable");
			// SAFETY: these rows come from the typed store; JSON only serializes dates, restored below.
			const rows = JSON.parse(
				JSON.stringify(await source.listWorkflowRuns({ perPage: false })),
			) as Awaited<ReturnType<typeof source.listWorkflowRuns>>;
			storage = new InMemoryStore();
			const target = await storage.getStore("workflows");
			if (!target) throw new Error("workflow restore store unavailable");
			for (const row of rows.runs)
				await target.persistWorkflowSnapshot({
					workflowName: row.workflowName,
					runId: row.runId,
					resourceId: row.resourceId,
					snapshot: typeof row.snapshot === "string" ? JSON.parse(row.snapshot) : row.snapshot,
					createdAt: new Date(row.createdAt),
					updatedAt: new Date(row.updatedAt),
				});
			clearAgentJobsForTests();
			agent = boot();
		},
		/** A fresh process: new Mastra, agent and workflows over the same store, and no job in memory. */
		restart: () => {
			clearAgentJobsForTests();
			agent = boot();
		},
		start: async (maxSteps?: number) => {
			const result = await agent.generate("go", {
				requestContext,
				...(maxSteps ? { maxSteps } : {}),
			});
			runId = result.runId ?? "";
			return result;
		},
		answer: async (text: string) => {
			// What the answer route does before resuming: the pending action is consumed.
			const current = (await loadRun(job.id))!;
			current.status = "running";
			current.pendingActionId = undefined;
			current.pendingQuestion = undefined;
			await saveRun(current);
			return await agent.resumeGenerate({ answer: text }, { runId, requestContext });
		},
	};
}
