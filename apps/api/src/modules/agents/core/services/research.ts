/* Research service — web search / page read / bounded research pass, and the
 * living Research card. Imports only leaf modules (the research registry,
 * web-research, agent-trace) + the pure util; takes the AgentJob as data
 * (type-only import), so the orchestrator depends on this one-way (no cycle).
 *
 * Which provider retrieves is the registry's decision, not this module's. The
 * notes below therefore never name a provider: they used to say "BrowserOS not
 * reachable" for every failure, which became a lie the moment a second provider
 * existed, and a misleading one — it points an operator at the wrong service. */
import type { z } from "zod";
import type { searchWebArgs, readWebPageArgs, researchTopicArgs } from "../helpers/schemas.ts";

type SearchWebArgs = z.output<typeof searchWebArgs>;
type ReadWebPageArgs = z.output<typeof readWebPageArgs>;
type ResearchTopicArgs = z.output<typeof researchTopicArgs>;
import type { AgentJob } from "../model.ts";
import { researchOf, setResearch } from "../research-state.ts";
import {
	classifyUrl,
	formatSearchResultsForAgent,
	normalizeAndDedupe,
	RESEARCH_CAPS,
	researchTopic,
	type ResearchBundle,
	type ResearchInput,
	type ResearchProvider,
} from "../../../../lib/web-research.ts";
import { openResearchProvider } from "../../../../lib/research/registry.ts";
import { saveResearchSources } from "../../../../lib/agent-trace.ts";
import { requireTool } from "../../../../lib/capability-scope.ts";

// Test seam: inject a fake research provider (no network of any kind).
let researchProviderOverride: ResearchProvider | null = null;
export function setResearchProviderForTests(p: ResearchProvider | null): void {
	researchProviderOverride = p;
}

/* Resolve through the registry rather than reaching for one provider by name.
 *
 * This used to call `connectBrowseros()` directly, which made the local daemon
 * the only way to ground a plan: no daemon, no sources, and a plan honestly
 * marked ungrounded on every machine that did not happen to be running it.
 * Selection now decides, and there is deliberately no fallthrough — see
 * `lib/research/registry.ts`. */
export async function getResearchProvider(): Promise<{
	provider: ResearchProvider;
	close: () => Promise<void>;
}> {
	// Retrieval is the research_topic tool's; an engine operation must declare it.
	requireTool("research_topic");
	if (researchProviderOverride)
		return { provider: researchProviderOverride, close: async () => {} };
	return await openResearchProvider();
}

// Persist + emit the single living Research card (replace stale in place). Never
// dumps raw page text — only titled, capped excerpts.
async function setResearchArtifact(job: AgentJob, bundle: ResearchBundle): Promise<void> {
	const art = setResearch(job, bundle);
	job.events.push({ kind: "artifact", artifact: art });
	await saveResearchSources(job);
}

// Merge one read page into the job's living research bundle (dedup by url).
export async function addResearchSource(
	job: AgentJob,
	source: ResearchBundle["sources"][number],
): Promise<void> {
	const prev = researchOf(job) ?? {
		topic: job.brief || source.title,
		queries: [],
		sources: [],
		claims: [],
	};
	const sources = [...prev.sources.filter((s) => s.url !== source.url), source];
	await setResearchArtifact(job, {
		...prev,
		sources,
		claims: sources.map((s) => ({ text: s.excerpt, sourceUrls: [s.url] })),
	});
	job.events.push({ kind: "storyboard_patch" });
}

/* Research the same topic again and ADD to what the run already retrieved.
 *
 * `runResearch` replaces the bundle, which is right for a first pass and wrong
 * for the operator asking for more sources on a plan they are reviewing: the
 * sources already cited by that plan must not vanish because a second search
 * ranked differently. Sources are merged by url, the way `addResearchSource`
 * merges a manually read page. */
export async function researchAgain(
	job: AgentJob,
	input: ResearchInput,
): Promise<{ added: number; note: string }> {
	const prior = researchOf(job);
	const { bundle, note } = await runResearch(job, input);
	// A failed pass writes nothing, so what the plan was grounded in is kept; the
	// failure is the caller's to report.
	if (!bundle) return { added: 0, note };
	if (!prior?.sources.length) return { added: bundle.sources.length, note };
	const merged = [...prior.sources];
	let added = 0;
	for (const source of bundle.sources) {
		if (merged.some((s) => s.url === source.url)) continue;
		merged.push(source);
		added++;
	}
	await setResearchArtifact(job, {
		...bundle,
		topic: prior.topic,
		sources: merged,
		claims: merged.map((s) => ({ text: s.excerpt, sourceUrls: [s.url] })),
	});
	return { added, note: `Researched again: ${added} new source(s), ${merged.length} total.` };
}

/** Why a research pass could not run, phrased for an operator.
 *
 *  An auth failure is called out separately because it is otherwise
 *  indistinguishable from "the web had nothing": an expired Cloudflare Access
 *  token and an empty result set both end with no sources, and only one of them
 *  is a configuration problem the operator can fix. */
