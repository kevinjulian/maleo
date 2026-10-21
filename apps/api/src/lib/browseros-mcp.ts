/* BrowserOS MCP client — bounded, allowlisted access to a locally-running
 * BrowserOS Streamable HTTP MCP server (default http://127.0.0.1:9000/mcp).
 *
 * SECURITY: this module is the single choke point for every BrowserOS call.
 * Maleo only ever uses bounded web-research capabilities (search, owned-tab
 * open/close, page read). Every other BrowserOS
 * capability — click, fill, type, evaluate_script, uploads, downloads, history,
 * bookmarks, Gmail/mail, cookies, arbitrary tab control — is NEVER invoked: callAllowedTool
 * refuses any tool that is not on the allowlist. The chat agent has no direct
 * handle to this client; it reaches research only through web-research.ts.
 *
 * Protocol uses the official MCP SDK. The policy layer (allowlist) is split from
 * the transport (RawMcp) so tests inject a mock RawMcp and never touch the SDK. */

import { textOf } from "@maleo/shared";
import { classifyResearchUrl } from "./research-url.ts";
import { mcpTransport } from "../modules/agents/core/runtime/tools/mcp-client.ts";

export const DEFAULT_BROWSEROS_MCP_URL = "http://127.0.0.1:9000/mcp";
const DEFAULT_TIMEOUT_MS = 20_000;

export interface McpToolInfo {
	name: string;
	description?: string;
	inputSchema?: unknown;
}

export interface McpCallResult {
	/** Flattened text of every text content block returned by the tool. */
	text: string;
	isError: boolean;
	raw: unknown;
}

export interface BrowserosStatus {
	/** A URL is configured (env present or the documented default). */
	configured: boolean;
	url: string;
	/** Reached the server and listed tools. */
	connected: boolean;
	error?: string;
	toolCount?: number;
	allowedTools?: string[];
	searchTool?: string;
}

// Exact BrowserOS tool names Maleo may invoke: only tab open/close + page read
// primitives needed by the provider, plus genuine web-search tools. Checked FIRST so curated-safe
// names are never blocked by a broad deny pattern. Everything else — act,
// evaluate, run, download, upload, screenshot, pdf, windows, tab_groups,
// connector_*, execute_action, get_*, discover_*, search_documentation,
// handle_auth_failure, gmail, etc. — is refused.
const EXPLICIT_ALLOW = new Set([
	"tabs",
	"read",
	"web_search",
	"brave_search",
	"exa_search",
	"exa",
	"serp_search",
	"google_search",
]);

// Narrowed allow patterns for UNKNOWN servers only (the explicit set covers the
// known BrowserOS surface). Note: bare /search/ is intentionally absent so a
// docs/connector "search_documentation" tool is never mistaken for web search.
const ALLOW_PATTERNS: readonly RegExp[] = [
	/web.?search/i,
	/(^|_)search$/i,
	/\bbrave\b/i,
	/\bexa\b/i,
];

// Hard-blocked capabilities. These override any pattern match (but NOT the curated
// EXPLICIT_ALLOW set). Covers every BrowserOS browser-control / app-integration /
// code-execution / exfiltration surface we must never expose.
const DENY_PATTERNS: readonly RegExp[] = [
	/click/i,
	/fill/i,
	/\btype\b/i,
	/press/i,
	/\bkey\b/i,
	/scroll/i,
	/drag/i,
	/drop/i,
	/hover/i,
	/select_?option/i,
	/evaluate/i,
	/execute/i,
	/run_?code/i,
	/script/i,
	/eval/i,
	/upload/i,
	/download/i,
	/history/i,
	/bookmark/i,
	/gmail|e-?mail|\bmail\b/i,
	/cookie/i,
	/storage/i,
	/screenshot/i,
	/\bpdf\b/i,
	/resize/i,
	/dialog/i,
	/\bform\b/i,
	/credential|password|login|\bauth\b/i,
	/connector/i,
	/\bwindows?\b/i,
];

/** True iff `name` is a research capability Maleo is allowed to invoke. The
 *  curated EXPLICIT_ALLOW set wins first; otherwise deny patterns veto, then the
 *  narrowed allow patterns admit known-safe shapes on unfamiliar servers. */
export function isAllowedCapability(name: string): boolean {
	if (!name) return false;
	if (EXPLICIT_ALLOW.has(name.toLowerCase())) return true;
	if (DENY_PATTERNS.some((re) => re.test(name))) return false;
	return ALLOW_PATTERNS.some((re) => re.test(name));
}

