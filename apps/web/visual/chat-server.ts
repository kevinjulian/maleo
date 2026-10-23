/* The chat routes, authored rather than recorded: a recording would need a
 * live model, and would then freeze one model's output into the suite. Shared
 * by the desktop chat spec and the phone workspace spec. */
import type { Page, Route } from "@playwright/test";

const chatUrl = (id: string) => new RegExp(`/api/operations/projects/${id}/chat(\\?|$)`);
const jobUrl = (id: string) =>
	new RegExp(`/api/operations/projects/${id}/chat/(agent-[\\w-]+)(\\?|$)`);
const answerUrl = (id: string) =>
	new RegExp(`/api/operations/projects/${id}/chat/(agent-[\\w-]+)/answer(\\?|$)`);

export type Json = Record<string, unknown>;
const EMPTY_JOB = {
	scenes: [],
	slides: [],
	posts: [],
	textOverlays: [],
	videoOverlays: [],
	audioOverlays: [],
	characters: [],
	artifacts: [],
	error: null,
};
/** One authored job state, as the poll endpoint returns it. */
export interface FixtureJob {
	status: string;
	events: object[];
	/** Editor commands a settled run executed, applied once when it settles. */
	commands?: object[];
}
export const job = (
	status: string,
	events: object[],
	extra: { commands?: object[] } = {},
): FixtureJob => ({ ...EMPTY_JOB, status, events, ...extra });

/** The chat routes, authored. `jobs` maps a job id to its current state. */
export interface ChatServer {
	jobs: Map<string, FixtureJob>;
	starts: Json[];
	answers: Json[];
	nextJobIds: string[];
}

export async function serveChat(page: Page, project: string): Promise<ChatServer> {
	const server: ChatServer = { jobs: new Map(), starts: [], answers: [], nextJobIds: [] };
	await page.route(chatUrl(project), async (route: Route) => {
		if (route.request().method() === "POST") {
			const body = JSON.parse(route.request().postData() ?? "{}") as Json;
			server.starts.push(body);
			const jobId = server.nextJobIds.shift() ?? `agent-run-${server.starts.length}`;
			if (!server.jobs.has(jobId)) server.jobs.set(jobId, job("running", []));
			await route.fulfill({ json: { jobId } });
			return;
		}
		await route.fulfill({ json: { job: null } });
	});
	await page.route(answerUrl(project), async (route: Route) => {
		server.answers.push(JSON.parse(route.request().postData() ?? "{}") as Json);
		await route.fulfill({
			status: 202,
			json: { jobId: route.request().url().match(answerUrl(project))![1], status: "running" },
		});
	});
	await page.route(jobUrl(project), async (route: Route) => {
		const id = route.request().url().match(jobUrl(project))![1]!;
		await route.fulfill({ json: { jobId: id, ...(server.jobs.get(id) ?? job("running", [])) } });
	});
	return server;
}

/* The replay aborts routes it has no entry for — the editor's autosave among
 * them — so saves are acknowledged here. The chat is not under test there. */
export async function acknowledgeSaves(page: Page, project: string): Promise<void> {
	await page.route(
		new RegExp(`/api/operations/projects/${project}(/editor-state)?(\\?|$)`),
		async (route) => {
			if (route.request().method() === "PUT") {
				await route.fulfill({ json: { ok: true } });
				return;
			}
			await route.fallback();
		},
	);
}