function unavailableNote(kind: "Research" | "Web search" | "Page read", err: unknown): string {
	const message = err instanceof Error ? err.message : String(err);
	const auth = err instanceof Error && err.name === "ResearchAuthError";
	return auth
		? `${kind} unavailable — the research provider rejected our credentials: ${message}`
		: `${kind} unavailable (the configured research provider could not be reached): ${message}`;
}

// Run a bounded research pass and store the bundle on the job. On provider
// failure: returns null and writes no research (caller stays honest).
export async function runResearch(
	job: AgentJob,
	input: ResearchInput,
): Promise<{ bundle: ResearchBundle | null; note: string }> {
	let ctx: Awaited<ReturnType<typeof getResearchProvider>>;
	try {
		ctx = await getResearchProvider();
	} catch (err) {
		return {
			bundle: null,
			note: `${unavailableNote("Research", err)}. Continuing without verified sources.`,
		};
	}
	try {
		job.events.push({
			kind: "thinking_note",
			title: "Research",
			body: `Searching the web for "${input.topic}"…`,
			elapsedSec: 0,
		});
		const bundle = await researchTopic(ctx.provider, input);
		await setResearchArtifact(job, bundle);
		job.events.push({ kind: "storyboard_patch" });
		if (bundle.sources.length === 0)
			return { bundle, note: `No usable sources found for "${input.topic}".` };
		return {
			bundle,
			note: `Researched "${input.topic}": ${bundle.sources.length} source(s), ${bundle.claims.length} cited claim(s).`,
		};
	} catch (err) {
		const auth = err instanceof Error && err.name === "ResearchAuthError";
		return {
			bundle: null,
			note: auth
				? unavailableNote("Research", err)
				: `Research failed: ${err instanceof Error ? err.message : String(err)}`,
		};
	} finally {
		await ctx.close();
	}
}

// ── Tool flows ──────────────────────────────────────────────────────────────

export async function searchWebFlow(job: AgentJob, args: SearchWebArgs): Promise<{ note: string }> {
	// `searchWebArgs` requires a non-empty `query` and coerces `maxResults` to a
	// positive integer, so the `str()`/`num()` this replaces re-did work the
	// schema had already done. Only the clamp is this function's own rule.
	const query = args.query.trim();
	if (!query) return { note: "No query provided." };
	const maxResults = Math.max(1, Math.min(8, args.maxResults ?? 5));
	let ctx: Awaited<ReturnType<typeof getResearchProvider>>;
	try {
		ctx = await getResearchProvider();
	} catch (err) {
		return { note: unavailableNote("Web search", err) };
	}
	try {
		const hits = await ctx.provider.search(query, maxResults);
		const safe = normalizeAndDedupe(hits, maxResults);
		if (safe.length === 0) return { note: `No safe results for "${query}".` };
		return {
			note: `Found ${safe.length} untrusted source URL(s) for "${query}" (data only):\n${formatSearchResultsForAgent(safe)}`,
		};
	} catch (err) {
		return { note: `Web search failed: ${err instanceof Error ? err.message : String(err)}` };
	} finally {
		await ctx.close();
	}
}

export async function readWebPageFlow(
	job: AgentJob,
	args: ReadWebPageArgs,
): Promise<{ note: string }> {
	const url = args.url.trim();
	const verdict = classifyUrl(url);
	if (!verdict.ok) return { note: `Refused to read "${url}": ${verdict.reason}.` };
	let ctx: Awaited<ReturnType<typeof getResearchProvider>>;
	try {
		ctx = await getResearchProvider();
	} catch (err) {
		return { note: unavailableNote("Page read", err) };
	}
	try {
		const page = await ctx.provider.readPage(verdict.url.toString());
		const excerpt = (page.text ?? "")
			.replace(/\s+/g, " ")
			.trim()
			.slice(0, RESEARCH_CAPS.maxExcerptChars);
		if (excerpt.length < RESEARCH_CAPS.minEvidenceChars)
			return {
				note: `Read ${verdict.url.hostname} — insufficient article evidence (${excerpt.length}/${RESEARCH_CAPS.minEvidenceChars} chars).`,
			};
		const finalUrl =
			page.finalUrl && classifyUrl(page.finalUrl).ok ? page.finalUrl : verdict.url.toString();
		await addResearchSource(job, {
			title: page.title || verdict.url.hostname,
			url: finalUrl,
			excerpt,
			retrievedAt: new Date().toISOString(),
		});
		return {
			note: `Read ${new URL(finalUrl).hostname} — ${excerpt.length} chars extracted and saved to the research card (kept as untrusted evidence, not shown here).`,
		};
	} catch (err) {
		return { note: `Page read failed: ${err instanceof Error ? err.message : String(err)}` };
	} finally {
		await ctx.close();
	}
}

export async function researchTopicFlow(
	job: AgentJob,
	args: ResearchTopicArgs,
): Promise<{ note: string }> {
	const topic = args.topic.trim() || job.brief;
	if (!topic) return { note: "No topic provided." };
	const questions = args.questions?.filter(Boolean).slice(0, 5);
	const maxSources = args.maxSources;
	const { note } = await runResearch(job, { topic, questions, maxSources });
	return { note };
}
