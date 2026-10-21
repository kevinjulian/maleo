/* The SearXNG + Crawl4AI provider, against captured real responses.
 *
 * `fetch` is stubbed, so nothing here touches the network or the deployed
 * services. The response fixtures are trimmed copies of what the real services
 * returned during the deployment of `infra/searxng` and `infra/crawl4ai`, which is
 * the point: the provider is written against observed shapes, not documented
 * ones, and this is where that stays true.
 */
import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { assertResearchProviderContract } from "./conformance.ts";
import {
	makeSearxngProvider,
	searxngConfigFromEnv,
	ResearchAuthError,
	type SearxngConfig,
} from "./searxng.ts";
import { normalizeAndDedupe } from "../web-research.ts";

const CONFIG: SearxngConfig = {
	searxngUrl: "https://searxng.example",
	crawl4aiUrl: "https://crawl4ai.example",
	accessClientId: "client-id.access",
	accessClientSecret: "client-secret",
	crawl4aiToken: "crawl-token",
};

/* Shapes as observed. SearXNG's snippet field is `content`; Crawl4AI's markdown
 * is a bundle of renderings and its redirect lands in `redirected_url`. */
const SEARCH_BODY = {
	query: "how does a heat pump work",
	results: [
		{
			url: "https://en.wikipedia.org/wiki/Heat_pump",
			title: "Heat pump - Wikipedia",
			content: "A heat pump is a device that transfers heat from a cooler space to a warmer space.",
			engines: ["brave", "google cse"],
		},
		{
			url: "https://arxiv.org/abs/2303.10130",
			title: "GPTs are GPTs",
			content: "An early look at the labor market impact potential.",
			engines: ["arxiv"],
		},
		{ url: "http://127.0.0.1:8080/admin", title: "should be dropped", content: "private host" },
		{ title: "no url at all", content: "dropped for having no url" },
	],
	unresponsive_engines: [],
};

const CRAWL_BODY = {
	results: [
		{
			url: "https://en.wikipedia.org/wiki/Heat_pump",
			redirected_url: "https://en.wikipedia.org/wiki/Heat_pump",
			status_code: 200,
			success: true,
			metadata: { title: "Heat pump - Wikipedia" },
			markdown: {
				raw_markdown: "Jump to content Main menu Navigation Main page ... From Wikipedia",
				fit_markdown:
					"From Wikipedia, the free encyclopedia. A system that transfers heat from one space to another against the temperature gradient.",
			},
		},
	],
};

/* The measured redirect: requested /energy-system/buildings/heat-pumps, served
 * /energy-system/buildings — a different page. */
const CRAWL_REDIRECTED = {
	results: [
		{
			url: "https://www.iea.org/energy-system/buildings/heat-pumps",
			redirected_url: "https://www.iea.org/energy-system/buildings",
			status_code: 302,
			success: true,
			metadata: { title: "Buildings - Energy System - IEA" },
			markdown: {
				raw_markdown: "IEA Close Search ...",
				fit_markdown: "Buildings account for a large share of final energy consumption.",
			},
		},
	],
};

interface Recorded {
	url: string;
	body?: string;
}

const json = (body: unknown, status = 200): Response =>
	new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const realFetch = globalThis.fetch;
afterAll(() => {
	globalThis.fetch = realFetch;
});

/* Every request of the current test, so the contract assertions can read what
 * was actually sent. Reset per test by the hook below; `requests()` closes over
 * the binding rather than an array instance so it always sees the live one. */
let recorded: Recorded[] = [];

function stubFetch(handler: (url: string, init?: RequestInit) => Response): void {
	globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
		const url =
			typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
		const body = typeof init?.body === "string" ? init.body : undefined;
		recorded.push({ url, body });
		return handler(url, init);
	}) as typeof fetch;
}

/* The happy path, routed by host so the failing provider below can share one
 * stub: `broken.example` answers 502, everything else answers a real capture. */
function stubHappy(): void {
	stubFetch((url, init) => {
		if (url.includes("broken.example")) return json({ error: "upstream" }, 502);
		if (url.includes("/search")) return json(SEARCH_BODY);
		if (url.includes("/crawl")) {
			const body = typeof init?.body === "string" ? init.body : "";
			return json(body.includes("iea.org") ? CRAWL_REDIRECTED : CRAWL_BODY);
		}
		return json({}, 404);
	});
}

// Installed for EVERY test; a test that wants a different response calls
// stubFetch itself, which replaces this one.
beforeEach(() => {
	recorded = [];
	stubHappy();
});

const BROKEN: SearxngConfig = {
	...CONFIG,
	searxngUrl: "https://broken.example",
	crawl4aiUrl: "https://broken.example",
};

describe("the provider contract", () => {
	assertResearchProviderContract({
		id: "searxng",
		provider: makeSearxngProvider(CONFIG),
		failing: makeSearxngProvider(BROKEN),
		requests: () => recorded,
		expectsSearchCategories: true,
		expectsPruningFilter: true,
	});
});

