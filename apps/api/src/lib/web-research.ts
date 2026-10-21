/* Factual web research over BrowserOS — search + read + structured citations.
 *
 * Layers:
 *  - URL safety (classifyUrl): only public http(s); blocks file/data/javascript/
 *    chrome schemes and localhost/loopback/private/link-local/metadata hosts.
 *  - Normalization + dedup of raw search hits into unique, safe sources.
 *  - researchTopic(provider, …): runs the bounded pipeline and returns a
 *    ResearchBundle of real, retrieved, cited sources.
 *  - makeBrowserosProvider(client): a ResearchProvider backed by the allowlisted
 *    BrowserOS MCP client. researchTopic itself is provider-agnostic so tests run
 *    against a fake provider with no MCP/network.
 *
 * Retrieved page text is ALWAYS untrusted data — never instructions. This module
 * only extracts excerpts; the planner is told explicitly to treat them as data. */

import { textOf } from "@maleo/shared";
import {
	BrowserosClient,
	configuredSearchTool,
	connectBrowseros,
	type BrowserosOptions,
	type McpToolInfo,
} from "./browseros-mcp.ts";
import {
	classifyResearchUrl,
	researchUrlDedupeKey,
	researchUrlDomain,
	type UrlVerdict,
} from "./research-url.ts";

/* Declared in the run contract: cited sources reach the editor as an artifact. */
import type { ResearchSource } from "@maleo/shared/agent-wire";
export type { ResearchSource } from "@maleo/shared/agent-wire";

export type { UrlVerdict } from "./research-url.ts";

export interface ResearchClaim {
	text: string;
	sourceUrls: string[];
}

export interface ResearchBundle {
	topic: string;
	queries: string[];
	sources: ResearchSource[];
	claims: ResearchClaim[];
}

export interface ResearchInput {
	topic: string;
	questions?: string[];
	maxSources?: number;
}

/** Hard caps — bound result count, pages read, bytes extracted, and excerpt size.
 *  Defends against runaway extraction and oversized untrusted payloads. */
export const RESEARCH_CAPS = {
	maxResultsPerQuery: 8,
	maxSources: 5,
	maxQueries: 5,
	/* How many deduplicated candidates one pass may READ, as its own number
	 * rather than `maxSources × a multiplier`.
	 *
	 * Reads are sequential, so this is the dominant cost of a research pass and
	 * therefore a latency bound as much as a politeness one. It is not derived
	 * from `maxSources` because a derived cap drifts: raising the citeable-source
	 * limit would silently raise the read budget with it. */
	maxCandidates: 10,
	maxPageBytes: 200_000,
	maxExcerptChars: 600,
	maxTitleChars: 200,
	// A source must yield at least this many chars of real article prose to be
	// citeable — drops nav-chrome-only / empty reads.
	minEvidenceChars: 120,
} as const;

/** Reject any non-public destination. Private/loopback/link-local/metadata hosts
 *  and non-http(s) schemes are blocked to prevent SSRF + local exfiltration. */
export function classifyUrl(raw: string): UrlVerdict {
	return classifyResearchUrl(raw);
}

/** Canonical key for dedup — host + path, scheme/query/fragment/trailing-slash
 *  insensitive so the same page from two hits collapses to one source. */
export function dedupeKey(url: URL): string {
	return researchUrlDedupeKey(url);
}

export function domainOf(rawUrl: string): string {
	return researchUrlDomain(rawUrl);
}

