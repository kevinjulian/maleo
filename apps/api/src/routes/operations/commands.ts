/* The project command log routes (`p1-command-log`). Mounted under
 * `/projects/:id`, behind the workspace and project scope middleware, so a
 * caller outside the project's workspace is refused before a command runs. */
import type { Hono } from "hono";
import type { EditorCommand } from "@maleo/shared/editor";
import { readCommandLog, submitCommands, writePresentation } from "../../lib/project-commands.ts";
import { presentationPatchBody, submitCommandsBody } from "./request-schemas.ts";

export function registerCommandRoutes(app: Hono): void {
	app.post("/projects/:id/commands", async (c) => {
		const parsed = submitCommandsBody.safeParse(await c.req.json().catch(() => ({})));
		if (!parsed.success) return c.json({ error: "invalid_body", issues: parsed.error.issues }, 400);
		const result = await submitCommands(
			c.req.param("id"),
			parsed.data.baseSeq,
			// SAFETY: the envelope is checked; the engine admits or refuses the command itself.
			parsed.data.commands as { clientCommandId: string; command: EditorCommand }[],
		);
		return result ? c.json(result) : c.json({ error: "project_not_found" }, 404);
	});

	app.get("/projects/:id/commands", async (c) => {
		const raw = c.req.query("after");
		const after = raw === undefined ? undefined : Number(raw);
		if (after !== undefined && (!Number.isInteger(after) || after < 0))
			return c.json({ error: "invalid_after" }, 400);
		const result = await readCommandLog(c.req.param("id"), after);
		return result ? c.json(result) : c.json({ error: "project_not_found" }, 404);
	});

	/* The stored fields outside the editable scope: written alone onto the head,
	 * so a pending command's effect is never sent twice in a whole document. */
	app.patch("/projects/:id/storyboard-presentation", async (c) => {
		const parsed = presentationPatchBody.safeParse(await c.req.json().catch(() => ({})));
		if (!parsed.success) return c.json({ error: "invalid_body", issues: parsed.error.issues }, 400);
		const saved = await writePresentation(c.req.param("id"), parsed.data);
		return saved
			? c.json({ ok: true, version: saved.version })
			: c.json({ error: "project_not_found" }, 404);
	});
}
