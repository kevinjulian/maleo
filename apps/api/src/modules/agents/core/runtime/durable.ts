/* The production host: the agent on Inngest, its execution state in Postgres.
 *
 * Inngest runs each generation as memoized steps and re-invokes a failed one, so a
 * run survives the process that started it; Mastra keeps the suspended snapshot a
 * resume needs in its own schema of the runtime database. Our product record stays
 * the AgentJob (service.ts) — nothing here is read to show a run. */
import { Mastra } from "@mastra/core/mastra";
import { createInngestAgent, type InngestAgent } from "@mastra/inngest";
import { PostgresStore } from "@mastra/pg";
import { runtimeDatabaseUrl } from "@maleo/db/connection";
import { inngest } from "@maleo/inngest";
import { INPUT_WAIT_MS, type RunHost } from "../service.ts";
import { AGENT_RUN_OPTIONS, AGENT_WORKFLOWS, createInternalAgent } from "./agent.ts";
import { resolveAgentModel } from "./model.ts";
import { executionId } from "./run-state.ts";

/** Mastra's tables live in their own schema, apart from the migrated runtime tables. */
export const MASTRA_SCHEMA = "mastra";

/* A step that fails because the process died is re-invoked; a deliberate failure
 * settles the run (settle.ts) and is not retried. */
const RETRIES = 3;

/* Execution state is kept only while a run can still resume: a wait is abandoned
 * after INPUT_WAIT_MS, so state untouched for twice that is dead. Pruning it
 * bounds how long a run's messages outlive the run — and a deleted workspace's
 * runs, which the product record no longer knows about. */
export const EXECUTION_STATE_TTL_MS = INPUT_WAIT_MS * 2;
const PRUNE_BATCH = 500;

/** Delete execution state no run can resume. Returns how many runs were pruned. */
export async function pruneExecutionState(mastra: Mastra, now = Date.now()): Promise<number> {
	const workflows = await mastra.getStorage()?.getStore("workflows");
	if (!workflows) return 0;
	const cutoff = now - EXECUTION_STATE_TTL_MS;
	// Listed by creation, kept by last update: a long run that keeps resuming stays.
	const { runs } = await workflows.listWorkflowRuns({
		toDate: new Date(cutoff),
		perPage: PRUNE_BATCH,
		page: 0,
	});
	const dead = runs.filter((run) => new Date(run.updatedAt).getTime() < cutoff);
	for (const run of dead)
		await workflows.deleteWorkflowRunById({ runId: run.runId, workflowName: run.workflowName });
	return dead.length;
}

/** Runs generations on the durable agent. The run limits go with every call. */
export function durableHost(agent: InngestAgent): RunHost {
	return {
		start: async (job, message, requestContext) => {
			await agent.generate(message, {
				...AGENT_RUN_OPTIONS,
				runId: executionId(job),
				requestContext,
			});
		},
		resume: async (job, answer, requestContext) => {
			await agent.resumeGenerate(executionId(job), { answer }, { requestContext });
		},
	};
}

export interface DurableRuntime {
	mastra: Mastra;
	host: RunHost;
}

/** The agent resolves the user's text selection on every model call, so a settings change reaches runs already parked. */
export function createDurableAgent(
	model: Parameters<typeof createInternalAgent>[0] = async () => (await resolveAgentModel()).model,
): InngestAgent {
	return createInngestAgent({ agent: createInternalAgent(model), inngest, retries: RETRIES });
}

let runtime: Promise<DurableRuntime> | undefined;
let hostOverride: RunHost | undefined;

/** Where product runs execute: the durable host, or the one a test installs. */
export async function runHost(): Promise<RunHost> {
	return hostOverride ?? (await durableRuntime()).host;
}

export function setRunHostForTests(host: RunHost | undefined): void {
	hostOverride = host;
}

/** The process's durable runtime, built on first use. */
export function durableRuntime(): Promise<DurableRuntime> {
	runtime ??= (async () => {
		const agent = createDurableAgent();
		const storage = new PostgresStore({
			id: "maleo",
			connectionString: await runtimeDatabaseUrl(),
			schemaName: MASTRA_SCHEMA,
		});
		// SAFETY: Mastra registers an InngestAgent in `agents` and wires its durable workflows; its declared type is the plain Agent.
		const mastra = new Mastra({
			agents: { maleo: agent as never },
			workflows: AGENT_WORKFLOWS,
			storage,
			logger: false,
		});
		return { mastra, host: durableHost(agent) };
	})();
	return runtime;
}
