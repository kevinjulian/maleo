import { afterAll, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Point the job DB at a throwaway file BEFORE importing db.ts (it reads the env
// at module load and opens the database immediately).
const TMP = path.join(os.tmpdir(), `video-jobs-test-${process.pid}-${Date.now()}.db`);
process.env.MALEO_VIDEO_DB = TMP;

const dbmod = await import("../src/db");
const {
	insertJob,
	getJob,
	listJobs,
	countJobs,
	findRecentByHash,
	leaseNext,
	setPhase,
	updateJob,
	requeueJob,
	cancelJob,
	reclaimStale,
	pruneJobs,
	db,
} = dbmod;

let n = 0;
function newJob(over: Partial<Parameters<typeof insertJob>[0]> = {}) {
	n += 1;
	return insertJob({
		id: `job-${n}-${Math.round(Math.random() * 1e9)}`,
		productJson: "{}",
		preset: "tiktok",
		backend: "local",
		...over,
	});
}

afterAll(() => {
	for (const ext of ["", "-wal", "-shm"]) {
		try {
			fs.unlinkSync(TMP + ext);
		} catch {}
	}
});

describe("insert + defaults", () => {
	it("inserts with queued status, queued phase, attempts 0", () => {
		const j = newJob();
		expect(j.status).toBe("queued");
		expect(j.phase).toBe("queued");
		expect(j.attempts).toBe(0);
		expect(j.max_attempts).toBe(3);
	});

	it("persists ops metadata", () => {
		const j = newJob({
			inputHash: "abc",
			draftId: "d1",
			workspace: "sigi",
			presetSource: "policy",
		});
		const got = getJob(j.id)!;
		expect(got.input_hash).toBe("abc");
		expect(got.draft_id).toBe("d1");
		expect(got.workspace).toBe("sigi");
		expect(got.preset_source).toBe("policy");
	});
});

describe("leaseNext", () => {
	it("leases oldest queued job and bumps attempts", () => {
		newJob();
		const leased = leaseNext("worker-A");
		expect(leased).not.toBeNull();
		expect(leased!.status).toBe("running");
		expect(leased!.worker_id).toBe("worker-A");
		expect(leased!.attempts).toBe(1);
		expect(leased!.leased_at).toBeGreaterThan(0);
	});

	it("never leases the same job to two workers (race guard)", () => {
		// drain everything first
		while (leaseNext("drain")) {}
		const a = newJob();
		const first = leaseNext("w1");
		const second = leaseNext("w2");
		expect(first?.id).toBe(a.id);
		// second must be a different job or null, never the same row
		expect(second?.id).not.toBe(a.id);
	});
});

describe("findRecentByHash (dedupe)", () => {
	it("finds a non-terminal-failed job with same hash + preset in window", () => {
		const j = newJob({ inputHash: "dedupe-1" });
		const hit = findRecentByHash("dedupe-1", "tiktok", 60_000);
		expect(hit?.id).toBe(j.id);
	});

	it("ignores jobs outside the window", () => {
		const j = newJob({ inputHash: "dedupe-2" });
		db.run(`UPDATE render_jobs SET created_at = ? WHERE id = ?`, [Date.now() - 120_000, j.id]);
		expect(findRecentByHash("dedupe-2", "tiktok", 60_000)).toBeNull();
	});

	it("ignores errored jobs so a failed render can be retried", () => {
		const j = newJob({ inputHash: "dedupe-3" });
		db.run(`UPDATE render_jobs SET status = 'error' WHERE id = ?`, [j.id]);
		expect(findRecentByHash("dedupe-3", "tiktok", 60_000)).toBeNull();
	});
});

describe("requeueJob", () => {
	it("requeues a failed job with attempts remaining", () => {
		const j = newJob();
		db.run(`UPDATE render_jobs SET status='error', attempts=1, error='x' WHERE id=?`, [j.id]);
		const re = requeueJob(j.id)!;
		expect(re.status).toBe("queued");
		expect(re.error).toBeNull();
		expect(re.progress).toBe(0);
	});

	it("refuses to requeue when attempts exhausted unless forced", () => {
		const j = newJob();
		db.run(`UPDATE render_jobs SET status='error', attempts=3, max_attempts=3 WHERE id=?`, [j.id]);
		expect(requeueJob(j.id)).toBeNull();
		const forced = requeueJob(j.id, { force: true })!;
		expect(forced.status).toBe("queued");
		expect(forced.max_attempts).toBeGreaterThan(3);
	});

	it("won't yank a running job", () => {
		const j = newJob();
		db.run(`UPDATE render_jobs SET status='running' WHERE id=?`, [j.id]);
		expect(requeueJob(j.id)).toBeNull();
	});
});

describe("cancelJob", () => {
	it("cancels a queued job", () => {
		const j = newJob();
		const c = cancelJob(j.id)!;
		expect(c.status).toBe("cancelled");
	});

	it("leaves a done job untouched", () => {
		const j = newJob();
		db.run(`UPDATE render_jobs SET status='done' WHERE id=?`, [j.id]);
		expect(cancelJob(j.id)!.status).toBe("done");
	});

	it("records CANCELLED cause so the UI doesn't show a generic failure", () => {
		const j = newJob();
		const c = cancelJob(j.id)!;
		expect(c.status).toBe("cancelled");
		expect(c.error_code).toBe("CANCELLED");
		expect(c.error).toBe("Render cancelled");
	});
});

describe("reclaimStale", () => {
	it("requeues a stale running job with attempts left", () => {
		const j = newJob();
		db.run(`UPDATE render_jobs SET status='running', leased_at=?, attempts=1 WHERE id=?`, [
			Date.now() - 999_999,
			j.id,
		]);
		const reclaimed = reclaimStale(60_000);
		expect(reclaimed).toBeGreaterThanOrEqual(1);
		expect(getJob(j.id)!.status).toBe("queued");
	});

	it("errors a stale running job with no attempts left", () => {
		const j = newJob();
		db.run(
			`UPDATE render_jobs SET status='running', leased_at=?, attempts=3, max_attempts=3 WHERE id=?`,
			[Date.now() - 999_999, j.id],
		);
		reclaimStale(60_000);
		expect(getJob(j.id)!.status).toBe("error");
	});
});

describe("setPhase", () => {
	it("updates phase + detail", () => {
		const j = newJob();
		setPhase(j.id, "rendering", "frame 12/300");
		const got = getJob(j.id)!;
		expect(got.phase).toBe("rendering");
		expect(got.phase_detail).toBe("frame 12/300");
	});

	it("renews a running job's lease, so a long render that reports is not reclaimed", () => {
		const j = newJob();
		db.run(`UPDATE render_jobs SET status='running', leased_at=?, attempts=1 WHERE id=?`, [
			Date.now() - 999_999,
			j.id,
		]);
		setPhase(j.id, "rendering", "rust: frame 9000/18000");
		expect(getJob(j.id)!.leased_at).toBeGreaterThan(Date.now() - 5_000);
		reclaimStale(60_000);
		expect(getJob(j.id)!.status).toBe("running");
	});
});

describe("image_status (per-scene pill plumbing)", () => {
	it("persists a per-image status JSON array round-trip", () => {
		const j = newJob();
		const items = [
			{ label: "intro", status: "done" },
			{ label: "hook", status: "placeholder" },
			{ label: "cta", status: "generating" },
		];
		updateJob(j.id, { image_status: JSON.stringify(items) });
		const got = getJob(j.id)!;
		expect(got.image_status).not.toBeNull();
		expect(JSON.parse(got.image_status!)).toEqual(items);
	});

	it("defaults image_status to null on a fresh job", () => {
		const j = newJob();
		expect(getJob(j.id)!.image_status).toBeNull();
	});
});

describe("pruneJobs", () => {
	it("keeps active jobs and the N most recent, deletes older terminal rows", () => {
		// make several terminal jobs
		const ids = Array.from({ length: 5 }, () => newJob());
		for (const j of ids) db.run(`UPDATE render_jobs SET status='done' WHERE id=?`, [j.id]);
		const before = countJobs();
		pruneJobs(2);
		const after = countJobs();
		expect(after).toBeLessThan(before);
		// listJobs respects offset/limit
		expect(listJobs(2, 0).length).toBe(2);
	});
});

describe("scoped job pages", () => {
	it("filters before paging and counts with deterministic ties", () => {
		for (let i = 0; i < 70; i++) {
			const j = newJob({
				id: `scoped-${String(i).padStart(3, "0")}`,
				workspace: i % 2 ? "scope-a" : "scope-b",
				projectId: i % 2 ? "project-a" : "project-b",
			});
			updateJob(j.id, { created_at: 123, status: i % 3 ? "done" : "running" });
		}
		const filters = { workspace: "scope-a", projectIds: ["project-a"] };
		const all = listJobs(100, 0, filters);
		expect(all).toHaveLength(35);
		expect(countJobs(filters)).toBe(35);
		expect([...listJobs(20, 0, filters), ...listJobs(20, 20, filters)].map((j) => j.id)).toEqual(
			all.map((j) => j.id),
		);
		expect(all.map((j) => j.id)).toEqual(
			all
				.map((j) => j.id)
				.sort()
				.reverse(),
		);
		expect(listJobs(50, 0, { ...filters, projectIds: [] })).toEqual([]);
		const active = { ...filters, statuses: ["running" as const] };
		expect(listJobs(50, 0, active).every((j) => j.status === "running")).toBe(true);
		expect(countJobs(active)).toBe(listJobs(50, 0, active).length);
	});
	it("includes only explicitly resolved legacy ownership", () => {
		const linked = newJob({ workspace: null, projectId: null });
		const owned = newJob({ workspace: null, projectId: "legacy-p" });
		newJob({ workspace: null, projectId: "other-p" });
		const filters = { workspace: "legacy-w", projectIds: ["legacy-p"], legacyJobIds: [linked.id] };
		expect(new Set(listJobs(50, 0, filters).map((j) => j.id))).toEqual(
			new Set([linked.id, owned.id]),
		);
		expect(countJobs(filters)).toBe(2);
	});
});
