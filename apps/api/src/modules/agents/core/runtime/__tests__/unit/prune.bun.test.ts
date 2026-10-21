/* adopt-mastra-internal-agent 2.13: execution state no run can resume is pruned. */
import { expect, test } from "bun:test";
import { Mastra } from "@mastra/core/mastra";
import { InMemoryStore } from "@mastra/core/storage";
import type { WorkflowRunState } from "@mastra/core/workflows";
import { EXECUTION_STATE_TTL_MS, pruneExecutionState } from "../../durable.ts";

const DAY = 24 * 60 * 60 * 1000;

test("state untouched past the TTL is deleted; a recently resumed old run and a new run stay", async () => {
	const mastra = new Mastra({ storage: new InMemoryStore(), logger: false });
	const workflows = (await mastra.getStorage()!.getStore("workflows"))!;
	const now = Date.now();
	// SAFETY: the store persists the snapshot opaquely; pruning reads only the run's dates.
	const snapshot = {} as WorkflowRunState;
	const at = (ms: number) => new Date(now - ms);
	await workflows.persistWorkflowSnapshot({
		workflowName: "loop",
		runId: "dead",
		snapshot,
		createdAt: at(5 * DAY),
		updatedAt: at(EXECUTION_STATE_TTL_MS + DAY),
	});
	await workflows.persistWorkflowSnapshot({
		workflowName: "loop",
		runId: "long-but-live",
		snapshot,
		createdAt: at(5 * DAY),
		updatedAt: at(DAY),
	});
	await workflows.persistWorkflowSnapshot({
		workflowName: "loop",
		runId: "new",
		snapshot,
		createdAt: at(1000),
		updatedAt: at(1000),
	});

	expect(await pruneExecutionState(mastra, now)).toBe(1);
	const left = (await workflows.listWorkflowRuns()).runs.map((run) => run.runId).sort();
	expect(left).toEqual(["long-but-live", "new"]);
});
