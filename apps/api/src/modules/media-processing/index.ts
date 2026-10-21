import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { HTTPException } from "hono/http-exception";
import { activeCaller, activeWorkspace } from "../../lib/active-workspace.ts";
import { bearerFrom, isValidServiceToken } from "../../lib/service-token.ts";
import { assertImportProject, publicImportError } from "../media-import/service.ts";
import { ImportSourceScopeSchema } from "../media-import/model.ts";
import { ProcessMediaBodySchema } from "./model.ts";
import { projectCaptionRoutes } from "./captions.ts";
import {
	authorizedProcessingSource,
	submitSourceProcessing,
	pollSourceProcessing,
	cancelSourceProcessing,
	type MediaProcessingOptions,
} from "./service.ts";

export function internalMediaProcessingRoutes(): Hono {
	const app = new Hono();
	app.on(["GET", "HEAD"], "/:id/source", async (c) => {
		if (!isValidServiceToken(bearerFrom(c.req.header("authorization"))))
			return c.json({ error: "unauthorized" }, 401);
		const scope = ImportSourceScopeSchema.safeParse(c.req.query());
		if (!scope.success) return c.json({ error: "not_found" }, 404);
		const source = await authorizedProcessingSource(c.req.param("id"), scope.data);
		if (!source) return c.json({ error: "not_found" }, 404);
		return new Response(c.req.method === "HEAD" ? null : source.stream(), {
			headers: {
				"content-type": "application/octet-stream",
				"content-length": String(source.size),
				"cache-control": "private, no-store",
			},
		});
	});
	return app;
}

export function projectMediaProcessingRoutes(options: MediaProcessingOptions = {}): Hono {
	const app = new Hono();
	app.route("/", projectCaptionRoutes(options));
	app.onError((error, c) =>
		c.json(
			{
				error: "media_processing_failed",
				message: publicImportError(error, "Source processing failed; try again"),
			},
			error instanceof HTTPException ? error.status : 500,
		),
	);
	// Polling registers finished derivatives, so every method needs editing permission.
	app.use("/:id/media/processing*", bodyLimit({ maxSize: 8192 }), async (c, next) => {
		await assertImportProject(c.req.param("id")!, activeWorkspace(c), activeCaller(c).userId, true);
		await next();
	});
	app.post("/:id/media/processing", async (c) => {
		const input = ProcessMediaBodySchema.safeParse(await c.req.json().catch(() => null));
		if (!input.success) return c.json({ error: "invalid_processing_request" }, 400);
		return c.json(
			{
				id: await submitSourceProcessing(
					c.req.param("id"),
					activeWorkspace(c),
					input.data,
					options,
				),
			},
			202,
		);
	});
	app.get("/:id/media/processing/:jobId", async (c) =>
		c.json(
			await pollSourceProcessing(
				c.req.param("jobId"),
				c.req.param("id"),
				activeWorkspace(c),
				options,
			),
		),
	);
	app.delete("/:id/media/processing/:jobId", async (c) => {
		await cancelSourceProcessing(
			c.req.param("jobId"),
			c.req.param("id"),
			activeWorkspace(c),
			options,
		);
		return c.json({ ok: true });
	});
	return app;
}
