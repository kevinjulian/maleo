import { Hono, type Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { bearerFrom, isValidServiceToken } from "../../lib/service-token.ts";
import { activeCaller, activeWorkspace } from "../../lib/active-workspace.ts";
import { MediaIdSchema } from "@maleo/shared";
import { ImportSourceScopeSchema, ImportUploadHeadersSchema } from "./model.ts";
import {
	authorizedImportSource,
	assertImportProject,
	importReadiness,
	pendingProjectImports,
	uploadProjectMedia,
	pollProjectMediaImport,
	cancelImport,
	cancelUploadRequest,
	importByRequestKey,
	publicImportError,
	type MediaImportOptions,
} from "./service.ts";

export function internalMediaImportRoutes(): Hono {
	const app = new Hono();
	app.on(["GET", "HEAD"], "/:id/source", async (c) => {
		if (!isValidServiceToken(bearerFrom(c.req.header("authorization"))))
			return c.json({ error: "unauthorized" }, 401);
		const scope = ImportSourceScopeSchema.safeParse(c.req.query());
		if (!scope.success) return c.json({ error: "not_found" }, 404);
		const source = await authorizedImportSource(c.req.param("id"), scope.data);
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

type ImportEnv = { Variables: { importCanWrite: boolean } };

export function projectMediaImportRoutes(options: MediaImportOptions = {}): Hono<ImportEnv> {
	const app = new Hono<ImportEnv>();
	app.onError((error, c) =>
		error instanceof HTTPException && error.res
			? error.getResponse()
			: c.json(
					{
						error: "media_import_failed",
						message: publicImportError(error, "Media import failed; try again"),
					},
					error instanceof HTTPException ? error.status : 500,
				),
	);
	app.use("/:id/media/import*", async (c: Context<ImportEnv>, next) => {
		const { canWrite } = await assertImportProject(
			c.req.param("id")!,
			activeWorkspace(c),
			activeCaller(c).userId,
			c.req.method !== "GET",
		);
		c.set("importCanWrite", canWrite);
		await next();
	});
	app.get("/:id/media/import/readiness", async (c) => c.json(await importReadiness(options)));
	app.get("/:id/media/import", async (c) => {
		const cursor = z
			.string()
			.uuid()
			.nullable()
			.safeParse(c.req.query("after") ?? null);
		if (!cursor.success) return c.json({ error: "invalid_cursor" }, 400);
		return c.json(await pendingProjectImports(c.req.param("id"), activeWorkspace(c), cursor.data));
	});
	app.get("/:id/media/import/request/:requestKey", async (c) => {
		const key = MediaIdSchema.safeParse(c.req.param("requestKey"));
		const result = key.success
			? await importByRequestKey(key.data, c.req.param("id"), activeWorkspace(c))
			: null;
		return result ? c.json(result) : c.json({ error: "not_found" }, 404);
	});
	app.delete("/:id/media/import/request/:requestKey", async (c) => {
		const result = await cancelUploadRequest(
			c.req.param("requestKey"),
			c.req.param("id"),
			activeWorkspace(c),
			options,
		);
		return result ? c.json(result) : c.json({ error: "not_found" }, 404);
	});
	app.post("/:id/media/import", async (c) => {
		let filename: string | undefined;
		try {
			filename = decodeURIComponent(c.req.header("x-file-name") ?? "");
		} catch {
			return c.json({ error: "invalid_filename" }, 400);
		}
		const parsed = ImportUploadHeadersSchema.safeParse({
			requestKey: c.req.header("x-upload-id"),
			filename,
			kind: c.req.header("x-media-kind"),
			batchSize: c.req.header("x-batch-size") ? Number(c.req.header("x-batch-size")) : undefined,
			declaredBytes: c.req.header("x-file-size") ? Number(c.req.header("x-file-size")) : undefined,
		});
		if (!parsed.success)
			return c.json(
				{
					error: "invalid_upload_headers",
					message: "File name, type and upload identity required",
				},
				400,
			);
		return c.json(
			await uploadProjectMedia(
				c.req.param("id"),
				activeWorkspace(c),
				parsed.data,
				c.req.raw,
				options,
			),
			202,
		);
	});
	app.get("/:id/media/import/:importId", async (c) =>
		c.json(
			await pollProjectMediaImport(
				c.req.param("importId"),
				c.req.param("id"),
				activeWorkspace(c),
				options,
				c.get("importCanWrite"),
			),
		),
	);
	app.delete("/:id/media/import/:importId", async (c) =>
		c.json(
			await cancelImport(c.req.param("importId"), c.req.param("id"), activeWorkspace(c), options),
		),
	);
	return app;
}
