/* The planning baseline as a differential fixture: each scenario's chat events
 * and the planning work it caused, normalized so two runs of the same scenario
 * compare equal. Captured with MALEO_CAPTURE_PLANNING_BASELINE=1. */
import { expect } from "bun:test";
import { loadRun } from "../../../run-repository.ts";
import { getStoryPlan } from "../../../plan-state.ts";
import { planningCalls } from "./planning-fixture.ts";

const IDENTITY =
	/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|agent-\d+-[a-z0-9]+/g;
const TIME = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/g;
/** Values derived from random identities or the clock. */
const VOLATILE_KEYS = new Set([
	"elapsedSec",
	"hash",
	"contentHash",
	"directionFingerprint",
	"createdAt",
	"updatedAt",
	"startedAt",
]);

/** Identities become ordinals in order of first appearance, so shared ids stay shared. */
export function normalizeDifferential(value: unknown): unknown {
	const ids = new Map<string, string>();
	const text = JSON.stringify(value, (key, entry: unknown) =>
		VOLATILE_KEYS.has(key) ? "<volatile>" : entry,
	)
		.replace(IDENTITY, (id) => {
			if (!ids.has(id)) ids.set(id, `<id:${ids.size}>`);
			return ids.get(id)!;
		})
		.replace(TIME, "<time>");
	return JSON.parse(text);
}

export async function differentialRecord(runId: string) {
	const job = await loadRun(runId);
	if (!job) throw new Error(`run ${runId} not found`);
	/* The product outcome, without the bookkeeping either runtime keeps for itself
	 * (pendingTool, stepOutcomes, planCheckpoint, flows). */
	const run = {
		status: job.status,
		plan: getStoryPlan(job) ?? null,
		direction: job.direction ?? null,
		targetDurationSec: job.targetDurationSec ?? null,
		storyClarification: job.run?.storyClarification ?? null,
		postResearchClarification: job.run?.postResearchClarification ?? null,
		pendingQuestion: job.pendingQuestion ?? null,
		approveAll: job.run?.approveAll ?? false,
		scenes: job.scenes.length,
	};
	return normalizeDifferential({ events: job.events, planningCalls, run });
}

export async function expectDifferential(name: string, runId: string): Promise<void> {
	const record = await differentialRecord(runId);
	const file = new URL(`./planning-differential/${name}.json`, import.meta.url);
	if (process.env.MALEO_CAPTURE_PLANNING_BASELINE === "1")
		await Bun.write(file, `${JSON.stringify(record, null, "\t")}\n`);
	expect(record).toEqual(await Bun.file(file).json());
}
