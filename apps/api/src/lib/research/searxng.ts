/* Research retrieval over the self-hosted SearXNG + Crawl4AI pair.
 *
 * Search is SearXNG's JSON API; page reads are Crawl4AI's extraction API. Both
 * are deployed from `infra/searxng` and `infra/crawl4ai`, fenced behind one
 * Cloudflare Access application, and reached over the public FQDN because the
 * API does not run on that host.
 *
 * This file is RETRIEVAL ONLY. URL classification, dedupe, domain
 * diversification, excerpt caps and exact-quote validation all live above the
 * seam in `../web-research.ts`, so they cannot differ between providers. In
 * particular: retrieved text is untrusted data here exactly as it is for a
 * scraped page — a tidy JSON envelope is not a trust signal.
 *
 * Three request details are load-bearing and were each measured against the
 * deployed services rather than read from documentation. They are asserted by
 * the conformance suite, not just commented, because a provider that quietly
 * stops sending one still works — just worse, and invisibly.
 */
import { z } from "zod";
import {
	RESEARCH_CAPS,
	type RawPage,
	type RawSearchHit,
	type ResearchProvider,
} from "../web-research.ts";
import { resolveConfig } from "@maleo/shared/provider-config";

/** Everything this provider needs, absent when it is not configured. */
export interface SearxngConfig {
	searxngUrl: string;
	crawl4aiUrl: string;
	/** Cloudflare Access service token — one application fences both services. */
	accessClientId: string;
	accessClientSecret: string;
	/** Crawl4AI's own credential. Upstream refuses a non-loopback bind without
	 *  it, so a deployment that answers at all has one. */
	crawl4aiToken?: string;
	/** Per-request ceiling. Search is fast; extraction runs a browser. */
	searchTimeoutMs?: number;
	readTimeoutMs?: number;
}

const DEFAULT_SEARCH_TIMEOUT_MS = 30_000;
const DEFAULT_READ_TIMEOUT_MS = 120_000;

/* SearXNG's scholarly engines — arxiv, pubmed, semantic scholar, google
 * scholar, crossref, openalex — all sit in the `science` category, and a request
 * that does not name it never reaches them. Measured on one technical brief:
 * `general` alone returned 35 results from 2 engines; this returned 93 from 7
 * with no unresponsive engines, 58 of them scholarly. Those keyless
 * captcha-free indexes are what actually ground an explainer, so omitting the
 * category switches off the better half of the instance. */
const SEARCH_CATEGORIES = "general,science";

/* Crawl4AI returns several markdown renderings. `raw_markdown` opens with
 * navigation — "Jump to content / Main menu / Navigation" — and the caller takes
 * the FIRST `maxExcerptChars` characters, so raw output would make the excerpt a
 * menu and the exact-quote validation would then either fail or validate against
 * a nav bar. The pruning filter moved the Wikipedia heat-pump page from 146,499
 * to 91,919 chars and its opening to real prose. */
const CRAWL_CONFIG = {
	type: "CrawlerRunConfig",
	params: {
		word_count_threshold: 30,
		excluded_tags: ["nav", "footer", "header", "aside", "form", "script", "style"],
		exclude_external_links: true,
		markdown_generator: {
			type: "DefaultMarkdownGenerator",
			params: {
				content_filter: {
					type: "PruningContentFilter",
					params: { threshold: 0.45, threshold_type: "dynamic" },
				},
			},
		},
	},
} as const;

function trimUrl(value: string | undefined): string {
	return (value ?? "").trim().replace(/\/+$/, "");
}

/** Read the configuration from the environment, or null when incomplete.
 *
 *  A URL without its credentials is NOT partial configuration to work around:
 *  both services are behind Cloudflare Access, so a request without the service
 *  token gets an Access login page rather than data. Reporting "not configured"
 *  is the honest answer and lets selection skip this provider. */
export const SEARXNG_CONFIG_KEYS = [
	"MALEO_SEARXNG_URL",
	"MALEO_CRAWL4AI_URL",
	"CF_ACCESS_CLIENT_ID",
	"CF_ACCESS_CLIENT_SECRET",
	"CRAWL4AI_API_TOKEN",
] as const;

/* `env` stays injectable for the tests that build a config by hand. Production
 * passes nothing and resolves through the shared seam, so a value stored in
 * settings reaches this provider in every process — which reading `process.env`
 * here directly could not do. */
export function searxngConfigFromEnv(env?: NodeJS.ProcessEnv): SearxngConfig | null {
	const read = (key: string): string | undefined => (env ? env[key] : resolveConfig(key));
	const searxngUrl = trimUrl(read("MALEO_SEARXNG_URL"));
	const crawl4aiUrl = trimUrl(read("MALEO_CRAWL4AI_URL"));
	const accessClientId = (read("CF_ACCESS_CLIENT_ID") ?? "").trim();
	const accessClientSecret = (read("CF_ACCESS_CLIENT_SECRET") ?? "").trim();
	if (!searxngUrl || !crawl4aiUrl || !accessClientId || !accessClientSecret) return null;
	return {
		searxngUrl,
		crawl4aiUrl,
		accessClientId,
		accessClientSecret,
		crawl4aiToken: (read("CRAWL4AI_API_TOKEN") ?? "").trim() || undefined,
	};
}