// Per-tool ARGUMENT policy — the allowlist gates the tool NAME; this gates the
// ARGS so a permitted tool can't be driven into a dangerous mode. `tabs` is a
// combined list/new/close tool: only those three actions are allowed (never any
// future mutating action). `navigate` may only load/reload a url (no scripted
// back/forward chains). Returns an error string when the args are rejected.
export function validateToolArgs(name: string, args: Record<string, unknown>): string | null {
	const tool = name.toLowerCase();
	if (tool === "tabs") {
		const action = textOf(args.action).toLowerCase();
		if (!["new", "close"].includes(action)) return `tabs action "${action}" not allowed`;
		if (action === "new") {
			const verdict = classifyResearchUrl(typeof args.url === "string" ? args.url : "");
			if (!verdict.ok) return `tabs url not allowed: ${verdict.reason}`;
		}
		if (action === "close" && (!Number.isInteger(args.page) || Number(args.page) < 0))
			return "tabs close requires a valid page id";
	}
	if (tool === "read") {
		const format = textOf(args.format, "markdown").toLowerCase();
		if (!["markdown", "text", "links"].includes(format))
			return `read format "${format}" not allowed`;
		if (!Number.isInteger(args.page) || Number(args.page) < 0)
			return "read requires a valid page id";
	}
	return null;
}

/** Minimal transport contract — the SDK-backed implementation and test mocks
 *  both satisfy it. Returns plain data; policy lives in the wrapper. */
export interface RawMcp {
	listTools(): Promise<McpToolInfo[]>;
	callTool(name: string, args: Record<string, unknown>): Promise<McpCallResult>;
	close(): Promise<void>;
}

export interface BrowserosOptions {
	url?: string;
	timeoutMs?: number;
	/** Force the search tool name; otherwise discovered from tools/list. */
	searchTool?: string;
	/** Test seam: supply a RawMcp instead of connecting over the network. */
	rawFactory?: (url: string, timeoutMs: number) => Promise<RawMcp>;
}

export function browserosUrl(opts?: BrowserosOptions): string {
	return opts?.url || process.env.BROWSEROS_MCP_URL || DEFAULT_BROWSEROS_MCP_URL;
}

export function configuredSearchTool(opts?: BrowserosOptions): string | undefined {
	return opts?.searchTool || process.env.BROWSEROS_SEARCH_TOOL || undefined;
}

/** Flatten an MCP CallToolResult's content blocks into a single text string. */
function flattenContent(result: unknown) {
	const r = result as { content?: unknown; isError?: boolean } | null;
	const isError = Boolean(r?.isError);
	const content = r?.content;
	if (!Array.isArray(content)) return { text: "", isError };
	const text = content
		.map((c) => {
			const block = c as { type?: string; text?: string };
			return block?.type === "text" && typeof block.text === "string" ? block.text : "";
		})
		.filter(Boolean)
		.join("\n");
	return { text, isError };
}

/** Connect to BrowserOS through the shared MCP client (runtime/tools/mcp-client.ts).
 *  Only the transport is shared: BrowserOS is never one of a workspace's agent
 *  servers, so its tools reach research alone, through the allowlist below.
 *  Throws a setup-friendly error if the server is unreachable. */
async function connectSdkRaw(url: string, timeoutMs: number): Promise<RawMcp> {
	try {
		new URL(url);
	} catch {
		throw new Error(`Invalid BROWSEROS_MCP_URL: ${url}`);
	}
	let transport: Awaited<ReturnType<typeof mcpTransport>>;
	try {
		transport = await mcpTransport(url, timeoutMs);
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		throw new Error(
			`Cannot reach BrowserOS MCP at ${url} — is BrowserOS running with MCP enabled? (${msg})`,
		);
	}
	return {
		listTools: () => transport.listTools(),
		async callTool(name, args) {
			const res = await transport.callTool(name, args);
			const { text, isError } = flattenContent(res);
			return { text, isError, raw: res };
		},
		async close() {
			try {
				await transport.close();
			} catch {
				/* best-effort */
			}
		},
	};
}

/** Allowlist-enforcing wrapper around any RawMcp. The chat agent never holds one
 *  of these directly — web-research.ts owns it. */
