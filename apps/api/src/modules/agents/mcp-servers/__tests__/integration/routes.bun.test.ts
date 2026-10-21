/* adopt-mastra-internal-agent 2.12: configuring a workspace's MCP servers. */
import { afterAll, describe, expect, test } from "bun:test";
import { closeMaleoDb } from "@maleo/db/connection";
import { getMcpServersWithHeaders } from "@maleo/db/mcp-servers";
import { testApp, TEST_CALLER } from "../../../../../middleware/auth-testing.ts";
import { mcpServerRoutes } from "../../index.ts";

const owner = testApp(mcpServerRoutes());
const member = testApp(mcpServerRoutes(), { ...TEST_CALLER, role: "user" });
const json = { "content-type": "application/json" };

afterAll(async () => {
	await closeMaleoDb();
});

describe("an instance owner configures a workspace's MCP servers", () => {
	test("a server is stored with its headers sealed, and listed by header name only", async () => {
		const put = await owner.request("/docs", {
			method: "PUT",
			headers: json,
			body: JSON.stringify({
				url: "https://mcp.example/docs",
				allow: ["lookup"],
				headers: { authorization: "Bearer s3cret" },
			}),
		});
		expect(put.status).toBe(200);
		const listed = await (await owner.request("/")).json();
		expect(listed.items).toMatchObject([
			{
				name: "docs",
				url: "https://mcp.example/docs",
				allow: ["lookup"],
				headerNames: ["authorization"],
			},
		]);
		expect(JSON.stringify(listed)).not.toContain("s3cret");
		expect((await getMcpServersWithHeaders("default"))[0]?.headers).toEqual({
			authorization: "Bearer s3cret",
		});
		expect((await owner.request("/docs", { method: "DELETE" })).status).toBe(204);
		expect((await (await owner.request("/")).json()).items).toEqual([]);
	});

	test("a member can list but not change servers", async () => {
		expect((await member.request("/")).status).toBe(200);
		expect(
			(
				await member.request("/docs", {
					method: "PUT",
					headers: json,
					body: JSON.stringify({ url: "https://mcp.example", allow: ["x"] }),
				})
			).status,
		).toBe(403);
		expect((await member.request("/docs", { method: "DELETE" })).status).toBe(403);
	});

	test("a server with no allowlist, a non-http url or a bad name is refused", async () => {
		expect(
			(
				await owner.request("/docs", {
					method: "PUT",
					headers: json,
					body: JSON.stringify({ url: "https://mcp.example", allow: [] }),
				})
			).status,
		).toBe(400);
		expect(
			(
				await owner.request("/docs", {
					method: "PUT",
					headers: json,
					body: JSON.stringify({ url: "file:///etc/passwd", allow: ["x"] }),
				})
			).status,
		).toBe(400);
		expect(
			(
				await owner.request("/Bad_Name", {
					method: "PUT",
					headers: json,
					body: JSON.stringify({ url: "https://mcp.example", allow: ["x"] }),
				})
			).status,
		).toBe(400);
	});
});