function clip(s: string, max: number): string {
	const t = (s ?? "").replace(/\s+/g, " ").trim();
	return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

function searchHitExcerpt(hit: { title: string; snippet: string }): string {
	const snippet = clip(hit.snippet, RESEARCH_CAPS.maxExcerptChars);
	if (snippet.length >= 40) return snippet;
	const title = clip(hit.title, RESEARCH_CAPS.maxTitleChars);
	return [title, snippet].filter(Boolean).join(" — ");
}

export interface RawSearchHit {
	title?: string;
	url?: string;
	snippet?: string;
}
export interface RawPage {
	title?: string;
	text?: string;
	finalUrl?: string;
}

/** Provider seam — the BrowserOS-backed impl or a test fake. */
export interface ResearchProvider {
	search(query: string, maxResults: number): Promise<RawSearchHit[]>;
	readPage(url: string): Promise<RawPage>;
}

/* There is no default question list. The four-query template that used to fill in
 * here ("<topic> bukti sumber primer primary sources", and three more) was phrased
 * for historical subjects and was asked of every topic that reached research — a
 * heat pump was searched for its primary sources. Questions now come from the
 * frame stage, which has the brief in front of it; when it supplies none, the
 * topic alone is the query, which is honest rather than merely longer. */

/** Round-robin result groups so first broad query cannot consume whole source cap. */
export function interleaveSearchHits(groups: RawSearchHit[][]): RawSearchHit[] {
	const out: RawSearchHit[] = [];
	const max = groups.reduce((n, g) => Math.max(n, g.length), 0);
	for (let rank = 0; rank < max; rank++) {
		for (const group of groups) if (group[rank]) out.push(group[rank]!);
	}
	return out;
}

/** Parse a search tool's text payload into hits. Tolerant: accepts a JSON array,
 *  a {results|hits|sources:[…]} envelope, or falls back to scraping URLs from
 *  free text. BrowserOS search backends (Brave/Exa) differ in shape. */
export function normalizeSearchHits(payload: string): RawSearchHit[] {
	const out: RawSearchHit[] = [];
	const text = (payload ?? "").trim();
	if (!text) return out;
	try {
		const parsed = JSON.parse(text);
		const arr = Array.isArray(parsed)
			? parsed
			: (parsed?.results ?? parsed?.hits ?? parsed?.sources ?? parsed?.web?.results ?? null);
		if (Array.isArray(arr)) {
			for (const item of arr) {
				const o = item as Record<string, unknown>;
				const url = str(o.url ?? o.link ?? o.href);
				if (!url) continue;
				out.push({
					url,
					title: str(o.title ?? o.name ?? o.heading),
					snippet: str(o.snippet ?? o.description ?? o.text ?? o.content),
				});
			}
			if (out.length) return out;
		}
	} catch {
		/* not JSON — fall through to URL scraping */
	}
	const urlRe = /https?:\/\/[^\s"'<>)\]]+/g;
	const seen = new Set<string>();
	for (const m of text.matchAll(urlRe)) {
		const url = m[0].replace(/[.,;]+$/, "");
		if (seen.has(url)) continue;
		seen.add(url);
		out.push({ url });
	}
	return out;
}

function str(v: unknown): string {
	return textOf(v);
}

/** Normalize + filter + dedup raw hits into safe, unique candidate sources. */
export function normalizeAndDedupe(
	hits: RawSearchHit[],
	cap: number = RESEARCH_CAPS.maxSources,
): Array<{ url: string; title: string; snippet: string }> {
	const seen = new Set<string>();
	const out: Array<{ url: string; title: string; snippet: string }> = [];
	for (const h of hits) {
		const verdict = classifyUrl(h.url ?? "");
		if (!verdict.ok) continue;
		const key = dedupeKey(verdict.url);
		if (seen.has(key)) continue;
		seen.add(key);
		out.push({
			url: verdict.url.toString(),
			title: clip(h.title || verdict.url.hostname, RESEARCH_CAPS.maxTitleChars),
			snippet: clip(h.snippet || "", RESEARCH_CAPS.maxExcerptChars),
		});
		if (out.length >= cap) break;
	}
	return out;
}

/** Put first result from every domain before second results from any domain. */
export function diversifyByDomain<T extends { url: string }>(items: T[]): T[] {
	const buckets = new Map<string, T[]>();
	for (const item of items) {
		const domain = domainOf(item.url);
		const bucket = buckets.get(domain) ?? [];
		bucket.push(item);
		buckets.set(domain, bucket);
	}
	const out: T[] = [];
	const max = Math.max(0, ...[...buckets.values()].map((bucket) => bucket.length));
	for (let rank = 0; rank < max; rank++) {
		for (const bucket of buckets.values()) if (bucket[rank]) out.push(bucket[rank]!);
	}
	return out;
}

/** Agent receives safe URLs only. Search titles/snippets remain untrusted and
 *  never enter the ReAct transcript where they could act as instructions. */
export function formatSearchResultsForAgent(
	results: Array<{ url: string; title?: string; snippet?: string }>,
): string {
	return results.map((result, index) => `${index + 1}. ${result.url}`).join("\n");
}

/** Run the bounded research pipeline against any provider. Pure orchestration —
 *  no MCP/network here, so it is fully unit-testable. */
export async function researchTopic(
	provider: ResearchProvider,
	input: ResearchInput,
): Promise<ResearchBundle> {
	const topic = (input.topic ?? "").trim();
	const maxSources = Math.max(
		1,
		Math.min(RESEARCH_CAPS.maxSources, input.maxSources ?? RESEARCH_CAPS.maxSources),
	);
	const supplied = (input.questions ?? []).map((q) => q.trim()).filter(Boolean);
	const queries = [topic, ...supplied].filter(Boolean).slice(0, RESEARCH_CAPS.maxQueries);

	// Gather results per query, then interleave by rank for coverage diversity.
	const hitGroups: RawSearchHit[][] = [];
	for (const q of queries) {
		let hits: RawSearchHit[] = [];
		try {
			hits = await provider.search(q, RESEARCH_CAPS.maxResultsPerQuery);
		} catch {
			hits = [];
		}
		hitGroups.push(hits);
	}
	const allHits = interleaveSearchHits(hitGroups);
	const candidateCap = Math.min(allHits.length, RESEARCH_CAPS.maxCandidates);
	const candidates = diversifyByDomain(normalizeAndDedupe(allHits, candidateCap));

	// Read each candidate. A source is ONLY kept when the read succeeds (origin
	// re-validated for SSRF) and yields real article prose — empty / nav-chrome /
	// unsafe-redirect reads are dropped, never cited.
	const sources: ResearchSource[] = [];
	for (const c of candidates) {
		if (sources.length >= maxSources) break;
		const retrievedAt = new Date().toISOString();
		let page: RawPage;
		try {
			page = await provider.readPage(c.url);
		} catch {
			continue; // unread / unsafe redirect → not citeable
		}
		const body = clip(page.text ?? "", RESEARCH_CAPS.maxExcerptChars);
		if (body.length < RESEARCH_CAPS.minEvidenceChars) continue; // no real evidence
		const title = page.title ? clip(page.title, RESEARCH_CAPS.maxTitleChars) : c.title;
		// Cite the FINAL (post-redirect) url when known so the citation is honest.
		const url = page.finalUrl && classifyUrl(page.finalUrl).ok ? page.finalUrl : c.url;
		if (sources.some((source) => dedupeKey(new URL(source.url)) === dedupeKey(new URL(url))))
			continue;
		sources.push({ title, url, excerpt: body, retrievedAt });
	}

	// Some BrowserOS/search providers expose visible result cards but fail page
	// extraction for pages that still look useful to the operator. Keep those safe
	// URLs as fallback references with the search snippet/title as weak evidence,
	// so research does not falsely report "no sources" when public candidates exist.
	for (const c of candidates) {
		if (sources.length >= maxSources) break;
		const excerpt = searchHitExcerpt(c);
		if (excerpt.length < 40) continue;
		if (sources.some((source) => dedupeKey(new URL(source.url)) === dedupeKey(new URL(c.url))))
			continue;
		sources.push({ title: c.title, url: c.url, excerpt, retrievedAt: new Date().toISOString() });
	}

	// Claims are grounded in the retrieved excerpt of each kept source.
	const claims: ResearchClaim[] = sources.map((s) => ({ text: s.excerpt, sourceUrls: [s.url] }));

	return { topic, queries, sources, claims };
}

/** "opened page 3" / JSON {page:3} → 3. */
export function parsePageId(text: string): number | undefined {
	try {
		const j = JSON.parse(text);
		const n = Number(j.page ?? j.id ?? j.pageId);
		if (Number.isFinite(n)) return n;
	} catch {
		/* not json */
	}
	const m = text.match(/page\s+(\d+)/i);
	return m ? Number(m[1]) : undefined;
}

/** BrowserOS `read` wraps output in `[UNTRUSTED_PAGE_CONTENT nonce=… origin=…]
 *  … follows …` markers. Strip the boilerplate so the excerpt is real content —
 *  the text is still handled strictly as untrusted data downstream. */
export function stripUntrustedMarkers(text: string): string {
	return (
		text
			// Opening marker + its "Untrusted page content follows…" preamble line.
			.replace(/\[UNTRUSTED_PAGE_CONTENT[^\]]*\][^\n]*\n?/gi, "")
			// Closing / END markers in any spelling.
			.replace(/\[(?:\/|END_)?UNTRUSTED_PAGE_CONTENT[^\]]*\]/gi, "")
			// BrowserOS emits the literal "(empty)" when a page yields no text.
			.replace(/^\s*\(empty\)\s*/i, "")
			.trim()
	);
}