export class BrowserosClient {
	private toolCache: McpToolInfo[] | null = null;
	private readonly ownedPages = new Set<number>();
	constructor(
		private readonly raw: RawMcp,
		private readonly opts?: BrowserosOptions,
	) {}

	async listTools(): Promise<McpToolInfo[]> {
		if (this.toolCache) return this.toolCache;
		this.toolCache = await this.raw.listTools();
		return this.toolCache;
	}

	/** Discovered tools that pass the capability allowlist. */
	async listAllowedTools(): Promise<McpToolInfo[]> {
		const tools = await this.listTools();
		return tools.filter((t) => isAllowedCapability(t.name));
	}

	/** First allowed tool whose name matches `match` (preferring a configured /
	 *  exact name). Returns undefined if none. */
	async findAllowedTool(match: RegExp, preferred?: string): Promise<McpToolInfo | undefined> {
		const allowed = await this.listAllowedTools();
		if (preferred) {
			const exact = allowed.find((t) => t.name === preferred);
			if (exact) return exact;
		}
		return allowed.find((t) => match.test(t.name));
	}

	/** Call a tool ONLY if it is allowlisted. Refuses everything else — this is the
	 *  boundary that keeps raw browser-control tools unreachable. */
	async callAllowedTool(name: string, args: Record<string, unknown>): Promise<McpCallResult> {
		if (!isAllowedCapability(name)) {
			throw new Error(`BrowserOS capability "${name}" is not allowed for research`);
		}
		const argErr = validateToolArgs(name, args);
		if (argErr) throw new Error(`BrowserOS call rejected: ${argErr}`);
		const tool = name.toLowerCase();
		const page = Number(args.page);
		if (tool === "read" && !this.ownedPages.has(page))
			throw new Error(`BrowserOS call rejected: page ${page} is not owned by research`);
		if (
			tool === "tabs" &&
			String(args.action).toLowerCase() === "close" &&
			!this.ownedPages.has(page)
		)
			throw new Error(`BrowserOS call rejected: page ${page} is not owned by research`);
		const result = await this.raw.callTool(name, args);
		if (tool === "tabs" && String(args.action).toLowerCase() === "new") {
			const openedPage = parseOpenedPageId(result.text);
			if (openedPage != null) this.ownedPages.add(openedPage);
		}
		if (tool === "tabs" && String(args.action).toLowerCase() === "close")
			this.ownedPages.delete(page);
		return result;
	}

	async close(): Promise<void> {
		await this.raw.close();
	}
}

function parseOpenedPageId(text: string): number | undefined {
	try {
		const parsed = JSON.parse(text) as { page?: unknown; id?: unknown; pageId?: unknown };
		const n = Number(parsed.page ?? parsed.id ?? parsed.pageId);
		if (Number.isInteger(n) && n >= 0) return n;
	} catch {
		/* plain-text BrowserOS response */
	}
	const match = text.match(/page\s+(\d+)/i);
	return match ? Number(match[1]) : undefined;
}

/** Connect + wrap. Throws a setup-friendly error on failure. */
export async function connectBrowseros(opts?: BrowserosOptions): Promise<BrowserosClient> {
	const url = browserosUrl(opts);
	const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
	const factory = opts?.rawFactory ?? connectSdkRaw;
	const raw = await factory(url, timeoutMs);
	return new BrowserosClient(raw, opts);
}

/** Non-throwing health probe for the Settings panel. Never leaks endpoint
 *  internals beyond the configured URL the operator already set. */
export async function getBrowserosStatus(opts?: BrowserosOptions): Promise<BrowserosStatus> {
	const url = browserosUrl(opts);
	// An endpoint is always resolvable (the documented default), so "configured"
	// reports whether the operator pinned one explicitly vs falling back.
	const configured = Boolean(opts?.url || process.env.BROWSEROS_MCP_URL);
	let client: BrowserosClient | undefined;
	try {
		client = await connectBrowseros(opts);
		const allowed = await client.listAllowedTools();
		const all = await client.listTools();
		const search = await client.findAllowedTool(/search/i, configuredSearchTool(opts));
		return {
			configured,
			url,
			connected: true,
			toolCount: all.length,
			allowedTools: allowed.map((t) => t.name),
			searchTool: search?.name,
		};
	} catch (err) {
		return {
			configured,
			url,
			connected: false,
			error: err instanceof Error ? err.message : String(err),
		};
	} finally {
		if (client) await client.close().catch(() => {});
	}
}
