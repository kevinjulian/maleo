import { describe, expect, test } from "vite-plus/test";
import {
	blockerBatch,
	blockerQuestion,
	openBlockers,
	type OpenBlockerInput,
} from "./open-blockers.ts";
import { storyClarificationBatchSchema } from "./story-clarification.ts";
import type { OutcomeFinding } from "./agent-wire.ts";

function finding(over: Partial<OutcomeFinding> = {}): OutcomeFinding {
	return {
		id: "f1",
		requirementId: "duration_within_tolerance" as OutcomeFinding["requirementId"],
		severity: "blocker",
		message: "Runtime is 22s over the target.",
		...over,
	};
}

const staleDirection: OpenBlockerInput["plan"] = {
	needsDirection: true,
	directionErrors: ["repeated_treatment: beat-a/beat-b: adjacent presentation and novelty repeat"],
};

describe("open blocker ids", () => {
	test("the same condition yields the same id", () => {
		const first = openBlockers({ findings: [finding()] })[0]!;
		const second = openBlockers({ findings: [finding()] })[0]!;
		expect(first.id).toBe(second.id);
	});

	test("a changed condition yields a different id", () => {
		const first = openBlockers({ findings: [finding()] })[0]!;
		const changed = openBlockers({
			findings: [finding({ message: "Runtime is 4s over the target." })],
		})[0]!;
		expect(changed.id).not.toBe(first.id);
	});

	test("the same message from a different source is a different blocker", () => {
		const fromFinding = openBlockers({ findings: [finding({ message: "same text" })] })[0]!;
		const fromPlan = openBlockers({
			plan: { needsDirection: true, directionErrors: ["same text"] },
		})[0]!;
		expect(fromPlan.id).not.toBe(fromFinding.id);
	});
});

describe("open blocker derivation", () => {
	test("nothing unresolved is no blockers", () => {
		expect(openBlockers({})).toEqual([]);
		expect(
			openBlockers({
				findings: [finding({ severity: "warning" })],
				plan: { needsDirection: false },
			}),
		).toEqual([]);
	});

	test("findings only", () => {
		const blockers = openBlockers({
			findings: [finding(), finding({ id: "f2", severity: "warning" })],
		});
		expect(blockers).toHaveLength(1);
		expect(blockers[0]!.source).toBe("outcome_finding");
	});

	test("direction only", () => {
		const blockers = openBlockers({ plan: staleDirection });
		expect(blockers).toHaveLength(1);
		expect(blockers[0]).toMatchObject({ source: "story_direction", remedy: { kind: "redirect" } });
	});

	test("both, with direction first", () => {
		const blockers = openBlockers({ findings: [finding()], plan: staleDirection });
		expect(blockers.map((blocker) => blocker.source)).toEqual([
			"story_direction",
			"outcome_finding",
		]);
	});
});

describe("open blocker remedies", () => {
	test("a finding with a fix offers that command", () => {
		const blockers = openBlockers({ findings: [finding({ fix: { command: "Trim section 3." } })] });
		expect(blockers[0]!.remedy).toEqual({
			kind: "command",
			label: "Apply the fix",
			command: "Trim section 3.",
		});
	});

	test("a finding without a fix offers nothing to apply", () => {
		expect(openBlockers({ findings: [finding()] })[0]!.remedy).toBeUndefined();
	});

	test("an operator-only blocker navigates rather than pretending it can be fixed", () => {
		const blockers = openBlockers({
			plan: {
				needsDirection: true,
				directionBlocked: true,
				directionErrors: ["beat-a: shot 1 requires a product with no roster entity"],
			},
		});
		expect(blockers[0]!.remedy).toEqual({
			kind: "navigate",
			label: "Add the missing reference",
			target: "references",
		});
	});
});

describe("acknowledgement", () => {
	test("an acknowledged blocker is filtered out", () => {
		const open = openBlockers({ plan: staleDirection });
		expect(openBlockers({ plan: staleDirection, acknowledged: [open[0]!.id] })).toEqual([]);
	});

	test("a changed condition reopens an acknowledged blocker", () => {
		const open = openBlockers({ plan: staleDirection });
		const changed = {
			needsDirection: true,
			directionErrors: [
				"repeated_treatment: beat-c/beat-d: adjacent presentation and novelty repeat",
			],
		};
		expect(openBlockers({ plan: changed, acknowledged: [open[0]!.id] })).toHaveLength(1);
	});
});

describe("the batch a card renders", () => {
	test("nothing open is no batch", () => {
		expect(blockerBatch([])).toBeNull();
	});

	test("every open blocker becomes one question, and the batch is valid", () => {
		const open = openBlockers({
			findings: [finding({ fix: { command: "Trim section 3." } })],
			plan: staleDirection,
		});
		const batch = blockerBatch(open)!;
		expect(batch.questions).toHaveLength(2);
		// The contract the card and the submission check already share.
		expect(storyClarificationBatchSchema.safeParse(batch).success).toBe(true);
	});

	test("a blocker with a remedy recommends it; one without recommends leaving it", () => {
		const withFix = blockerQuestion(
			openBlockers({ findings: [finding({ fix: { command: "Trim section 3." } })] })[0]!,
		);
		expect(withFix.options[0]).toMatchObject({ id: "remedy", recommended: true });
		const without = blockerQuestion(openBlockers({ findings: [finding()] })[0]!);
		expect(without.options).toEqual([expect.objectContaining({ id: "leave", recommended: true })]);
	});

	test("the batch id changes with the open set", () => {
		const one = blockerBatch(openBlockers({ findings: [finding()] }))!;
		const two = blockerBatch(openBlockers({ findings: [finding()], plan: staleDirection }))!;
		expect(two.id).not.toBe(one.id);
		expect(one.id.length).toBeLessThanOrEqual(64);
	});
});
