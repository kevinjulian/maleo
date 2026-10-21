import { Hono } from "hono";
import { getMediaObject } from "@maleo/db/media-objects";
import { getMedia, MediaObjectMissingError } from "@maleo/storage";
import { bearerFrom, isValidServiceToken } from "../lib/service-token.ts";

export function internalMediaRoutes(): Hono {
	const app = new Hono();
	app.get("/:id", async (c) => {
		const token = bearerFrom(c.req.header("authorization")) ?? c.req.header("x-service-token");
		if (!isValidServiceToken(token)) return c.json({ error: "unauthorized" }, 401);
		const row = await getMediaObject(c.req.param("id"));
		if (!row || row.workspace !== c.req.query("workspace"))
			return c.json({ error: "not_found" }, 404);
		let blob: Blob;
		try {
			blob = await getMedia(row.storage_key);
		} catch (error) {
			if (error instanceof MediaObjectMissingError) {
				c.header("cache-control", "private, no-store");
				return c.json({ error: "not_found" }, 404);
			}
			throw error;
		}
		// Streamed, not buffered: a render input is a whole video, and holding one
		// in the API's heap per concurrent job is how this route falls over.
		return new Response(blob.stream(), {
			headers: {
				"content-type": row.content_type,
				"content-length": String(blob.size),
				"cache-control": "private, no-store",
			},
		});
	});
	return app;
}
