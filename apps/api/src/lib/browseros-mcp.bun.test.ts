/* BrowserOS MCP client: capability allowlist, tool discovery, connection
 * failure, and the boundary that keeps raw browser-control tools unreachable.
 * No SDK / network — a mock RawMcp is injected. */
import { describe, expect, it } from "bun:test";
import {
	BrowserosClient,
	connectBrowseros,
	getBrowserosStatus,
	isAllowedCapability,
	type McpCallResult,
	type McpToolInfo,
	type RawMcp,
} from "./browseros-mcp.ts";
import { ALLOWED_KEYS } from "./dashboard-env.ts";
import { allDeclaredConfigKeys, listCatalogProviders } from "./provider-catalog.ts";

// A realistic BrowserOS tool surface: a few research tools + many dangerous
// browser-control / app tools that must never be callable.
// Mirrors the real BrowserOS 0.0.119 surface plus a genuine web-search tool.
const TOOLS: McpToolInfo[] = [
	{ name: "tabs", description: "manage tabs" },
	{ name: "navigate", description: "load a url" },
	{ name: "read", description: "extract page content" },
	{ name: "snapshot", description: "a11y tree" },
	{ name: "grep", description: "search the page" },
	{ name: "brave_search", description: "web search" },
	{ name: "act", description: "click/type" },
	{ name: "evaluate", description: "run JS via CDP" },
	{ name: "run", description: "run JS in server runtime" },
	{ name: "upload", description: "upload" },
	{ name: "download", description: "download" },
	{ name: "screenshot", description: "screenshot" },
	{ name: "pdf", description: "save pdf" },
	{ name: "windows", description: "window mgmt" },
	{ name: "execute_action", description: "Strata connector RPC" },
	{ name: "connector_mcp_servers", description: "list connectors" },
	{ name: "search_documentation", description: "connector docs search" },
	{ name: "handle_auth_failure", description: "auth" },
];

function makeRaw(opts?: {
	tools?: McpToolInfo[];
	onCall?: (name: string) => McpCallResult;
}): RawMcp {
	return {
		async listTools() {
			return opts?.tools ?? TOOLS;
		},
		async callTool(name) {
			return opts?.onCall?.(name) ?? { text: `called ${name}`, isError: false, raw: {} };
		},
		async close() {
			/* noop */
		},
	};
}

describe("isAllowedCapability", () => {
	it("allows only required research + page-fetch primitives", () => {
		for (const ok of ["tabs", "read", "brave_search", "web_search", "exa"]) {
			expect(isAllowedCapability(ok)).toBe(true);
		}
		for (const unused of ["navigate", "snapshot", "grep", "diff", "wait", "read_page", "extract"])
			expect(isAllowedCapability(unused)).toBe(false);
	});
	it("blocks browser-control / code-exec / app / exfiltration capabilities", () => {
		for (const bad of [
			"act",
			"evaluate",
			"run",
			"upload",
			"download",
			"screenshot",
			"pdf",
			"windows",
			"execute_action",
			"connector_mcp_servers",
			"search_documentation",
			"handle_auth_failure",
			"get_history",
			"list_bookmarks",
			"gmail_send",
			"get_cookies",
		]) {
			expect(isAllowedCapability(bad)).toBe(false);
		}
	});
});

describe("BrowserOS settings surface", () => {
	/* The endpoint is a PROVIDER field now — declared by the browseros research
	 * provider, edited on its own page, and deliberately no longer in the raw env
	 * table, so it has one editor rather than two. The search override stays in
	 * the raw table: it tunes how the provider talks to the service rather than
	 * naming the service, and no provider declares it. */
	it("declares the endpoint on the provider that uses it", () => {
		const browseros = listCatalogProviders().find((p) => p.id === "browseros");
		expect(browseros?.config.map((f) => f.key)).toContain("BROWSEROS_MCP_URL");
	});

	it("keeps the search override in the raw env table", () => {
		expect(ALLOWED_KEYS).toContain("BROWSEROS_SEARCH_TOOL");
	});

	it("exposes neither retired tool-name override, in either place", () => {
		const declared = allDeclaredConfigKeys().map((k) => k.key);
		for (const retired of ["BROWSEROS_CONTENT_TOOL", "BROWSEROS_NAVIGATE_TOOL"]) {
			expect([...(ALLOWED_KEYS as readonly string[])]).not.toContain(retired);
			expect(declared).not.toContain(retired);
		}
	});
});

