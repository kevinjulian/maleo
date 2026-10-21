import { afterAll, expect, test } from "bun:test";
import { closeMaleoDb, openDb } from "./connection.ts";
import {
	deleteMcpServer,
	getMcpServersWithHeaders,
	listMcpServers,
	putMcpServer,
} from "./mcp-servers.ts";

afterAll(async () => {
	await closeMaleoDb();
});

test("headers round-trip sealed: stored encrypted, listed by name only, opened for connecting", async () => {
	await putMcpServer({
		workspace: "ws-a",
		name: "docs",
		url: "https://mcp.example/docs",
		allow: ["lookup"],
		headers: { authorization: "Bearer s3cret-token" },
	});
	const stored = await openDb().get<{ headers_sealed: string }>(
		"SELECT headers_sealed FROM mcp_servers WHERE name = 'docs'",
	);
	expect(stored?.headers_sealed).toBeTruthy();
	expect(stored?.headers_sealed).not.toContain("s3cret-token");

	const [listed] = await listMcpServers("ws-a");
	expect(listed).toMatchObject({ name: "docs", allow: ["lookup"], headerNames: ["authorization"] });
	expect(JSON.stringify(listed)).not.toContain("s3cret-token");
	expect((await getMcpServersWithHeaders("ws-a"))[0]?.headers).toEqual({
		authorization: "Bearer s3cret-token",
	});

	// Updating without headers keeps them; an empty object clears them.
	await putMcpServer({
		workspace: "ws-a",
		name: "docs",
		url: "https://mcp.example/v2",
		allow: ["lookup", "search"],
	});
	expect((await getMcpServersWithHeaders("ws-a"))[0]).toMatchObject({
		url: "https://mcp.example/v2",
		headers: { authorization: "Bearer s3cret-token" },
	});
	await putMcpServer({
		workspace: "ws-a",
		name: "docs",
		url: "https://mcp.example/v2",
		allow: ["lookup"],
		headers: {},
	});
	expect((await getMcpServersWithHeaders("ws-a"))[0]?.headers).toEqual({});

	expect(await listMcpServers("ws-b")).toEqual([]);
	expect(await deleteMcpServer("ws-a", "docs")).toBe(true);
	expect(await listMcpServers("ws-a")).toEqual([]);
});
