import { listExportProjects, reconcileContentRender, type ExportProject } from "@maleo/db/renders";
import { listJobs, type RenderJob, type RenderJobStatus } from "./video-client.ts";
import { resolveRenderMedia } from "./video-media.ts";

function scope(workspace: string, projects: ExportProject[]) {
	return {
		workspace,
		projectIds: projects.map((p) => p.id),
		legacyJobIds: projects.flatMap((p) => p.legacy_job_ids),
	};
}

function owner(job: RenderJob, projects: ExportProject[]) {
	return projects.find(
		(p) => p.id === job.project_id || (!job.project_id && p.legacy_job_ids.includes(job.id)),
	);
}

async function present(job: RenderJob, projects: ExportProject[], workspace: string) {
	const project = owner(job, projects);
	if (!project) throw new Error("Export ownership changed. Refresh the collection.");
	const resolved = await resolveRenderMedia({ ...job, workspace, project_id: project.id });
	await reconcileContentRender(project.id, resolved);
	return { ...resolved, project_title: project.title };
}

export async function listVideoExports(
	workspace: string,
	options: {
		limit: number;
		offset: number;
		search?: string;
		project?: string;
		status?: RenderJobStatus;
	},
) {
	const all = await listExportProjects(workspace);
	const projects = all.filter(
		(p) =>
			(!options.project || p.id === options.project) &&
			(!options.search || p.title.toLocaleLowerCase().includes(options.search.toLocaleLowerCase())),
	);
	const filters = scope(workspace, projects);
	const [page, facets] = await Promise.all([
		listJobs({
			...filters,
			limit: options.limit,
			offset: options.offset,
			statuses: options.status ? [options.status] : undefined,
		}),
		listJobs({ ...scope(workspace, all), limit: 1 }),
	]);
	const items = await Promise.all(page.items.map((job) => present(job, projects, workspace)));
	const choices = all.filter(
		(p) =>
			facets.project_ids?.includes(p.id) ||
			p.legacy_job_ids.some((id) => facets.legacy_job_ids?.includes(id)),
	);
	return {
		...page,
		project_ids: undefined,
		legacy_job_ids: undefined,
		items,
		count: page.total,
		projects: choices.map(({ id, title }) => ({ id, title })),
	};
}

export async function discoverProjectExports(workspace: string, projectId: string) {
	const projects = (await listExportProjects(workspace)).filter((p) => p.id === projectId);
	if (!projects.length) return null;
	const filters = scope(workspace, projects);
	const [active, terminal] = await Promise.all([
		listJobs({ ...filters, limit: 1, statuses: ["queued", "running"] }),
		listJobs({
			...filters,
			limit: 1,
			statuses: ["done", "done_with_fallback", "error", "cancelled"],
		}),
	]);
	return {
		active: active.items[0] ? await present(active.items[0], projects, workspace) : null,
		latest: terminal.items[0] ? await present(terminal.items[0], projects, workspace) : null,
	};
}
