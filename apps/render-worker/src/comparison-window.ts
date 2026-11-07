/* The observation window report (OpenSpec p2-export E8).
 *
 * The window starts at the later of the first comparison and the deployment of
 * the latest Rust fix that resolved a divergence. The switch to Rust is allowed
 * when the window spans at least `days` days and `jobs` compared jobs, with no
 * unexplained divergence in it. The report states this; the operator acts. */

export const WINDOW_DAYS = 14;
export const WINDOW_JOBS = 50;
const DAY_MS = 86_400_000;

export type ComparisonStatus = "passed" | "failed" | "ineligible";
export type Resolution = "rust-fix" | "remotion-defect" | "tolerance-change";

export interface ComparisonRow {
	id: string;
	status: ComparisonStatus;
	created_at: number;
	/** The first failure line, or the ineligible reason. */
	summary: string | null;
	resolution: Resolution | null;
	/** When the `rust-fix` that resolved this divergence was deployed. */
	fix_deployed_at: number | null;
}

export interface WindowReport {
	start: number | null;
	days: number;
	compared: number;
	passed: number;
	failed: number;
	unexplained: { id: string; created_at: number; summary: string | null }[];
	ineligible: { count: number; share: number; reasons: { reason: string; count: number }[] };
	state: "open" | "closed";
	switchAllowed: boolean;
	/** Why the switch is not allowed yet; empty when it is. */
	blockers: string[];
	limits: { days: number; jobs: number };
}

export function windowReport(rows: readonly ComparisonRow[], now: number): WindowReport {
	const first = rows.reduce<number | null>(
		(min, row) => (min == null || row.created_at < min ? row.created_at : min),
		null,
	);
	const fix = rows.reduce<number | null>(
		(max, row) =>
			row.resolution === "rust-fix" &&
			row.fix_deployed_at != null &&
			(max == null || row.fix_deployed_at > max)
				? row.fix_deployed_at
				: max,
		null,
	);
	const start = first == null ? null : Math.max(first, fix ?? first);
	const inside = start == null ? [] : rows.filter((row) => row.created_at >= start);
	const passed = inside.filter((row) => row.status === "passed").length;
	const failedRows = inside.filter((row) => row.status === "failed");
	const ineligibleRows = inside.filter((row) => row.status === "ineligible");
	const compared = passed + failedRows.length;
	const unexplained = failedRows
		.filter((row) => row.resolution == null)
		.map((row) => ({ id: row.id, created_at: row.created_at, summary: row.summary }));
	const reasons = new Map<string, number>();
	for (const row of ineligibleRows) {
		const reason = row.summary ?? "unknown";
		reasons.set(reason, (reasons.get(reason) ?? 0) + 1);
	}
	const days = start == null ? 0 : (now - start) / DAY_MS;
	const closed = days >= WINDOW_DAYS && compared >= WINDOW_JOBS;
	const blockers = [
		...(days < WINDOW_DAYS ? [`window spans ${days.toFixed(1)} of ${WINDOW_DAYS} days`] : []),
		...(compared < WINDOW_JOBS ? [`${compared} of ${WINDOW_JOBS} compared jobs`] : []),
		...(unexplained.length > 0 ? [`${unexplained.length} unexplained divergences`] : []),
	];
	const total = compared + ineligibleRows.length;
	return {
		start,
		days,
		compared,
		passed,
		failed: failedRows.length,
		unexplained,
		ineligible: {
			count: ineligibleRows.length,
			share: total === 0 ? 0 : ineligibleRows.length / total,
			reasons: [...reasons]
				.map(([reason, count]) => ({ reason, count }))
				.sort((a, b) => b.count - a.count),
		},
		state: closed ? "closed" : "open",
		switchAllowed: closed && unexplained.length === 0,
		blockers,
		limits: { days: WINDOW_DAYS, jobs: WINDOW_JOBS },
	};
}
