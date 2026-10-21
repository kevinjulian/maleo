/* adopt-mastra-internal-agent 2.9, live: the production host on a real Inngest
 * server, its execution state in Postgres.
 *
 * Opt-in — it needs an Inngest dev server that reaches this test's endpoint, and
 * nothing else serving the agent's functions (events route by name across apps):
 *
 *   node_modules/.bin/inngest dev --no-discovery -u http://127.0.0.1:4556/api/inngest
 *   MALEO_LIVE_DURABLE_TESTS=1 bun test durable.live
 *
 * A run parks on the story plan's approval gate; a second runtime — a new agent and a
 * new Mastra over the same store, nothing in memory — answers it, and the run
 * finishes on Inngest and settles into the product record. */
import { afterAll, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { Mastra } from "@mastra/core/mastra";
import { PostgresStore } from "@mastra/pg";
import { closeMaleoDb } from "@maleo/db/connection";
import { createContentProject } from "@maleo/db/project-detail";
import { createTestDatabase } from "@maleo/db/pg-testing";
import { buildAgentJob } from "../../../run-bracket.ts";
import { loadRun, saveRun } from "../../../run-repository.ts";
import { clearAgentJobsForTests } from "../../../session-store.ts";
import { runState } from "../../run-state.ts";
import {
	draftShortPlan,
	installStoryProviders,
	providerCalls,
	removeStoryProviders,
} from "../support/story-fixture.ts";
import { answerAgentRun, startAgentRun, type RunHost } from "../../../service.ts";
import { AGENT_WORKFLOWS } from "../../agent.ts";
import { answer, callTool, scriptedModel } from "../support/scripted-model.ts";

const LIVE = (process.env.MALEO_LIVE_DURABLE_TESTS ?? "").trim() === "1";
const PORT = 4556;

afterAll(async () => {
	await closeMaleoDb();
});

describe.skipIf(!LIVE)("the durable host", () => {
	test("a run parked on a gate is answered by a fresh runtime and settles", async () => {
		// Loaded here, not at the top: a skipped suite must not evaluate them (other suites mock the Inngest client).
		const { serve } = await import("@mastra/inngest");
		const { inngest } = await import("@maleo/inngest");
		const { createDurableAgent, durableHost, MASTRA_SCHEMA } = await import("../../durable.ts");
		const store = await createTestDatabase({ migrated: false });
		const model = scriptedModel([
			callTool("workflow-generate_story_assets", { inputData: {} }),
			answer("Generated."),
		]);
		let serving: Hono | undefined;
		const server = Bun.serve({
			port: PORT,
			idleTimeout: 255,
			fetch: (request) => serving!.fetch(request),
		});

		/** A runtime as a process boots one: a new agent and Mastra over the shared store, served to Inngest. */
		const boot = async (): Promise<RunHost> => {
			clearAgentJobsForTests();
			const agent = createDurableAgent(model);
			const storage = new PostgresStore({
				id: `live-${Date.now()}`,
				connectionString: store.url,
				schemaName: MASTRA_SCHEMA,
			});
			// SAFETY: Mastra registers an InngestAgent in `agents`; its declared type is the plain Agent.
			const mastra = new Mastra({
				agents: { maleo: agent as never },
				workflows: AGENT_WORKFLOWS,
				storage,
				logger: false,
			});
			const app = new Hono();
			const handler = serve({ mastra, inngest });
			app.on(["GET", "POST", "PUT"], "/api/inngest", (c) => handler(c));
			serving = app;
			await fetch(`http://127.0.0.1:${PORT}/api/inngest`, { method: "PUT" });
			return durableHost(agent);
		};

		installStoryProviders();
		try {
			const projectId = (await createContentProject({ title: "Durable", type: "video" })).project
				.id;
			const job = await buildAgentJob({
				projectId,
				instruction: "make a story",
				brief: "a lighthouse keeper's last night",
				contentType: "video",
			});
			runState(job).instruction = "make a story";
			draftShortPlan(job);
			await saveRun(job);

			await startAgentRun(await boot(), job, "make a story");
			const parked = (await loadRun(job.id))!;
			expect(parked.status).toBe("awaiting_input");
			expect(providerCalls.frames + providerCalls.speech).toBe(0);

			expect(await answerAgentRun(await boot(), job.id, parked.pendingActionId, "approve")).toBe(
				"resumed",
			);
			const done = (await loadRun(job.id))!;
			expect(done.status).toBe("done");
			expect(done.scenes.length).toBeGreaterThan(0);
			expect(done.scenes.every((scene) => Boolean(scene.image))).toBe(true);
			expect(done.events.filter((event) => event.kind === "final").at(-1)).toEqual({
				kind: "final",
				text: "Generated.",
			});
		} finally {
			removeStoryProviders();
			void server.stop(true);
			await store.drop();
		}
	}, 120_000);
});
