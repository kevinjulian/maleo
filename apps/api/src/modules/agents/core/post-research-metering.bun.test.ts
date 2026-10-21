/* The evidence-decision call is ordinary metered text generation.
 *
 * It is an extra model call on the planning path, so the thing to prove is that
 * it is billed like every other one: through the same text runner, recorded once
 * in the ledger with the provider, model, tokens and duration that actually ran —
 * and that it spends no image, audio or video budget, because it generates no
 * asset.
 *
 * This drives the REAL runner against the registered fake provider rather than
 * stubbing `runPrompt`, because stubbing the runner would stub the metering with
 * it and prove nothing. */
import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const tmpDir = mkdtempSync(join(tmpdir(), "evidence-metering-"));
process.env.MALEO_DB_PATH = join(tmpDir, "test.db");

import {
	analyzeEvidenceDecisions,
	type EvidenceDecisionContext,
} from "./post-research-clarification.ts";
import { setTextProviderSelectionReader } from "../../../lib/text-runner.ts";
import { resetFake, setFakeScript } from "../../../lib/ai-provider/providers/fake/index.ts";
import { listUsageRecords } from "../../../lib/credit-service.ts";
import { closeMaleoDb } from "@maleo/db/connection";

const SOURCES = [
	{
		title: "Ohio pension study",
		url: "https://example.test/ohio",
		excerpt: "Ohio's fund compounded at 7.1% over 30 years.",
	},
	{
		title: "Vermont pension study",
		url: "https://example.test/vermont",
		excerpt: "Vermont's fund compounded at 4.4%.",
	},
];

function context(): EvidenceDecisionContext {
	return {
		brief: "why compound interest is counter-intuitive",
		request: "make it about a real pension fund",
		planKind: "explainer",
		language: "en",
		sources: SOURCES,
		priorDecisions: [],
	};
}

async function llmRecords() {
	return (await listUsageRecords()).filter((record) => record.operation === "llm");
}

beforeEach(() => {
	resetFake();
	// Route text generation at the deterministic provider, through the real runner.
	setTextProviderSelectionReader(() => ({ default: { providerId: "fake", model: "fake-1" } }));
});
afterEach(() => {
	resetFake();
	setTextProviderSelectionReader(() => ({}));
});
afterAll(async () => {
	await closeMaleoDb();
	rmSync(tmpDir, { recursive: true, force: true });
});

describe("the evidence call is billed like any other text call", () => {
	test("one call records exactly one llm usage row, with what actually ran", async () => {
		setFakeScript([
			{ when: (prompt) => prompt.includes("EDITORIAL choice"), reply: '{"questions":[]}' },
		]);
		const before = (await llmRecords()).length;

		const outcome = await analyzeEvidenceDecisions(context());

		expect(outcome).toEqual({ kind: "none" });
		const added = (await llmRecords()).slice(before);
		expect(added).toHaveLength(1);
		const record = added[0]!;
		expect(record.provider).toBe("fake");
		expect(record.model).toBe("fake-1");
		expect(record.unit).toBe("estimated_token");
		expect(record.quantity).toBeGreaterThan(0);
		/* Priced through the table like any other text call. The amount is zero here
		 * only because the deterministic test provider is not a billed one — what is
		 * pinned is that the call went through pricing at all and stamped the version
		 * it was priced under, rather than writing an unpriced row. */
		expect(typeof record.charged_credits).toBe("number");
		expect(record.pricing_version).toBeTruthy();
		// Input and output tokens and the call's duration are all carried.
		const metadata = JSON.parse(record.metadata_json ?? "{}") as {
			inputTokens?: number;
			outputTokens?: number;
			durationMs?: number;
		};
		expect(metadata.inputTokens).toBeGreaterThan(0);
		expect(metadata.outputTokens).toBeGreaterThan(0);
		expect(typeof metadata.durationMs).toBe("number");
	});

	test("it spends no image, audio or video budget", async () => {
		setFakeScript([{ when: () => true, reply: '{"questions":[]}' }]);
		const before = (await listUsageRecords()).length;

		await analyzeEvidenceDecisions(context());

		const added = (await listUsageRecords()).slice(before);
		expect(added.map((record) => record.operation)).toEqual(["llm"]);
		expect(added.some((record) => record.operation !== "llm")).toBe(false);
	});

	test("a batch-producing call is billed once, not once per question", async () => {
		setFakeScript([
			{
				when: () => true,
				reply: JSON.stringify({
					id: "b1",
					stage: "post_research",
					purpose: "story_brief",
					questions: [
						{
							id: "case",
							header: "Case study",
							question: "Which fund?",
							options: [
								{
									id: "ohio",
									label: "Ohio",
									value: "Ohio",
									description: "High-return fund.",
									recommended: true,
									sources: [{ title: "Ohio pension study", url: "https://example.test/ohio" }],
								},
								{
									id: "vt",
									label: "Vermont",
									value: "Vermont",
									description: "Low-return counterexample.",
								},
							],
						},
						{
							id: "scope",
							header: "Evidence scope",
							question: "Which period?",
							options: [
								{
									id: "30y",
									label: "30 years",
									value: "30 years",
									description: "The full span.",
									recommended: true,
								},
								{
									id: "10y",
									label: "10 years",
									value: "10 years",
									description: "The recent span.",
								},
							],
						},
					],
				}),
				stderr: "",
			} as never,
		]);
		const before = (await llmRecords()).length;

		const outcome = await analyzeEvidenceDecisions(context());

		expect(outcome.kind).toBe("batch");
		expect((await llmRecords()).slice(before)).toHaveLength(1);
	});

	test("a failing provider still bills nothing it did not spend", async () => {
		// The fake always succeeds, so drive failure through an unselectable
		// provider: selection fails before any generation happens.
		setTextProviderSelectionReader(() => ({
			default: { providerId: "not-a-provider", model: "x" },
		}));
		const before = (await llmRecords()).length;

		const outcome = await analyzeEvidenceDecisions(context());

		expect(outcome.kind).toBe("fallback");
		expect((await llmRecords()).slice(before)).toHaveLength(0);
	});
});
