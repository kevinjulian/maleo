/* `/api/mcp-servers` — the MCP servers a workspace's agent may use.
 *
 * A server URL reaches whatever the deployment's network reaches, so adding,
 * changing or removing one is the instance owner's, not a workspace owner's.
 * Members may list them; a listing names the stored headers and never shows
 * their values. */
import { Hono } from "hono";
import { deleteMcpServer, listMcpServers, putMcpServer } from "@maleo/db/mcp-servers";
import { activeWorkspace, workspaceScope } from "../../../lib/active-workspace.ts";
import { notInstanceOwnerRefusal } from "../../../middleware/instance-owner.ts";
import { putMcpServerBody, serverName } from "./model.ts";

export function mcpServerRoutes(): Hono {
	const app = new Hono();
	app.use("*", workspaceScope());
	app.get("/", async (c) => c.json({ items: await listMcpServers(activeWorkspace(c)) }));
	app.put("/:name", async (c) => {
		const refusal = notInstanceOwnerRefusal(c);
		if (refusal) return refusal;
		const name = serverName.safeParse(c.req.param("name"));
		const body = putMcpServerBody.safeParse(await c.req.json().catch(() => undefined));
		if (!name.success)
			return c.json({ error: "invalid_request", message: name.error.issues[0]?.message }, 400);
		if (!body.success)
			return c.json({ error: "invalid_request", message: body.error.issues[0]?.message }, 400);
		return c.json({
			item: await putMcpServer({ workspace: activeWorkspace(c), name: name.data, ...body.data }),
		});
	});
	app.delete("/:name", async (c) => {
		const refusal = notInstanceOwnerRefusal(c);
		if (refusal) return refusal;
		const removed = await deleteMcpServer(activeWorkspace(c), c.req.param("name"));
		return removed ? c.body(null, 204) : c.json({ error: "not_found" }, 404);
	});
	return app;
}
