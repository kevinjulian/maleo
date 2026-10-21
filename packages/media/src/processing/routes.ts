import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { inngest, mediaProcessingRequestedEvent } from "@maleo/inngest";
import { ProcessingRequestSchema } from "../api/processing.ts";
import { CAPTION_JOB_LIMITS } from "@maleo/shared";
import { cancelProcessingJob, createProcessingJob, getProcessingJob } from "../generation/store.ts";
import { processingReadiness } from "./readiness.ts";
import { requireMediaService } from "../worker-auth.ts";

export function processingRoutes(): Hono {
	const app = new Hono();
	app.use("*", requireMediaService);
	app.post("/", bodyLimit({ maxSize: CAPTION_JOB_LIMITS.maxBodyBytes }), async (c) => {
		const raw = await c.req.text();
		let value: unknown;
		try {
			value = JSON.parse(raw);
		} catch {
			return c.json({ error: "invalid_processing_request" }, 400);
		}
		const parsed = ProcessingRequestSchema.safeParse(value);
		if (!parsed.success) return c.json({ error: "invalid_processing_request" }, 400);
		const kind = "type" in parsed.data ? "captions" : undefined;
		if (!kind && Buffer.byteLength(raw) > 8192)
			return c.json({ error: "processing_request_too_large" }, 413);
		const readiness = await processingReadiness(kind);
		if (!readiness.available)
			return c.json({ error: "processing_unavailable", message: readiness.reason }, 503);
		let job;
		try {
			job = createProcessingJob(parsed.data);
		} catch (error) {
			return c.json({ error: error instanceof Error ? error.message : "Import conflict" }, 409);
		}
		if (job.status === "queued" || job.status === "processing") {
			await inngest.send(
				mediaProcessingRequestedEvent.create({
					jobId: job.id,
					workspaceId: job.request.workspaceId,
					projectId: job.request.projectId,
					idempotencyKey: job.id,
				}),
			);
		}
		return c.json({ job_id: job.id, status: job.status }, 202);
	});
	app.get("/readiness", async (c) =>
		c.json(await processingReadiness(c.req.query("kind") === "captions" ? "captions" : undefined)),
	);
	app.on(["GET", "DELETE"], "/:id", (c) => {
		const job = getProcessingJob(c.req.param("id"));
		if (
			!job ||
			job.request.workspaceId !== c.req.query("workspace") ||
			job.request.projectId !== c.req.query("project")
		)
			return c.json({ error: "not_found" }, 404);
		if (c.req.method === "DELETE") cancelProcessingJob(job.id);
		return c.json(getProcessingJob(job.id));
	});
	return app;
}
