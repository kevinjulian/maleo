/* Every REGISTERED provider runs the contract, not only the ones whose own test
 * file remembered to.
 *
 * This is the research analogue of `provider-conformance`'s reason for
 * existing: the dangerous failure is not a provider that breaks loudly, it is
 * one that is registered, selectable, and quietly does less than the registry
 * assumes. The enumeration assertion below is the part that keeps working after
 * everyone forgets this file exists — registering a provider without declaring a
 * conformance case fails here rather than passing silently.
 *
 * Both providers are driven against fakes: SearXNG over a stubbed `fetch`,
 * BrowserOS over a scripted MCP transport. No network, no daemon.
 */
import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { assertResearchProviderContract, type ResearchProviderCase } from "./conformance.ts";
import { researchProviderIds, type ResearchProviderId } from "./registry.ts";
import { makeSearxngProvider } from "./searxng.ts";
import { makeBrowserosProvider } from "../web-research.ts";
import {
	BrowserosClient,
	type McpCallResult,
	type McpToolInfo,
	type RawMcp,
} from "../browseros-mcp.ts";

const json = (body: unknown, status = 200): Response =>
	new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const SEARCH_BODY = {
	results: [
		{
			url: "https://en.wikipedia.org/wiki/Heat_pump",
			title: "Heat pump",
			content: "A heat pump transfers heat from a cooler space to a warmer one.",
		},
		{ url: "https://arxiv.org/abs/2303.10130", title: "A paper", content: "An abstract." },
	],
};

const crawlBody = (requested: string) => ({
	results: [
		{
			url: requested,
			// Only the IEA fixture redirects, which is the measured case.
			redirected_url: requested.includes("iea.org")
				? "https://www.iea.org/energy-system/buildings"
				: requested,
			status_code: requested.includes("iea.org") ? 302 : 200,
			metadata: { title: "A page" },
			markdown: {
				raw_markdown: "Jump to content Main menu Navigation",
				fit_markdown: "Real article prose about moving heat against a temperature gradient.",
			},
		},
	],
});

let recorded: Array<{ url: string; body?: string }> = [];
const realFetch = globalThis.fetch;
afterAll(() => {
	globalThis.fetch = realFetch;
});

beforeEach(() => {
	recorded = [];
	globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
		const url =
			typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
		const body = typeof init?.body === "string" ? init.body : undefined;
		recorded.push({ url, body });
		if (url.includes("/search")) return json(SEARCH_BODY);
		if (url.includes("/crawl")) {
			const requested = JSON.parse(body ?? "{}").urls?.[0] ?? "";
			return json(crawlBody(requested));
		}
		return json({}, 404);
	}) as typeof fetch;
});

/** A BrowserosClient over a scripted transport: tabs→read, no MCP server. */
function scriptedBrowseros(): BrowserosClient {
	const tools: McpToolInfo[] = [{ name: "tabs" }, { name: "read" }, { name: "web_search" }];
	let nextPage = 0;
	const raw: RawMcp = {
		async listTools() {
			return tools;
		},
		async callTool(name, args): Promise<McpCallResult> {
			if (name === "web_search")
				return { text: JSON.stringify(SEARCH_BODY), isError: false, raw: {} };
			if (name === "tabs" && args.action === "new")
				return { text: `opened page ${++nextPage}`, isError: false, raw: {} };
			if (name === "tabs") return { text: "ok", isError: false, raw: {} };
			if (name === "read") {
				/* Origin marker is what provider re-validates against SSRF —
				 * fail-closed if it is missing, rejected if it is a private host. */
				return {
					text: [
						"[UNTRUSTED_PAGE_CONTENT nonce=n origin=https://en.wikipedia.org/wiki/Heat_pump] follows",
						"A heat pump moves thermal energy against the temperature gradient by doing work on a refrigerant, which is why it can deliver more heat than the electrical energy it consumes.",
					].join("\n"),
					isError: false,
					raw: {},
				};
			}
			return { text: "", isError: false, raw: {} };
		},
		async close() {
			/* noop */
		},
	};
	return new BrowserosClient(raw);
}

/* One case per registered provider. A provider added to the registry without an
 * entry here fails the enumeration test below. */
const CASES: Record<ResearchProviderId, () => ResearchProviderCase> = {
	searxng: () => ({
		id: "searxng",
		provider: makeSearxngProvider({
			searxngUrl: "https://searxng.example",
			crawl4aiUrl: "https://crawl4ai.example",
			accessClientId: "id.access",
			accessClientSecret: "secret",
			crawl4aiToken: "token",
		}),
		requests: () => recorded,
		expectsSearchCategories: true,
		expectsPruningFilter: true,
	}),
	browseros: () => ({
		id: "browseros",
		provider: makeBrowserosProvider(scriptedBrowseros()),
		// No HTTP transport to record, and no SearXNG/Crawl4AI request contracts
		// to assert — those two flags are provider-specific by design.
	}),
};

describe("every registered provider is covered", () => {
	/* The assertion that survives everyone forgetting this file exists. */
	test("a provider cannot be registered without a conformance case", () => {
		for (const id of researchProviderIds()) {
			expect(Object.keys(CASES)).toContain(id);
		}
		// And no case describes a provider the registry does not have.
		for (const id of Object.keys(CASES))
			expect(researchProviderIds()).toContain(id as ResearchProviderId);
	});
});

for (const id of Object.keys(CASES) as ResearchProviderId[]) {
	describe(`registry conformance: ${id}`, () => {
		assertResearchProviderContract(CASES[id]());
	});
}
