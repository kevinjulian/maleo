import { Hono } from "hono";
import type { Db } from "@maleo/db/handle";
import { getMediaObject } from "@maleo/db/media-objects";
import { getImportByMediaId } from "@maleo/db/media-imports";
import { isWorkspaceMember } from "@maleo/db/workspace-members";
import {
	addressMedia,
	externalMediaUrlLifetimeSeconds,
	getMedia,
	MediaObjectMissingError,
	mediaDisposition,
} from "@maleo/storage";
import { activeCaller } from "../lib/active-workspace.ts";
import { buildUploadResponse } from "../lib/upload-response.ts";

export async function serveMedia(
	id: string,
	userId: string,
	range: string | null,
	db?: Db,
	method: "GET" | "HEAD" = "GET",
): Promise<Response> {
	const row = await getMediaObject(id, db);
	if (!row) {
		// A client-minted identity exists before its bytes; membership is checked first,
		// so a non-member gets the same refusal whatever the import state.
		const pending = await getImportByMediaId(id, db);
		if (
			pending &&
			(pending.status === "uploading" || pending.status === "processing") &&
			(await isWorkspaceMember(pending.workspace, userId, db))
		)
			return Response.json(
				{ error: "media_pending" },
				{ status: 409, headers: { "cache-control": "private, no-store" } },
			);
	}
	if (!row || !(await isWorkspaceMember(row.workspace, userId, db))) {
		return new Response("not_found", {
			status: 404,
			headers: { "cache-control": "private, no-store" },
		});
	}
	const destination = addressMedia(row.storage_key, method);
	if (destination) {
		/* No existence check before redirecting. A registry row exists only after
		 * its PUT succeeded, so a missing object is an operational anomaly, and
		 * the presigned URL reports it by itself — probing first would put a
		 * second round-trip on every asset of every timeline. */
		return new Response(null, {
			status: 302,
			headers: { location: destination, "cache-control": "private, no-store", vary: "Cookie" },
		});
	}
	let blob: Blob;
	try {
		blob = await getMedia(row.storage_key);
	} catch (error) {
		if (error instanceof MediaObjectMissingError)
			return new Response("not_found", {
				status: 404,
				headers: { "cache-control": "private, no-store" },
			});
		throw error;
	}
	const response = await buildUploadResponse(
		{
			size: blob.size,
			type: row.content_type,
			exists: async () => true,
			slice: (start, end) => blob.slice(start, end, row.content_type),
		},
		range,
	);
	response.headers.set("cache-control", "private, no-store");
	// The S3 path carries this as stored object metadata; local must add it here.
	response.headers.set("content-disposition", mediaDisposition(row.content_type));
	return method === "HEAD"
		? new Response(null, { status: response.status, headers: response.headers })
		: response;
}

export function mediaRoutes(): Hono {
	const app = new Hono();
	app.get("/:id/sign", async (c) => {
		const row = await getMediaObject(c.req.param("id"));
		if (!row || !(await isWorkspaceMember(row.workspace, activeCaller(c).userId)))
			return c.json({ error: "not_found" }, 404);
		const url =
			addressMedia(row.storage_key, "GET", externalMediaUrlLifetimeSeconds()) ??
			`/api/media/${row.id}`;
		c.header("cache-control", "private, no-store");
		return c.json({ url });
	});
	app.on(["GET", "HEAD"], "/:id", (c) =>
		serveMedia(
			c.req.param("id"),
			activeCaller(c).userId,
			c.req.header("range") ?? null,
			undefined,
			c.req.method === "HEAD" ? "HEAD" : "GET",
		),
	);
	return app;
}
