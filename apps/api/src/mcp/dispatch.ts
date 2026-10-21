/* The one path an MCP tool call takes into the product.
 *
 * Every call is scoped first: the project it names — directly, or through the run
 * it names — must be in a workspace the key's owner belongs to. Unknown and
 * unreachable read the same, so a key cannot probe what exists.
 *
 * Reads and research run through the agent's own executor (validation, the
 * tool's handler) against the project's saved state, outside any run, and are
 * traced on the project like an agent's call. Delegation drives the run service
 * on the given host: a start or an answer is fenced here and then proceeds in
 * the background, so the call returns at once and the client follows the run
 * with `get_run` — the same run the project chat shows. */
import { z } from "zod";
import { getContentProject } from "@maleo/db/project-detail";
import { listContentProjects } from "@maleo/db/content-projects";
import { isWorkspaceMember, listWorkspacesForUser } from "@maleo/db/workspace-members";
import {
	buildAgentJob as buildRunJob,
	UnsupportedContentTypeError,
} from "../modules/agents/core/run-bracket.ts";
import { saveRun } from "../modules/agents/core/run-repository.ts";
import { getAgentJob, getLatestActiveJobForProject } from "../modules/agents/core/session-store.ts";
import { runValidatedTool } from "../modules/agents/core/tool-executor.ts";
import { emitToolCall } from "../modules/agents/core/trace.ts";
import { toolByName } from "../modules/agents/core/registry.ts";
import type { AgentJob } from "../modules/agents/core/model.ts";
import {
	answerAgentRun,
	awaitsAction,
	cancelAgentRun,
	startAgentRun,
	startDirectRun,
	type RunHost,
} from "../modules/agents/core/service.ts";
import type { McpPrincipal } from "./credential.ts";
import {
	editsFor,
	isEdit,
	isRegistryRead,
	isResearch,
	isServiceTool,
	MCP_SERVICE_TOOLS,
	readsFor,
	type McpServiceTool,
} from "./generate.ts";
import type { ToolArgs } from "../modules/agents/core/types.ts";

/** A refusal the client sees as the tool's error. */
export class McpToolError extends Error {}

/** Where delegated runs execute. Production: the durable host. */
export interface McpDeps {
	host: () => Promise<RunHost>;
}

const NOT_FOUND = "project not found";
const RUN_NOT_FOUND = "run not found";
/** How much of a run's progress `get_run` returns. */
const RECENT_EVENTS = 20;
/** How long a direct edit's call waits for its run to settle or park before it
 *  answers with the run to follow instead (a long generation). */
const DIRECT_WAIT_MS = 120_000;

type Project = NonNullable<Awaited<ReturnType<typeof getContentProject>>>["project"];

async function reachableProject(principal: McpPrincipal, projectId: string): Promise<Project> {
	const project = (await getContentProject(projectId))?.project;
	if (!project || !(await isWorkspaceMember(project.workspace, principal.userId)))
		throw new McpToolError(NOT_FOUND);
	return project;
}

async function reachableRun(principal: McpPrincipal, runId: string): Promise<AgentJob> {
	const job = await getAgentJob(runId);
	if (!job) throw new McpToolError(RUN_NOT_FOUND);
	try {
		await reachableProject(principal, job.projectId);
	} catch {
		throw new McpToolError(RUN_NOT_FOUND);
	}
	return job;
}

function parse<S extends z.ZodTypeAny>(schema: S, args: unknown): z.infer<S> {
	const parsed = schema.safeParse(args ?? {});
	if (!parsed.success)
		throw new McpToolError(parsed.error.issues[0]?.message ?? "invalid arguments");
	return parsed.data;
}

/** A run as `get_run` reports it. */
function runView(job: AgentJob) {
	const question = [...job.events].reverse().find((event) => event.kind === "question");
	const final = [...job.events].reverse().find((event) => event.kind === "final");
	return {
		runId: job.id,
		projectId: job.projectId,
		status: job.status,
		pendingAction:
			job.status === "awaiting_input" && job.pendingActionId
				? {
						actionId: job.pendingActionId,
						question:
							job.pendingQuestion?.question ??
							(question?.kind === "question" ? question.question : ""),
						options:
							job.pendingQuestion?.options ??
							(question?.kind === "question" ? question.options : undefined) ??
							[],
					}
				: null,
		result: final?.kind === "final" ? final.text : null,
		error: job.error ?? null,
		recent: job.events.slice(-RECENT_EVENTS).flatMap((event) => {
			if (event.kind === "tool_call_completed") return [`${event.tool}: ${event.note}`];
			if (event.kind === "assistant_text" || event.kind === "final") return [event.text];
			if (event.kind === "question") return [`question: ${event.question}`];
			if (event.kind === "error") return [`error: ${event.message}`];
			return [];
		}),
	};
}

/** A job for this project, or the client-facing refusal when its type has no agent. */
async function buildAgentJob(
	input: Parameters<typeof buildRunJob>[0],
): ReturnType<typeof buildRunJob> {
	try {
		return await buildRunJob(input);
	} catch (error) {
		if (error instanceof UnsupportedContentTypeError) throw new McpToolError(error.message);
		throw error;
	}
}

async function readTool(principal: McpPrincipal, name: string, args: unknown): Promise<string> {
	const { projectId, ...toolArgs } = parse(
		z.object({ projectId: z.string().min(1, "projectId is required") }).passthrough(),
		args,
	);
	const project = await reachableProject(principal, projectId);
	if (!isResearch(name) && !readsFor(project.type).includes(name))
		throw new McpToolError(`${name} does not apply to a ${project.type} project`);
	const job = {
		...(await buildAgentJob({ projectId, instruction: "", contentType: project.type })),
		mcpActor: principal.userId,
	};
	const { note, ok } = await emitToolCall(job, name, toolArgs, (traceId) =>
		runValidatedTool(job, name, toolArgs, traceId, { viaMcp: true }),
	);
	if (!ok) throw new McpToolError(note);
	return note;
}

