/* `GET /projects/:id/asset-manifest`: the media the project's current storyboard and
 * media library reference, with each one's state (`p1-asset-identity` D4). */
import type { Hono } from "hono";
import { getContentProject } from "@maleo/db/project-detail";
import { activeWorkspace } from "../../lib/active-workspace.ts";
import { buildAssetManifest } from "../../lib/asset-manifest.ts";

export function registerAssetManifestRoutes(app: Hono): void {
	app.get("/projects/:id/asset-manifest", async (c) => {
		const workspace = activeWorkspace(c);
		const detail = await getContentProject(c.req.param("id"), undefined, {
			storyboardLimit: 1,
			eventLimit: 0,
		});
		// A project outside the caller's workspace is refused as one that does not exist.
		if (!detail || detail.project.workspace !== workspace)
			return c.json({ error: "project_not_found" }, 404);
		const storyboard = detail.storyboards[0];
		return c.json({
			projectId: detail.project.id,
			storyboardVersion: storyboard?.version ?? null,
			assets: await buildAssetManifest(
				storyboard?.storyboard_json ?? {},
				detail.project.editor_state_json?.media_assets ?? [],
				workspace,
			),
		});
	});
}