/** Raised when the fence rejected us, so the caller can say "authentication"
 *  rather than "the web had nothing". An expired Access token and an empty
 *  result set are the same shape to `researchTopic` otherwise, and the second
 *  reads as a quality problem while the first is an outage. */
export class ResearchAuthError extends Error {
	constructor(service: string, status: number) {
		super(
			`${service} rejected the research credentials (HTTP ${status}) — check the Cloudflare Access service token and the Crawl4AI API token`,
		);
		this.name = "ResearchAuthError";
	}
}

/* Both responses are parsed rather than asserted. They are external payloads
 * from services this process does not control, and the repo rule is the right
 * one here: validate at the boundary, so a shape change upstream surfaces as a
 * parse failure instead of `undefined` reaching the citation pipeline. Every
 * field is optional because neither service promises them and a partial result
 * is still usable. */
const searxngSearchResponse = z.object({
	results: z
		.array(
			z.object({
				url: z.string().optional(),
				title: z.string().optional(),
				/* SearXNG calls the snippet `content`. */
				content: z.string().optional(),
			}),
		)
		.default([]),
});

/** Crawl4AI's markdown is either a plain string or a bundle of renderings. */
const crawlMarkdown = z.union([
	z.string(),
	z.object({
		fit_markdown: z.string().optional(),
		raw_markdown: z.string().optional(),
	}),
]);

const crawl4aiCrawlResponse = z.object({
	results: z
		.array(
			z.object({
				markdown: crawlMarkdown.optional(),
				metadata: z.object({ title: z.string().optional() }).optional(),
				redirected_url: z.string().optional(),
			}),
		)
		.default([]),
});

/** The filtered rendering, falling back to raw only because a short page can
 *  prune to nothing and some evidence beats none. */
function pickMarkdown(markdown: z.infer<typeof crawlMarkdown> | undefined): string {
	if (typeof markdown === "string") return markdown;
	if (!markdown) return "";
	return markdown.fit_markdown || markdown.raw_markdown || "";
}

export function makeSearxngProvider(config: SearxngConfig): ResearchProvider {
	const accessHeaders = {
		"CF-Access-Client-Id": config.accessClientId,
		"CF-Access-Client-Secret": config.accessClientSecret,
	};

	return {
		async search(query: string, maxResults: number): Promise<RawSearchHit[]> {
			const url = new URL(`${config.searxngUrl}/search`);
			url.searchParams.set("q", query);
			url.searchParams.set("format", "json");
			url.searchParams.set("categories", SEARCH_CATEGORIES);
			const response = await fetch(url, {
				headers: accessHeaders,
				signal: AbortSignal.timeout(config.searchTimeoutMs ?? DEFAULT_SEARCH_TIMEOUT_MS),
			});
			if (response.status === 401 || response.status === 403)
				throw new ResearchAuthError("searxng", response.status);
			if (!response.ok) throw new Error(`searxng search failed: HTTP ${response.status}`);
			const parsed = searxngSearchResponse.safeParse(await response.json());
			if (!parsed.success)
				throw new Error(`searxng returned an unrecognised response shape: ${parsed.error.message}`);
			// Mapped to the seam's shape and nothing more: normalizeAndDedupe above
			// the seam classifies, dedupes and caps these.
			return parsed.data.results
				.map((result) => ({
					url: result.url ?? "",
					title: result.title ?? "",
					snippet: result.content ?? "",
				}))
				.filter((hit) => hit.url.length > 0)
				.slice(0, Math.max(1, maxResults));
		},

		async readPage(url: string): Promise<RawPage> {
			const headers: Record<string, string> = {
				...accessHeaders,
				"Content-Type": "application/json",
			};
			if (config.crawl4aiToken) headers.Authorization = `Bearer ${config.crawl4aiToken}`;
			const response = await fetch(`${config.crawl4aiUrl}/crawl`, {
				method: "POST",
				headers,
				body: JSON.stringify({ urls: [url], crawler_config: CRAWL_CONFIG }),
				signal: AbortSignal.timeout(config.readTimeoutMs ?? DEFAULT_READ_TIMEOUT_MS),
			});
			if (response.status === 401 || response.status === 403)
				throw new ResearchAuthError("crawl4ai", response.status);
			if (!response.ok) throw new Error(`crawl4ai read failed: HTTP ${response.status}`);
			const parsed = crawl4aiCrawlResponse.safeParse(await response.json());
			if (!parsed.success)
				throw new Error(
					`crawl4ai returned an unrecognised response shape: ${parsed.error.message}`,
				);
			const result = parsed.data.results[0];
			if (!result) throw new Error("crawl4ai returned no result for the requested url");
			const text = pickMarkdown(result.markdown).slice(0, RESEARCH_CAPS.maxPageBytes);
			/* The redirect destination, when there was one. Load-bearing: a request
			 * for /energy-system/buildings/heat-pumps returned content from
			 * /energy-system/buildings — a DIFFERENT page. Dropping this field cites
			 * a url whose text was never read, and skips the SSRF re-validation
			 * `researchTopic` runs on the final url. */
			const redirected = result.redirected_url ?? "";
			return {
				text,
				title: result.metadata?.title || undefined,
				finalUrl: redirected && redirected !== url ? redirected : undefined,
			};
		},
	};
}