describe("BrowserosClient policy wrapper", () => {
	it("lists only allowlisted tools", async () => {
		const c = new BrowserosClient(makeRaw());
		const allowed = (await c.listAllowedTools()).map((t) => t.name);
		expect(allowed).toContain("brave_search");
		expect(allowed).toContain("read");
		expect(allowed).toContain("tabs");
		expect(allowed).not.toContain("act");
		expect(allowed).not.toContain("evaluate");
		expect(allowed).not.toContain("execute_action");
		expect(allowed).not.toContain("search_documentation");
	});

	it("calls an allowed tool", async () => {
		const c = new BrowserosClient(
			makeRaw({ onCall: (n) => ({ text: `ran ${n}`, isError: false, raw: {} }) }),
		);
		const res = await c.callAllowedTool("brave_search", { query: "x" });
		expect(res.text).toBe("ran brave_search");
	});

	it("REFUSES a raw browser-control / code-exec / connector tool — never reaches the transport", async () => {
		let called = false;
		const c = new BrowserosClient(
			makeRaw({
				onCall: () => {
					called = true;
					return { text: "", isError: false, raw: {} };
				},
			}),
		);
		await expect(c.callAllowedTool("evaluate", { code: "x" })).rejects.toThrow(/not allowed/);
		await expect(c.callAllowedTool("execute_action", {})).rejects.toThrow(/not allowed/);
		await expect(c.callAllowedTool("act", { sel: "a" })).rejects.toThrow(/not allowed/);
		await expect(c.callAllowedTool("search_documentation", {})).rejects.toThrow(/not allowed/);
		expect(called).toBe(false);
	});

	it("enforces a per-tool ARGUMENT policy (name allowlist is not enough)", async () => {
		let lastArgs: Record<string, unknown> | undefined;
		const c = new BrowserosClient(
			makeRaw({ onCall: () => ({ text: "ok", isError: false, raw: {} }) }),
		);
		const raw = (c as unknown as { raw: RawMcp }).raw;
		raw.callTool = async (n, a) => {
			lastArgs = a;
			return {
				text: n === "tabs" && a.action === "new" ? "opened page 1" : "ok",
				isError: false,
				raw: {},
			};
		};
		// tabs: only new/close allowed, and page ownership is enforced.
		await expect(
			c.callAllowedTool("tabs", { action: "new", url: "https://a.com" }),
		).resolves.toBeTruthy();
		await expect(
			c.callAllowedTool("tabs", { action: "new", url: "http://127.0.0.1/admin" }),
		).rejects.toThrow(/url not allowed/);
		await expect(
			c.callAllowedTool("tabs", { action: "new", url: "file:///etc/passwd" }),
		).rejects.toThrow(/url not allowed/);
		await expect(c.callAllowedTool("tabs", { action: "close", page: 1 })).resolves.toBeTruthy();
		await expect(c.callAllowedTool("tabs", { action: "close", page: 1 })).rejects.toThrow(
			/not owned/,
		);
		await expect(c.callAllowedTool("tabs", { action: "list" })).rejects.toThrow(/not allowed/);
		await expect(c.callAllowedTool("tabs", { action: "close", page: "mine" })).rejects.toThrow(
			/valid page id/,
		);
		await expect(c.callAllowedTool("tabs", { action: "evaluate" })).rejects.toThrow(/not allowed/);
		await expect(c.callAllowedTool("tabs", { action: "group" })).rejects.toThrow(/not allowed/);
		await expect(c.callAllowedTool("read", { format: "markdown", page: 99 })).rejects.toThrow(
			/not owned/,
		);
		expect(lastArgs).toBeTruthy();
	});

	it("findAllowedTool prefers an exact name then matches the pattern", async () => {
		const c = new BrowserosClient(makeRaw());
		expect((await c.findAllowedTool(/web.?search|brave|(^|_)search$/i, "brave_search"))?.name).toBe(
			"brave_search",
		);
		// A deny-listed exact preference is ignored (never returned).
		expect(await c.findAllowedTool(/evaluate/i, "evaluate")).toBeUndefined();
		// The connector docs-search tool is NOT a web-search match.
		expect(await c.findAllowedTool(/web.?search|brave|(^|_)search$/i)).toBeDefined();
	});
});

describe("getBrowserosStatus", () => {
	it("reports connected + discovered/allowed tools on success", async () => {
		const status = await getBrowserosStatus({ rawFactory: async () => makeRaw() });
		expect(status.connected).toBe(true);
		expect(status.toolCount).toBe(TOOLS.length);
		expect(status.allowedTools).toContain("brave_search");
		expect(status.allowedTools).toContain("read");
		expect(status.allowedTools).not.toContain("act");
		expect(status.allowedTools).not.toContain("snapshot");
		expect(status.allowedTools).not.toContain("search_documentation");
		expect(status.searchTool).toBe("brave_search");
	});

	it("reports unreachable without throwing when BrowserOS is down", async () => {
		const status = await getBrowserosStatus({
			rawFactory: async () => {
				throw new Error("ECONNREFUSED 127.0.0.1:9000");
			},
		});
		expect(status.connected).toBe(false);
		expect(status.error).toMatch(/ECONNREFUSED/);
		expect(status.toolCount).toBeUndefined();
	});
});

describe("connectBrowseros", () => {
	it("propagates a setup-friendly connection failure", async () => {
		await expect(
			connectBrowseros({
				rawFactory: async () => {
					throw new Error("server down");
				},
			}),
		).rejects.toThrow(/server down/);
	});
});
