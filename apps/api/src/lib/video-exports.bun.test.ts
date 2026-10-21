import { afterAll, beforeAll, expect, test } from "bun:test";
import { createContentProject, getContentProject } from "@maleo/db/project-detail";
import { createContentProjectOutput } from "@maleo/db/outputs";
import { addContentRender, updateContentRender } from "@maleo/db/renders";
import { openDb } from "@maleo/db/connection";
import { upsertWorkspace } from "@maleo/db/workspaces";
import { testApp, TEST_CALLER } from "../middleware/auth-testing.ts";
import { videoRoutes } from "../routes/video.ts";
import type { RenderJob } from "./video-client.ts";

const prior = { url: process.env.MALEO_VIDEO_URL, token: process.env.MALEO_VIDEO_TOKEN };
const jobs: RenderJob[] = [];
let server: ReturnType<typeof Bun.serve>;
let project: string;
let otherProject: string;
let renderId: string;
let outputId: string;
const app = testApp(videoRoutes());
function job(
	id: string,
	projectId: string | null,
	workspace: string | null,
	status: RenderJob["status"],
	created_at: number,
): RenderJob {
	return {
		id,
		project_id: projectId,
		workspace,
		status,
		created_at,
		product_json: "{}",
		preset: "storyboard-wide",
		progress: status === "done" ? 1 : 0.4,
		output_path: null,
		error: null,
		cost_usd: null,
		backend: "local",
		started_at: null,
		finished_at: null,
	};
}
beforeAll(async () => {
	await upsertWorkspace({ name: "default", workspace_dir: "/tmp/default" });
	await upsertWorkspace({ name: "private-video", workspace_dir: "/tmp/private-video" });
	project = (await createContentProject({ title: "Needle project" }))!.project.id;
	otherProject = (await createContentProject({
		title: "Secret project",
		workspace: "private-video",
	}))!.project.id;
	for (let i = 0; i < 70; i++)
		jobs.push(job(`foreign-${i}`, otherProject, "private-video", "done", 1000 + i));
	for (let i = 0; i < 65; i++)
		jobs.push(job(`owned-${String(i).padStart(3, "0")}`, project, "default", "done", 500));
	jobs.push(job("unlinked-active", project, "default", "running", 1));
	jobs.push(job("orphan", null, null, "running", 2000));
	const output = await createContentProjectOutput({
		project_id: project,
		title: "Export",
		kind: "video_render",
		status: "queued",
	});
	outputId = output!.id;
	const link = await addContentRender({
		output_id: outputId,
		project_id: project,
		video_job_id: "owned-064",
		status: "queued",
	});
	renderId = link!.id;
	server = Bun.serve({
		port: 0,
		async fetch(req) {
			expect(req.headers.get("authorization")).toBe("Bearer test-video");
			const body = (await req.json()) as {
				workspace: string;
				projectIds: string[];
				legacyJobIds: string[];
				statuses?: string[];
				limit: number;
				offset: number;
			};
			expect(new URL(req.url).pathname).toBe("/jobs/query");
			const filtered = jobs
				.filter(
					(j) =>
						(j.workspace === body.workspace ||
							(!j.workspace &&
								(body.projectIds.includes(j.project_id ?? "") ||
									body.legacyJobIds.includes(j.id)))) &&
						(body.projectIds.includes(j.project_id ?? "") ||
							(!j.workspace && body.legacyJobIds.includes(j.id))) &&
						(!body.statuses || body.statuses.includes(j.status)),
				)
				.sort((a, b) => b.created_at - a.created_at || b.id.localeCompare(a.id));
			return Response.json({
				items: filtered.slice(body.offset, body.offset + body.limit),
				total: filtered.length,
				project_ids: [...new Set(filtered.map((j) => j.project_id).filter(Boolean))],
				legacy_job_ids: filtered.filter((j) => !j.project_id).map((j) => j.id),
				has_more: body.offset + body.limit < filtered.length,
				next_offset: body.offset + body.limit < filtered.length ? body.offset + body.limit : null,
			});
		},
	});
	process.env.MALEO_VIDEO_URL = server.url.toString();
	process.env.MALEO_VIDEO_TOKEN = "test-video";
});
afterAll(async () => {
	await server.stop(true);
	for (const [key, value] of [
		["MALEO_VIDEO_URL", prior.url],
		["MALEO_VIDEO_TOKEN", prior.token],
	] as const) {
		if (value === undefined) delete process.env[key];
		else process.env[key] = value;
	}
});
test("project search and workspace filters precede paging; counts and facets agree", async () => {
	const res = await app.request("/jobs?workspace=default&search=needle&limit=60");
	expect(res.status).toBe(200);
	const body = await res.json();
	expect(body.total).toBe(66);
	expect(body.items).toHaveLength(60);
	expect(body.items.every((j: RenderJob) => j.project_id === project)).toBe(true);
	expect(body.items[0].project_title).toBe("Needle project");
	expect(body.projects).toEqual([{ id: project, title: "Needle project" }]);
	const second = await (
		await app.request("/jobs?workspace=default&search=needle&limit=60&offset=60")
	).json();
	expect(second.items).toHaveLength(6);
	expect(second.has_more).toBe(false);
	const noMatch = await (await app.request("/jobs?workspace=default&search=absent")).json();
	expect(noMatch.total).toBe(0);
	const status = await (await app.request("/jobs?workspace=default&status=running")).json();
	expect(status.items.map((j: RenderJob) => j.id)).toEqual(["unlinked-active"]);
});
test("invalid and unauthorized filters disclose no foreign jobs", async () => {
	for (const query of ["status=oops", "limit=-1", "offset=1.5"])
		expect((await app.request(`/jobs?${query}`)).status).toBe(400);
	const unknown = await (
		await app.request(`/jobs?workspace=default&project=${otherProject}`)
	).json();
	expect(unknown.total).toBe(0);
	const outsider = testApp(videoRoutes(), { ...TEST_CALLER, userId: "video-outsider" });
	expect((await outsider.request("/jobs?workspace=private-video")).status).toBe(400);
	expect((await app.request(`/projects/${otherProject}/exports?workspace=default`)).status).toBe(
		404,
	);
});
test("discovery finds older active jobs without browser links and reconciles only changed records", async () => {
	await updateContentRender(project, renderId, { status: "queued" });
	const first = await (await app.request(`/projects/${project}/exports?workspace=default`)).json();
	expect(first.active.id).toBe("unlinked-active");
	expect(first.latest.id).toBe("owned-064");
	expect((await getContentProject(project))!.renders.find((r) => r.id === renderId)!.status).toBe(
		"done",
	);
	expect((await getContentProject(project))!.outputs.find((o) => o.id === outputId)!.status).toBe(
		"done",
	);
	const count = async () =>
		(await openDb().get<{ n: number }>(
			"SELECT COUNT(*) AS n FROM content_project_events WHERE project_id = ?",
			[project],
		))!.n;
	const events = await count();
	await Promise.all(
		Array.from({ length: 3 }, () => app.request(`/projects/${project}/exports?workspace=default`)),
	);
	expect(await count()).toBe(events);
	jobs.find((j) => j.id === "unlinked-active")!.status = "error";
	const terminal = await (
		await app.request(`/projects/${project}/exports?workspace=default`)
	).json();
	expect(terminal.active).toBe(null);
});
