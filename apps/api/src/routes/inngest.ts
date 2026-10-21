/* Inngest sync endpoint.
 *
 * Serves the durable functions at /api/inngest (the Inngest server invokes them
 * over HTTP here): the Mastra agent's durable functions
 * (modules/agents/core/runtime/durable.ts) and the stale-wait sweep. The Mastra
 * runtime opens its own store, so the handler is built on the first request. */
import { Hono } from "hono";
import { serve } from "@mastra/inngest";
import { inngest } from "@maleo/inngest";
import { durableRuntime, pruneExecutionState } from "../modules/agents/core/runtime/durable.ts";
import { abandonStaleWaits } from "../modules/agents/core/service.ts";

/** Abandons runs that waited on the user past the input timeout, then prunes execution state no run can resume. */
const abandonStaleWaitsFunction = inngest.createFunction(
	{ id: "agent-abandon-stale-waits", triggers: [{ cron: "*/15 * * * *" }] },
	async ({ step }) => {
		const abandoned = await step.run("abandon", () => abandonStaleWaits());
		const pruned = await step.run(
			"prune",
			async () => await pruneExecutionState((await durableRuntime()).mastra),
		);
		return { abandoned, pruned };
	},
);

export function inngestRoutes(): Hono {
	const app = new Hono();
	let handler: Promise<ReturnType<typeof serve>> | undefined;
	const built = () =>
		(handler ??= durableRuntime().then(({ mastra }) =>
			serve({ mastra, inngest, functions: [abandonStaleWaitsFunction] }),
		));
	app.on(["GET", "POST", "PUT"], "/", async (c) => (await built())(c));
	return app;
}
