/* The contract every research provider satisfies, and the suite that proves it.
 *
 * Written for the same reason `provider-conformance` was written for media: the
 * failure mode is not a provider that breaks loudly, it is one that keeps
 * working and quietly does less. Two concrete instances, both of which this
 * suite catches and a comment would not:
 *
 *  - a search that stops asking for the `science` category still returns
 *    results, just from two engines instead of seven;
 *  - a read that returns `raw_markdown` instead of `fit_markdown` still returns
 *    text, just navigation menus, which then become the cited excerpt because
 *    the caller takes the first 600 characters.
 *
 * The suite is exported rather than duplicated per provider so a new provider's
 * author does not have to guess which invariants matter.
 */
import { expect, test } from "bun:test";
import { normalizeAndDedupe, type ResearchProvider } from "../web-research.ts";

export interface ResearchProviderCase {
	/** Registry id, used to name the tests. */
	id: string;
	/** A provider wired to fakes — the suite performs no network calls. */
	provider: ResearchProvider;
	/** A provider whose retrieval fails, to prove failure is not fabricated. */
	failing?: ResearchProvider;
	/** Every request this provider issued, for the contract assertions below.
	 *  A provider that reaches no transport (BrowserOS via MCP) omits it. */
	requests?: () => Array<{ url: string; body?: string }>;
	/** Asserted only for providers that talk to SearXNG + Crawl4AI. */
	expectsSearchCategories?: boolean;
	expectsPruningFilter?: boolean;
}

/** Run the whole contract against one provider. */
export function assertResearchProviderContract(subject: ResearchProviderCase): void {
	const { id, provider } = subject;

	test(`${id}: implements both seam methods`, () => {
		expect(typeof provider.search).toBe("function");
		expect(typeof provider.readPage).toBe("function");
	});

	test(`${id}: search returns hits the shared pipeline accepts`, async () => {
		const hits = await provider.search("heat pump coefficient of performance", 5);
		expect(Array.isArray(hits)).toBe(true);
		// The gate that matters: whatever shape the provider's API returns, the
		// pipeline above the seam must be able to classify and dedupe it.
		const safe = normalizeAndDedupe(hits, 5);
		expect(safe.length).toBeGreaterThan(0);
		for (const hit of safe)
			expect(hit.url.startsWith("https://") || hit.url.startsWith("http://")).toBe(true);
	});

	test(`${id}: search honours its result ceiling`, async () => {
		const hits = await provider.search("heat pump", 2);
		expect(hits.length).toBeLessThanOrEqual(2);
	});

	test(`${id}: a read returns text`, async () => {
		const page = await provider.readPage("https://en.wikipedia.org/wiki/Heat_pump");
		expect((page.text ?? "").length).toBeGreaterThan(0);
	});

	/* The redirect case. `researchTopic` cites `finalUrl` when the classifier
	 * accepts it, so a provider that drops the field cites a url whose text it
	 * never read — and the SSRF re-validation on the destination never runs. */
	test(`${id}: a redirected read reports the page it actually retrieved`, async () => {
		const page = await provider.readPage("https://www.iea.org/energy-system/buildings/heat-pumps");
		if (page.finalUrl)
			expect(page.finalUrl).not.toBe("https://www.iea.org/energy-system/buildings/heat-pumps");
	});

	if (subject.failing) {
		const failing = subject.failing;
		test(`${id}: failure is an error or an empty result, never invented content`, async () => {
			let searched: unknown[] | null = null;
			try {
				searched = await failing.search("anything", 5);
			} catch {
				searched = null;
			}
			if (searched !== null) expect(searched.length).toBe(0);

			let read: { text?: string } | null = null;
			try {
				read = await failing.readPage("https://example.com/gone");
			} catch {
				read = null;
			}
			if (read !== null) expect((read.text ?? "").length).toBe(0);
		});
	}

	if (subject.requests) {
		const requests = subject.requests;

		if (subject.expectsSearchCategories) {
			test(`${id}: search asks for the science category, not general alone`, async () => {
				await provider.search("how does a heat pump work", 5);
				const search = requests().find((request) => request.url.includes("/search"));
				expect(search).toBeTruthy();
				const categories = new URL(search!.url).searchParams.get("categories") ?? "";
				// Measured: `general` alone returned 35 results from 2 engines,
				// `general,science` returned 93 from 7. The scholarly engines are the
				// grounding, so dropping the category is a silent quality regression.
				expect(categories).toContain("science");
				expect(new URL(search!.url).searchParams.get("format")).toBe("json");
			});
		}

		if (subject.expectsPruningFilter) {
			test(`${id}: a read asks for filtered markdown, not raw`, async () => {
				await provider.readPage("https://en.wikipedia.org/wiki/Heat_pump");
				const crawl = requests().find((request) => request.url.includes("/crawl"));
				expect(crawl).toBeTruthy();
				// Without the filter the excerpt becomes a navigation menu, because the
				// caller takes the FIRST maxExcerptChars characters of what it is given.
				expect(crawl!.body ?? "").toContain("PruningContentFilter");
			});

			test(`${id}: a read consumes fit_markdown in preference to raw_markdown`, async () => {
				const page = await provider.readPage("https://en.wikipedia.org/wiki/Heat_pump");
				expect(page.text).not.toContain("Jump to content");
			});
		}
	}
}