describe("search maps SearXNG's shape to the seam's", () => {
	test("url, title and content become url, title and snippet", async () => {
		const hits = await makeSearxngProvider(CONFIG).search("how does a heat pump work", 10);
		expect(hits[0]).toEqual({
			url: "https://en.wikipedia.org/wiki/Heat_pump",
			title: "Heat pump - Wikipedia",
			snippet: "A heat pump is a device that transfers heat from a cooler space to a warmer space.",
		});
	});

	test("a result with no url is dropped by the provider", async () => {
		const hits = await makeSearxngProvider(CONFIG).search("q", 10);
		expect(hits.every((hit) => (hit.url ?? "").length > 0)).toBe(true);
	});

	/* The provider does NOT filter private hosts itself — that is the shared
	 * pipeline's job, above the seam, so it cannot differ between providers. This
	 * asserts the division of labour holds: the loopback url survives the provider
	 * and is rejected by `normalizeAndDedupe`. */
	test("SSRF filtering stays above the seam", async () => {
		const hits = await makeSearxngProvider(CONFIG).search("q", 10);
		expect(hits.some((hit) => hit.url?.includes("127.0.0.1"))).toBe(true);
		expect(normalizeAndDedupe(hits, 10).some((hit) => hit.url.includes("127.0.0.1"))).toBe(false);
	});

	test("the Access service token is sent on search", async () => {
		let headers: HeadersInit | undefined;
		globalThis.fetch = (async (_input: unknown, init?: RequestInit) => {
			headers = init?.headers;
			return json(SEARCH_BODY);
		}) as typeof fetch;
		await makeSearxngProvider(CONFIG).search("q", 5);
		expect((headers as Record<string, string>)["CF-Access-Client-Id"]).toBe("client-id.access");
	});
});

describe("a read reports the page it actually retrieved", () => {
	test("a redirect surfaces as finalUrl", async () => {
		const page = await makeSearxngProvider(CONFIG).readPage(
			"https://www.iea.org/energy-system/buildings/heat-pumps",
		);
		expect(page.finalUrl).toBe("https://www.iea.org/energy-system/buildings");
	});

	test("no redirect leaves finalUrl absent rather than echoing the request", async () => {
		const page = await makeSearxngProvider(CONFIG).readPage(
			"https://en.wikipedia.org/wiki/Heat_pump",
		);
		expect(page.finalUrl).toBeUndefined();
	});

	test("filtered markdown is used, and the nav chrome in raw_markdown is not", async () => {
		const page = await makeSearxngProvider(CONFIG).readPage(
			"https://en.wikipedia.org/wiki/Heat_pump",
		);
		expect(page.text).toContain("From Wikipedia, the free encyclopedia");
		expect(page.text).not.toContain("Main menu");
	});

	test("the Crawl4AI bearer token is sent alongside the Access headers", async () => {
		let headers: Record<string, string> = {};
		globalThis.fetch = (async (_input: unknown, init?: RequestInit) => {
			headers = (init?.headers ?? {}) as Record<string, string>;
			return json(CRAWL_BODY);
		}) as typeof fetch;
		await makeSearxngProvider(CONFIG).readPage("https://en.wikipedia.org/wiki/Heat_pump");
		expect(headers.Authorization).toBe("Bearer crawl-token");
		expect(headers["CF-Access-Client-Secret"]).toBe("client-secret");
	});
});

describe("an auth failure is not an empty result", () => {
	test("a 403 from the fence raises ResearchAuthError on search", async () => {
		stubFetch(() => json({ error: "forbidden" }, 403));
		await expect(makeSearxngProvider(CONFIG).search("q", 5)).rejects.toBeInstanceOf(
			ResearchAuthError,
		);
	});

	test("a 401 from Crawl4AI raises ResearchAuthError on read", async () => {
		stubFetch(() => json({ detail: "Authentication required" }, 401));
		await expect(
			makeSearxngProvider(CONFIG).readPage("https://example.com/x"),
		).rejects.toBeInstanceOf(ResearchAuthError);
	});

	test("a plain server error is not reported as an auth problem", async () => {
		stubFetch(() => json({}, 502));
		await expect(makeSearxngProvider(CONFIG).search("q", 5)).rejects.not.toBeInstanceOf(
			ResearchAuthError,
		);
	});
});

describe("configuration is all-or-nothing", () => {
	const full = {
		MALEO_SEARXNG_URL: "https://searxng.example/",
		MALEO_CRAWL4AI_URL: "https://crawl4ai.example",
		CF_ACCESS_CLIENT_ID: "id.access",
		CF_ACCESS_CLIENT_SECRET: "secret",
	};

	test("complete configuration resolves, with trailing slashes trimmed", () => {
		const config = searxngConfigFromEnv(full as NodeJS.ProcessEnv);
		expect(config?.searxngUrl).toBe("https://searxng.example");
	});

	/* A url without its credentials is not partial configuration to work around:
	 * both services are behind Cloudflare Access, so an uncredentialed request
	 * gets a login page rather than data. "Not configured" lets selection skip
	 * this provider instead of choosing it and then failing. */
	test("a url without credentials is not configured", () => {
		for (const missing of [
			"CF_ACCESS_CLIENT_ID",
			"CF_ACCESS_CLIENT_SECRET",
			"MALEO_CRAWL4AI_URL",
			"MALEO_SEARXNG_URL",
		]) {
			const env = { ...full, [missing]: "" } as NodeJS.ProcessEnv;
			expect(searxngConfigFromEnv(env)).toBeNull();
		}
	});
});
