/* In-process registry of live agent runs. The JOBS map is a per-process cache of
 * running/awaiting jobs; getters let a client resume polling by project without a
 * jobId. Durable rehydration (rehydrate.ts) rebuilds a parked run from the DB when
 * this cache misses (redeploy / different instance). */
import type { AgentJob } from "./model.ts";
import { rehydrateLatestAwaitingPipelineJob } from "./rehydrate.ts";
import { loadRun, loadLatestActiveRun, loadLatestRunningRun } from "./run-repository.ts";

export const JOBS = new Map<string, AgentJob>();

// Re-seed the per-process cache from a DB-loaded job so subsequent in-memory reads
// (and mutations during the run) hit the same object.
function cache(job: AgentJob | undefined): AgentJob | undefined {
	if (job) JOBS.set(job.id, job);
	return job;
}

async function durableOrFresh(job: AgentJob): Promise<boolean> {
	const stored = await loadRun(job.id);
	if (stored) return stored.status === job.status;
	return Date.now() - job.startedAt < 2 * 60_000;
}

export async function getAgentJob(id: string): Promise<AgentJob | undefined> {
	const local = JOBS.get(id);
	const stored = await loadRun(id);
	if (local && (!stored || stored.status === local.status)) return local;
	return cache(stored);
}

// True when the run is live in THIS process's cache — i.e. a loop is actively
// driving it here. The stale reaper uses this to never kill a locally-running run
// (a long single tool like generate_video_assets can go minutes between persists,
// which would otherwise look stale). A run only in the DB (cache miss) is a
// candidate for reaping after a restart.
export function isJobLive(id: string): boolean {
	return JOBS.has(id);
}

export function clearAgentJobsForTests(): void {
	JOBS.clear();
}

// Most recent still-running job for a project — lets the client resume polling
// (e.g. after a remount) without a jobId.
export async function getLatestRunningJobForProject(
	projectId: string,
): Promise<AgentJob | undefined> {
	let best: AgentJob | undefined;
	for (const j of JOBS.values()) {
		if (j.projectId !== projectId || j.status !== "running") continue;
		if (!(await durableOrFresh(j))) continue;
		if (!best || j.startedAt > best.startedAt) best = j;
	}
	// DB-first fallback: a running job started on a different instance / before a
	// redeploy isn't in this cache — load it from workflow_run (no-op when flag off).
	const db = await loadLatestRunningRun(projectId);
	return best && (!db || best.startedAt >= db.startedAt) ? best : cache(db);
}

export async function getLatestActiveJobForProject(
	projectId: string,
): Promise<AgentJob | undefined> {
	let best: AgentJob | undefined;
	for (const j of JOBS.values()) {
		if (j.projectId !== projectId || (j.status !== "running" && j.status !== "awaiting_input"))
			continue;
		if (!(await durableOrFresh(j))) continue;
		if (!best || j.startedAt > best.startedAt) best = j;
	}
	// DB-first fallback (running OR awaiting) before the legacy event-log rehydrate.
	const db = await loadLatestActiveRun(projectId);
	if (best && (!db || best.startedAt >= db.startedAt)) return best;
	return cache(db) ?? cache(await rehydrateLatestAwaitingPipelineJob(projectId));
}