/** Pull the final `origin=…` URL out of BrowserOS's `[UNTRUSTED_PAGE_CONTENT
 *  nonce=… origin=URL]` marker — the page actually loaded AFTER redirects. Used
 *  to re-validate against SSRF (a result that redirected to a private/localhost
 *  page must be rejected even though the initial url was public). */
export function parseOriginMarker(text: string): string | undefined {
	const m = text.match(/\[UNTRUSTED_PAGE_CONTENT[^\]]*\borigin=([^\s\]]+)/i);
	return m ? m[1] : undefined;
}

/** Reduce markdown page text to readable article prose: drop images, flatten
 *  links to their anchor text, and keep only sentence-like lines (drops nav menus,
 *  link lists, and one-word chrome). */
export function cleanArticleText(md: string): string {
	const flattened = md
		.replace(/!\[[^\]]*\]\([^)]*\)/g, " ") // images
		.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1"); // links → anchor text
	const lines = flattened
		.split("\n")
		.map((l) => l.replace(/\s+/g, " ").trim())
		.filter((l) => {
			if (!l) return false;
			const words = l.split(" ").filter(Boolean).length;
			// Keep real sentences (end punctuation) or substantial prose lines.
			return /[.!?]$/.test(l) ? words >= 4 : words >= 8 && l.length >= 50;
		});
	return lines.join(" ").replace(/\s+/g, " ").trim();
}

