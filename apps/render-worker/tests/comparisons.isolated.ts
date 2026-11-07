/* Worker comparison routes and rows (OpenSpec p2-export task 4.3). Own process:
 * `db.ts` opens its database on import (see rust-export.isolated.ts). */
import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = realpathSync(mkdtempSync(join(tmpdir(), "maleo-comparisons-")));
process.env.MALEO_VIDEO_DB = join(ROOT, "jobs.db");
const { db } = await import("../src/db");
const { insertComparison } = await import("../src/comparisons-db");
const { comparisonRoutes } = await import("../src/comparison-routes");

const DAY = 86_400_000;
let clock = Date.now();
const app = comparisonRoutes(() => clock);
afterAll(() => rmSync(ROOT, { recursive: true, force: true }));

function seed(
	count: number,
	status: "passed" | "failed" | "ineligible",
	at: number,
	summary?: string,
) {
	return Array.from({ length: count }, (_, i) => {
		const row = insertComparison({
			jobId: `job-${status}-${at}-${i}`,
			shadowJobId: `shadow-${status}-${at}-${i}`,
			authority: "remotion",
			shadowRenderer: "rust",
			status,
			configVersion: 1,
			failures: status === "failed" ? [summary ?? "frame 3 SSIM 0.9"] : [],
			summary,
		});
		db.run("UPDATE render_comparisons SET created_at = ? WHERE id = ?", [at + i, row.id]);
		return row;
	});
}

const explain = (id: string, body: unknown) =>
	app.request(`/${id}/explain`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(body),
	});

describe("comparison routes", () => {
	const start = Date.UTC(2026, 10, 1);

	test("the window opens, closes at 14 days and 50 jobs, and an unexplained divergence blocks", async () => {
		seed(49, "passed", start);
		const [bad] = seed(1, "failed", start + 1000);
		seed(2, "ineligible", start + 2000, "`lower-third` preset");
		clock = start + 14 * DAY;
		let report = await (await app.request("/report")).json();
		expect([report.state, report.compared, report.switchAllowed]).toEqual(["closed", 50, false]);
		expect(report.unexplained.map((u: { id: string }) => u.id)).toEqual([bad!.id]);
		expect(report.ineligible.count).toBe(2);

		const done = await explain(bad!.id, {
			cause: "Remotion drops a frame",
			resolution: "remotion-defect",
			by: "admin-1",
		});
		expect(done.status).toBe(200);
		expect((await done.json()).explained_by).toBe("admin-1");
		report = await (await app.request("/report")).json();
		expect([report.state, report.switchAllowed]).toEqual(["closed", true]);
	});

	test("a rust-fix explanation needs its commit and deployment, then restarts the window", async () => {
		const [bad] = seed(1, "failed", start + 3 * DAY, "frame 9 SSIM 0.91");
		expect(
			(await explain(bad!.id, { cause: "blur radius", resolution: "rust-fix", by: "admin-1" }))
				.status,
		).toBe(409);
		const deployed = new Date(start + 5 * DAY).toISOString();
		const fixed = await explain(bad!.id, {
			cause: "blur radius",
			resolution: "rust-fix",
			ref: "abc1234",
			deployedAt: deployed,
			by: "admin-1",
		});
		expect(fixed.status).toBe(200);
		clock = start + 14 * DAY;
		const report = await (await app.request("/report")).json();
		expect(report.start).toBe(Date.parse(deployed));
		expect([report.state, report.compared, report.switchAllowed]).toEqual(["open", 0, false]);
	});

	test("bad explanations are refused", async () => {
		const [passed] = seed(1, "passed", start + 6 * DAY);
		expect(
			(await explain(passed!.id, { cause: "x", resolution: "remotion-defect", by: "a" })).status,
		).toBe(409);
		expect(
			(await explain(passed!.id, { cause: "", resolution: "remotion-defect", by: "a" })).status,
		).toBe(400);
		expect(
			(await explain("missing", { cause: "x", resolution: "remotion-defect", by: "a" })).status,
		).toBe(404);
	});

	test("the list filters by status, newest first", async () => {
		const body = await (await app.request("/?status=failed")).json();
		expect(body.items.length).toBeGreaterThan(0);
		expect(body.items.every((row: { status: string }) => row.status === "failed")).toBe(true);
	});
});
