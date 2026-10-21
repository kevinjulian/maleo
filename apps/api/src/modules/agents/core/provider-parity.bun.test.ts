/* Per-provider parity matrix.
 *
 * Task 9.1 asked to extend `golden-outcome`, `builders-parity` and
 * `crash-matrix` into a per-provider matrix. On inspection none of the three
 * reaches a provider: `golden-outcome` calls `evaluateOutcome` directly,
 * `builders-parity` reads the tool registry, and `crash-matrix` drives the loop
 * through `setAgentDeciderForTests`. Adding a provider dimension to suites that
 * never generate text would have produced a matrix that passes identically for
 * every provider, including one that is broken — worse than no matrix, because
 * it would read as evidence.
 *
 * So the matrix lives here and does the thing those suites cannot: it runs the
 * real generation path once per registered provider and checks the reply is
 * shaped the way the call sites' ad-hoc extractors need. That is the actual
 * risk this change carries — the seam being transparent does not make two
 * models' output equivalent, and the prompts were tuned against one of them.
 *
 * Opt-in, because it spawns real CLI processes against real endpoints: it costs
 * money, takes tens of seconds, and two test processes racing for the same CLI
 * are a flakiness source the in-process concurrency semaphore cannot see (it
 * bounds one process, not the machine). A normal `bun run test` must not do any
 * of that silently.
 *
 *   MALEO_LIVE_PROVIDER_TESTS=1 bun test provider-parity
 *
 * The bookkeeping tests below always run — they are pure and cost nothing.
 *
 * Providers that are not ready SKIP rather than fail, so this is still runnable
 * on a machine with only one CLI installed. The consequence is that a green run
 * does NOT mean every provider passed — read the printed matrix, and see
 * `SUPPORTED_PROVIDERS` for what the product actually treats as supported. */
import { afterAll, describe, expect, test } from "bun:test";
import { PROVIDERS, type AiProvider } from "../../../lib/ai-provider/index.ts";
import { setTextProviderSelectionReader, runPrompt } from "../../../lib/text-runner.ts";

/* Providers the product treats as supported. Kept in lockstep with
 * SUPPORTED_TEXT_PROVIDERS in routes/settings.ts — a provider may only be added
 * here once it has passed this matrix on a machine where it was ready. */
export const SUPPORTED_PROVIDERS: readonly string[] = ["api"];

const LIVE = (process.env.MALEO_LIVE_PROVIDER_TESTS ?? "").trim() === "1";

interface ParityCase {
	name: string;
	prompt: string;
	/** What the call site's extractor needs to find in the reply. */
	check: (reply: string) => boolean;
}

/* Representative of the shapes the sixteen call sites parse: a bare token, a
 * JSON object, and a JSON array. Deliberately small — this suite spends real
 * money and real wall-clock time per provider. */
const CASES: ParityCase[] = [
	{
		name: "returns a bare token without preamble",
		// The intent classifier and direction router both match on a bare word.
		prompt:
			'Reply with exactly one word and nothing else: the word "build". No punctuation, no explanation.',
		check: (reply) => reply.trim().toLowerCase().includes("build"),
	},
	{
		name: "returns a parseable JSON object",
		prompt:
			'Reply with only this JSON object and nothing else, no code fence: {"ok": true, "count": 2}',
		check: (reply) => {
			const parsed = extractJson(reply);
			return parsed != null && (parsed as { ok?: boolean }).ok === true;
		},
	},
	{
		name: "returns a parseable JSON array",
		prompt:
			'Reply with only this JSON array and nothing else, no code fence: [{"name":"a"},{"name":"b"}]',
		check: (reply) => {
			const parsed = extractJson(reply);
			return Array.isArray(parsed) && parsed.length === 2;
		},
	},
];

/* The same forgiving extraction the call sites do: models wrap JSON in fences
 * and prose, and each site strips that its own way. If a provider needs MORE
 * than this to be parsed, it has failed parity — that is the finding. */
