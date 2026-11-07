import { describe, expect, test } from "bun:test";
import { windowReport, type ComparisonRow } from "./comparison-window";

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 10, 1);

function rows(count: number, over: Partial<ComparisonRow> = {}, from = T0): ComparisonRow[] {
	return Array.from({ length: count }, (_, i) => ({
		id: `c${from}-${i}`,
		status: "passed",
		created_at: from + i * 1000,
		summary: null,
		resolution: null,
		fix_deployed_at: null,
		...over,
	}));
}

describe("windowReport", () => {
	test("no comparisons: open, no start", () => {
		const report = windowReport([], T0);
		expect([report.start, report.state, report.switchAllowed]).toEqual([null, "open", false]);
	});

	test("14 days with fewer than 50 jobs stays open and gives the job count", () => {
		const report = windowReport(rows(49), T0 + 15 * DAY);
		expect(report.state).toBe("open");
		expect(report.compared).toBe(49);
		expect(report.blockers).toEqual(["49 of 50 compared jobs"]);
		expect(report.switchAllowed).toBe(false);
	});

	test("50 jobs in under 14 days stays open", () => {
		const report = windowReport(rows(50), T0 + 13 * DAY);
		expect(report.state).toBe("open");
		expect(report.blockers).toEqual(["window spans 13.0 of 14 days"]);
	});

	test("14 days and 50 jobs with no unexplained divergence allows the switch", () => {
		const report = windowReport(rows(50), T0 + 14 * DAY);
		expect([report.state, report.switchAllowed, report.blockers]).toEqual(["closed", true, []]);
	});

	test("an unexplained divergence blocks the switch; an explanation clears it", () => {
		const failed = rows(1, { status: "failed", summary: "frame 3 SSIM 0.9", id: "bad" }, T0 + DAY);
		const blocked = windowReport([...rows(50), ...failed], T0 + 14 * DAY);
		expect(blocked.state).toBe("closed");
		expect(blocked.switchAllowed).toBe(false);
		expect(blocked.unexplained.map((u) => u.id)).toEqual(["bad"]);
		const explained = windowReport(
			[...rows(50), { ...failed[0]!, resolution: "remotion-defect" }],
			T0 + 14 * DAY,
		);
		expect(explained.switchAllowed).toBe(true);
		expect(explained.failed).toBe(1);
	});

	test("a rust-fix explanation restarts the window at its deployment", () => {
		const deployed = T0 + 10 * DAY;
		const fixed = rows(
			1,
			{ status: "failed", resolution: "rust-fix", fix_deployed_at: deployed, id: "fix" },
			T0 + DAY,
		);
		const after = rows(50, {}, deployed + 1000);
		const report = windowReport([...rows(50), ...fixed, ...after], T0 + 20 * DAY);
		expect(report.start).toBe(deployed);
		expect(report.compared).toBe(50);
		expect(report.state).toBe("open");
		expect(report.blockers).toEqual(["window spans 10.0 of 14 days"]);
		expect(windowReport([...rows(50), ...fixed, ...after], deployed + 14 * DAY).switchAllowed).toBe(
			true,
		);
	});

	test("ineligible jobs report their share and reasons, outside the compared count", () => {
		const report = windowReport(
			[
				...rows(3),
				...rows(1, { status: "ineligible", summary: "lower-third preset" }, T0 + 1),
				...rows(
					1,
					{ status: "ineligible", summary: "Product presets render through Remotion" },
					T0 + 2,
				),
				...rows(1, { status: "ineligible", summary: "lower-third preset" }, T0 + 3),
			],
			T0 + DAY,
		);
		expect(report.compared).toBe(3);
		expect(report.ineligible).toEqual({
			count: 3,
			share: 0.5,
			reasons: [
				{ reason: "lower-third preset", count: 2 },
				{ reason: "Product presets render through Remotion", count: 1 },
			],
		});
	});
});
