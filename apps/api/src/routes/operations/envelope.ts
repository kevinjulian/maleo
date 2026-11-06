/* `GET /projects/:id/envelope`: the project as one portable envelope
 * (`p1-envelope-inspector` E4, `docs/project-envelope.md`). Built from the current
 * storyboard, the media library and the asset manifest, then admitted by the
 * shared engine, so the server never answers with an envelope a client refuses. */
import type { Hono } from "hono";
import { getContentProject } from "@maleo/db/project-detail";
import { projectMediaLibrary } from "@maleo/db/project-media-assets";
import {
	admitEnvelope,
	ENVELOPE_FORMAT,
	ENVELOPE_FORMAT_VERSION,
	storyboardHead,
	storyboardScope,
} from "@maleo/shared/editor";
import { activeWorkspace } from "../../lib/active-workspace.ts";
import { buildAssetManifest } from "../../lib/asset-manifest.ts";
import { editorEngine } from "../../lib/editor-engine.ts";

export function registerEnvelopeRoutes(app: Hono): void {
	app.get("/projects/:id/envelope", async (c) => {
		const workspace = activeWorkspace(c);
		const detail = await getContentProject(c.req.param("id"), undefined, {
			storyboardLimit: 1,
			eventLimit: 0,
		});
		// A project outside the caller's workspace is refused as one that does not exist.
		if (!detail || detail.project.workspace !== workspace)
			return c.json({ error: "project_not_found" }, 404);
		const stored = detail.storyboards[0]?.storyboard_json ?? {};
		const library = await projectMediaLibrary(detail.project.id);
		let head: Record<string, unknown>;
		try {
			head = storyboardHead(stored);
		} catch (error) {
			// The stored document fails the total write, so no envelope can preserve it.
			const message = error instanceof Error ? error.message : String(error);
			return c.json(
				{ error: "envelope_incompatible", reason: "invalid-field", path: "head", message },
				409,
			);
		}
		const envelope = {
			format: ENVELOPE_FORMAT,
			formatVersion: ENVELOPE_FORMAT_VERSION,
			compatibility: { schemaVersion: 2, minReaderVersion: ENVELOPE_FORMAT_VERSION },
			project: { id: detail.project.id, type: detail.project.type, title: detail.project.title },
			scope: storyboardScope(stored, library),
			head,
			manifest: await buildAssetManifest(stored, library, workspace),
		};
		const admission = admitEnvelope(editorEngine(), JSON.stringify(envelope));
		if (!admission.ok) return c.json({ error: "envelope_incompatible", ...admission.refusal }, 409);
		return c.json(admission.envelope);
	});
}