function extractJson(reply: string): unknown {
	const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(reply);
	const body = (fenced?.[1] ?? reply).trim();
	const start = body.search(/[[{]/);
	if (start === -1) return null;
	const end = Math.max(body.lastIndexOf("]"), body.lastIndexOf("}"));
	if (end < start) return null;
	try {
		return JSON.parse(body.slice(start, end + 1));
	} catch {
		return null;
	}
}

type ParityOutcome = "passed" | "failed" | "skipped";
const PARITY_RESULTS = new Map<string, { outcome: ParityOutcome; note: string }>();

function withProvider(provider: AiProvider): void {
	setTextProviderSelectionReader(() => ({
		default: {
			providerId: provider.meta.id,
			model: provider.meta.models[0],
			thinking: provider.meta.thinkingLevels[0],
		},
	}));
}

afterAll(() => {
	setTextProviderSelectionReader(() => ({}));
	if (!LIVE) {
		console.log(
			"\n[parity matrix] not run — set MALEO_LIVE_PROVIDER_TESTS=1 to exercise real providers\n",
		);
		return;
	}
	const lines = [...PARITY_RESULTS.entries()].map(
		([id, r]) => `  ${id.padEnd(8)} ${r.outcome.padEnd(8)} ${r.note}`,
	);
	console.log(`\n[parity matrix]\n${lines.join("\n")}`);
	console.log(`[parity matrix] supported: ${SUPPORTED_PROVIDERS.join(", ")}\n`);
});

// The `fake` provider is excluded: it returns scripted replies, so it would
// pass every case by construction and tell us nothing.
const REAL_PROVIDERS = PROVIDERS.filter((p) => p.meta.id !== "fake" && p.text);

describe.each(REAL_PROVIDERS.map((p) => [p.meta.id, p] as const))("parity: %s", (id, provider) => {
	test.each(CASES.map((c) => [c.name, c] as const))(
		"%s",
		async (_name, testCase) => {
			if (!LIVE) return;
			const health = await provider.meta.health("text");
			if (health !== "ready") {
				const reason = (await provider.meta.healthReason?.("text")) ?? health;
				PARITY_RESULTS.set(id, { outcome: "skipped", note: String(reason) });
				console.warn(`[skip] ${id}: ${reason}`);
				return;
			}
			withProvider(provider);
			const { stdout } = await runPrompt(testCase.prompt, { timeoutMs: 120_000 });
			const ok = testCase.check(stdout);
			if (!ok) {
				PARITY_RESULTS.set(id, {
					outcome: "failed",
					note: `${testCase.name}: ${stdout.slice(0, 120)}`,
				});
			} else if (PARITY_RESULTS.get(id)?.outcome !== "failed") {
				PARITY_RESULTS.set(id, { outcome: "passed", note: "all cases" });
			}
			expect(ok).toBe(true);
		},
		180_000,
	);
});

describe("supported-provider bookkeeping", () => {
	test("the API provider is the default and the only supported provider", () => {
		// The default must be a supported provider: an unconfigured system falls
		// through to the first registered one, and that must not be a runner
		// nobody has verified.
		expect(PROVIDERS[0]!.meta.id).toBe("api");
		expect(SUPPORTED_PROVIDERS).toEqual(["api"]);
	});

	test("every supported provider is actually registered", () => {
		const registered = new Set(PROVIDERS.map((p) => p.meta.id));
		for (const id of SUPPORTED_PROVIDERS) expect(registered.has(id)).toBe(true);
	});

	test("the settings route agrees on which providers are supported", async () => {
		// Two lists that must not drift: the UI marks a provider unsupported from
		// the route's copy, and this suite is what earns a place on either.
		const src = await Bun.file(
			new URL("../../../routes/settings.ts", import.meta.url).pathname,
		).text();
		const match = /SUPPORTED_TEXT_PROVIDERS: readonly string\[\] = \[([^\]]*)\]/.exec(src);
		expect(match).not.toBeNull();
		const routeList = match![1]!
			.split(",")
			.map((s) => s.trim().replace(/['"]/g, ""))
			.filter(Boolean);
		expect(routeList).toEqual([...SUPPORTED_PROVIDERS]);
	});
});

describe("the testing provider is never offered to a user", () => {
	test("fake is registered but marked internal", () => {
		const fake = PROVIDERS.find((p) => p.meta.id === "fake");
		expect(fake).toBeDefined();
		// It reports ready unconditionally, so an unmarked fake would look like
		// the healthiest option in a settings dropdown and would return empty
		// text to whoever picked it.
		expect(fake!.meta.internal).toBe(true);
	});

	test("every non-internal provider is an API-backed model; no CLI runner is registered", () => {
		expect(PROVIDERS.filter((x) => !x.meta.internal).map((p) => p.meta.id)).toEqual(["api"]);
	});

	test("the settings route filters internal providers out", async () => {
		const src = await Bun.file(
			new URL("../../../routes/settings.ts", import.meta.url).pathname,
		).text();
		expect(src).toContain("!p.meta.internal");
	});
});