/** The run once it has settled or parked, or as it stands when the wait runs out. */
async function settledView(runId: string, waitMs: number): Promise<ReturnType<typeof runView>> {
	const deadline = Date.now() + waitMs;
	let job = await getAgentJob(runId);
	while (job?.status === "running" && Date.now() < deadline) {
		await Bun.sleep(50);
		job = await getAgentJob(runId);
	}
	if (!job) throw new McpToolError(RUN_NOT_FOUND);
	return runView(job);
}

/* A direct edit: one registry tool call, run as a single-tool run in the project
 * chat. Refused before any run exists — so before any change or charge — when the
 * tool does not apply, its arguments fail its own schema, or the project already
 * has a run. */
async function editTool(
	principal: McpPrincipal,
	name: string,
	args: unknown,
	deps: McpDeps,
): Promise<unknown> {
	const { projectId, ...toolArgs } = parse(
		z.object({ projectId: z.string().min(1, "projectId is required") }).passthrough(),
		args,
	);
	const project = await reachableProject(principal, projectId);
	if (!editsFor(project.type).includes(name))
		throw new McpToolError(`${name} does not apply to a ${project.type} project`);
	const parsed = toolByName.get(name)!.input.safeParse(toolArgs);
	if (!parsed.success)
		throw new McpToolError(
			`invalid args for ${name}: ${parsed.error.issues.map((issue) => `${issue.path.join(".") || "arg"}: ${issue.message}`).join("; ")}`,
		);
	// ponytail: check-then-start, as run_agent; the product's start route has the same window.
	const active = await getLatestActiveJobForProject(projectId);
	if (active)
		throw new McpToolError(
			`the project already has an active run (${active.id}); follow it with get_run or stop it with cancel_run`,
		);
	const job = {
		...(await buildAgentJob({ projectId, instruction: name, contentType: project.type })),
		mcpActor: principal.userId,
	};
	await saveRun(job);
	// SAFETY: every served edit's input is a zod object (refined or not; `inputObject` checks it when the tools are listed), so its parsed output is a plain record.
	const call = { tool: name, args: parsed.data as ToolArgs, callId: `direct-${job.id}` };
	await startDirectRun(await deps.host(), job, call, { background: true });
	return await settledView(job.id, DIRECT_WAIT_MS);
}

async function serviceTool(
	principal: McpPrincipal,
	name: McpServiceTool,
	args: unknown,
	deps: McpDeps,
): Promise<unknown> {
	switch (name) {
		case "list_projects": {
			parse(MCP_SERVICE_TOOLS.list_projects.input, args);
			const workspaces = await listWorkspacesForUser(principal.userId);
			const projects = (
				await Promise.all(workspaces.map((workspace) => listContentProjects({ workspace })))
			).flat();
			return projects.map((project) => ({
				id: project.id,
				title: project.title,
				type: project.type,
				workspace: project.workspace,
			}));
		}
		case "get_project": {
			const { projectId } = parse(MCP_SERVICE_TOOLS.get_project.input, args);
			const project = await reachableProject(principal, projectId);
			const active = await getLatestActiveJobForProject(projectId);
			return {
				id: project.id,
				title: project.title,
				type: project.type,
				workspace: project.workspace,
				tools: readsFor(project.type),
				edits: editsFor(project.type),
				activeRun: active ? { runId: active.id, status: active.status } : null,
			};
		}
		case "run_agent": {
			const { projectId, instruction } = parse(MCP_SERVICE_TOOLS.run_agent.input, args);
			const project = await reachableProject(principal, projectId);
			// ponytail: check-then-start, so two simultaneous starts can both pass; the product's start route has the same window.
			const active = await getLatestActiveJobForProject(projectId);
			if (active)
				throw new McpToolError(
					`the project already has an active run (${active.id}); follow it with get_run or stop it with cancel_run`,
				);
			const job = await buildAgentJob({ projectId, instruction, contentType: project.type });
			await saveRun(job);
			await startAgentRun(await deps.host(), job, instruction, { background: true });
			return { runId: job.id, status: job.status };
		}
		case "get_run": {
			const { runId } = parse(MCP_SERVICE_TOOLS.get_run.input, args);
			return runView(await reachableRun(principal, runId));
		}
		case "answer_action": {
			const { runId, actionId, answer } = parse(MCP_SERVICE_TOOLS.answer_action.input, args);
			const job = await reachableRun(principal, runId);
			if (!awaitsAction(job, actionId)) return { runId, outcome: "stale", status: job.status };
			return {
				runId,
				outcome: await answerAgentRun(await deps.host(), runId, actionId, answer, {
					background: true,
				}),
			};
		}
		case "cancel_run": {
			const { runId } = parse(MCP_SERVICE_TOOLS.cancel_run.input, args);
			await reachableRun(principal, runId);
			return { runId, status: await cancelAgentRun(runId) };
		}
	}
}

/** Run one MCP tool call; its result is text the client reads. */
export async function callMcpTool(
	principal: McpPrincipal,
	name: string,
	args: unknown,
	deps: McpDeps,
): Promise<string> {
	if (isServiceTool(name))
		return JSON.stringify(await serviceTool(principal, name, args, deps), null, 2);
	if (isRegistryRead(name) && toolByName.has(name)) return await readTool(principal, name, args);
	if (isEdit(name)) return JSON.stringify(await editTool(principal, name, args, deps), null, 2);
	throw new McpToolError(`unknown tool ${name}`);
}