/** Build a ResearchProvider over an allowlisted BrowserOS client. Search requires
 *  a genuine web-search MCP tool; page reads use owned tabs. */
export function makeBrowserosProvider(
	client: BrowserosClient,
	opts?: BrowserosOptions,
): ResearchProvider {
	// Page ids THIS provider opened. read/close only ever touch owned pages, so a
	// poisoned page id can never make us read an arbitrary (e.g. user-authenticated)
	// tab — defence-in-depth on top of the per-tool arg policy.
	const ownedPages = new Set<number>();

	// Open a background tab at `url`, read it in `format`, then close the tab
	// (hygiene — never leaves stray tabs). Re-validates the FINAL origin from the
	// page marker against SSRF (rejects post-redirect private/localhost pages).
	// Returns the extracted (markers-stripped) text + the final origin.
	const fetchPage = async (
		url: string,
		format: "text" | "markdown" | "links",
	): Promise<{ text: string; finalUrl?: string }> => {
		const verdict = classifyUrl(url);
		if (!verdict.ok) throw new Error(`unsafe url: ${verdict.reason}`);
		const opened = await client.callAllowedTool("tabs", {
			action: "new",
			url: verdict.url.toString(),
			background: true,
		});
		const page = parsePageId(opened.text);
		if (page == null) throw new Error(`could not open page for ${verdict.url.hostname}`);
		ownedPages.add(page);
		try {
			await new Promise((r) => setTimeout(r, 1500)); // let the page settle
			if (!ownedPages.has(page)) throw new Error("page id not owned");
			const res = await client.callAllowedTool("read", { page, format });
			// SSRF-after-redirect: the page may have redirected somewhere unsafe.
			const finalUrl = parseOriginMarker(res.text);
			if (!finalUrl) throw new Error("BrowserOS response missing final origin marker");
			const fv = classifyUrl(finalUrl);
			if (!fv.ok) throw new Error(`redirected to unsafe url: ${fv.reason}`);
			return {
				text: stripUntrustedMarkers(res.text).slice(0, RESEARCH_CAPS.maxPageBytes),
				finalUrl,
			};
		} finally {
			ownedPages.delete(page);
			await client.callAllowedTool("tabs", { action: "close", page }).catch(() => {});
		}
	};

	let webSearchTool: McpToolInfo | undefined | null = undefined; // null = looked, none found

	return {
		async search(query, maxResults) {
			// Prefer a genuine web-search MCP tool when one exists (not docs/connector
			// search — those are excluded from the allowlist by name).
			if (webSearchTool === undefined) {
				webSearchTool =
					(await client.findAllowedTool(
						/web.?search|brave|\bexa\b|serp|google_search|(^|_)search$/i,
						configuredSearchTool(opts),
					)) ?? null;
			}
			if (!webSearchTool)
				throw new Error("BrowserOS research requires an allowlisted web-search MCP tool");
			const res = await client.callAllowedTool(webSearchTool.name, {
				query,
				count: maxResults,
				max_results: maxResults,
				num_results: maxResults,
			});
			return normalizeSearchHits(res.text).slice(0, maxResults);
		},
		async readPage(url) {
			// Read markdown then reduce to article prose (drops nav chrome).
			const { text, finalUrl } = await fetchPage(url, "markdown");
			return { text: cleanArticleText(text), finalUrl };
		},
	};
}

/** Connect to BrowserOS and run a full research pass — the one entry the
 *  orchestrator calls. The client is opened + closed internally; only the bundle
 *  escapes. Throws if BrowserOS is unavailable (caller degrades to an explicitly
 *  unverified plan). */
export async function researchTopicViaBrowseros(
	input: ResearchInput,
	opts?: BrowserosOptions,
): Promise<ResearchBundle> {
	const client = await connectBrowseros(opts);
	try {
		const provider = makeBrowserosProvider(client, opts);
		return await researchTopic(provider, input);
	} finally {
		await client.close().catch(() => {});
	}
}
