/* One-shot content generation + agent chat-run routes. */
import { slidesOf, postsOf } from "../../modules/agents/core/content-state.ts";
import { runCommandWire } from "../../modules/agents/core/edit-document.ts";
import type { Hono } from "hono";
import { getContentProject } from "@maleo/db/project-detail";
import { listWorkflowRunIds } from "@maleo/db/workflow-run-db";
import { editVideoStoryboard, type EditVideoSceneInput } from "../../lib/content-generator.ts";
import {
	type AgentPost,
	type AgentScene,
	type AgentSlide,
} from "../../modules/agents/core/model.ts";
import { startAgentJob } from "../../modules/agents/core/run-bracket.ts";
import {
	compileChatContext,
	chatContextProjectMismatch,
} from "../../modules/agents/core/context-compiler.ts";
import { recordChatContextCapture } from "../../lib/agent-trace.ts";
import {
	getAgentJob,
	getLatestActiveJobForProject,
} from "../../modules/agents/core/session-store.ts";
import { isJobLive } from "../../modules/agents/core/session-store.ts";
import { reapIfStale } from "../../modules/agents/core/run-repository.ts";
import {
	encodeClarificationAnswer,
	validateClarificationSubmission,
} from "../../modules/agents/core/story-clarification.ts";
import {
	answerAgentRun,
	cancelAgentRun,
	startAgentRun,
} from "../../modules/agents/core/service.ts";
import { runHost } from "../../modules/agents/core/runtime/durable.ts";
import { runState } from "../../modules/agents/core/runtime/run-state.ts";
import {
	isEmptyDirection,
	projectMaterialsSchema,
	readClips,
	readStoryboardDocument,
} from "@maleo/shared";
import { agentRunBody, answerBody, editVideoBody } from "./request-schemas.ts";

// Single flow: every agent run is the internal agent on the durable host
// (modules/agents/core/service.ts, runtime/durable.ts). A route builds or fences
// the run on the product record and hands it to the host; the request returns at
// once and the client follows the run by polling. Requires the Inngest server
// and the runtime database (no in-process fallback).

export function registerGenerationRoutes(app: Hono): void {
	// Chat agent: start a server-side agent run (ReAct loop executes tools +
	// persists the storyboard after each step; survives browser refresh/close).
	app.post("/projects/:id/chat", async (c) => {
		const parsed = agentRunBody.safeParse(await c.req.json().catch(() => ({})));
		if (!parsed.success) return c.json({ error: "invalid_body", issues: parsed.error.issues }, 400);
		const body = parsed.data;
		if (!body.instruction?.trim()) return c.json({ error: "instruction required" }, 400);
		// Reject unknown projects instead of spawning a phantom job that persists
		// nowhere. Trust the project's own type over the client-sent content_type so a
		// bad request can't make the agent persist the wrong storyboard shape.
		const detail = await getContentProject(c.req.param("id"));
		const projectType = detail?.project?.type;
		if (!projectType) return c.json({ error: "project_not_found" }, 404);
		/* Image and text projects are retired: they stay editable by hand, but no
		 * agent run starts for them. Refused before context or a run is built. */
		if (projectType !== "video") return c.json({ error: "unsupported_content_type" }, 400);
		const contentType = "video" as const;
		/* An envelope naming another project fails the request rather than being
		 * rewritten to this one: the caller meant something different from what the
		 * URL says, and running it anyway would act on the wrong project. */
		if (chatContextProjectMismatch(body.envelope, c.req.param("id"))) {
			return c.json({ error: "envelope_project_mismatch" }, 400);
		}
		// A memory entry may only cite a run of this same project. Read up front:
		// the compiler is synchronous.
		const ownRuns = new Set(await listWorkflowRunIds(c.req.param("id")));
		const compiled = compileChatContext({
			projectId: c.req.param("id"),
			raw: body.envelope,
			isOwnRun: (runId) => ownRuns.has(runId),
			claimedStyleImageUrl: body.style_image_url,
			resolveProjectContext: () => {
				const doc = readStoryboardDocument(detail.storyboards[0]?.storyboard_json).doc;
				const references = [
					...new Map(detail.entities.map((entity) => [entity.id, entity])).values(),
				];
				return {
					materials: projectMaterialsSchema.parse(doc.materials),
					referenceIds: doc.projectReferences.entityIds,
					references: references.map((entity) => ({
						id: entity.id,
						label: entity.label,
						...(entity.canonical_image_url ? { imageUrl: entity.canonical_image_url } : {}),
					})),
				};
			},
		});
		const inputs = compiled.envelope.inputs;
		const job = await startAgentJob({
			projectId: c.req.param("id"),
			instruction: body.instruction.trim(),
			// SAFETY: the client's copy of a document THIS system wrote — the agent
			// authored these scenes and the editor round-tripped them. Unlike `clips`
			// below, which `readClips` decodes properly, there is no schema for
			// `AgentScene` yet, so this forwards what arrived. Decoding these three
			// arrays is the same job `readClips` does and belongs with the change
			// that gives the agent document a schema.
			scenes: Array.isArray(body.scenes) ? (body.scenes as AgentScene[]) : [],
			/* Context comes from the compiled envelope, which validated it as one
			 * shape. It used to arrive as eleven loose fields plus a `context` bag,
			 * each re-parsed here with its own inline type guard. */
			aspect: inputs.aspect,
			brief: inputs.brief,
			styleImageUrl: inputs.styleImageUrl,
			projectRefIds: inputs.referenceIds.length ? inputs.referenceIds : undefined,
			// The client posts its live clip doc. Decoded here, at the edge, rather
			// than carried as a dictionary to the timeline and asserted back into
			// clips there. Absence still means "fall back to the saved document".
			seedClips: Array.isArray(body.clips) ? readClips(body.clips) : undefined,
			captionSet: body.captionSet,
			contentType,
			// SAFETY: as above — the agent's own slides, coming back.
			slides: Array.isArray(body.slides) ? (body.slides as AgentSlide[]) : undefined,
			// SAFETY: as above — the agent's own posts, coming back.
			posts: Array.isArray(body.posts) ? (body.posts as AgentPost[]) : undefined,
			direction:
				inputs.direction && !isEmptyDirection(inputs.direction) ? inputs.direction : undefined,
			materials: inputs.materials,
			context: {
				audience: inputs.audience,
				targetDurationSec: inputs.targetDurationSec,
				slideCount: inputs.slideCount,
				platform: inputs.platform,
				thread: inputs.thread,
				voiceProvider: inputs.voiceProvider,
				voice: inputs.voice,
				language: inputs.language,
				style: inputs.style,
				styleKnobs: inputs.styleKnobs,
				styleName: inputs.styleName,
				timelineTemplateId: inputs.timelineTemplateId,
			},
			context_envelope: compiled.envelope,
		});
		/* Only when this request's envelope is the one the run actually took.
		 *
		 * `startAgentJob` returns the project's existing run when one is already in
		 * flight, and that run keeps the context it started with. Recording a
		 * capture here regardless would file this request's rejection list against
		 * the earlier run's context — a trace entry describing a capture that never
		 * happened, which is worse than no entry at all. */
		if (job.context === compiled.envelope) await recordChatContextCapture(job, compiled.rejected);
		// A new run is built and saved but not yet started: start it on the host. The
		// project's run already in flight (returned above) is left to itself.
		if (job.context === compiled.envelope) {
			let host;
			try {
				host = await runHost();
			} catch (err) {
				return c.json(
					{ error: `runtime_unavailable: ${err instanceof Error ? err.message : String(err)}` },
					502,
				);
			}
			await startAgentRun(host, job, body.instruction.trim(), { background: true });
		}
		return c.json({ jobId: job.id, status: job.status }, 202);
	});

	// Resume polling without a jobId: returns the project's current active job (if
	// any) in the same shape as the jobId poll, plus its jobId. Distinct GET path
	// from /chat/:jobId, so Hono matches them separately.
	app.get("/projects/:id/chat", async (c) => {
		const job = await getLatestActiveJobForProject(c.req.param("id"));
		if (!job) return c.json({ job: null });
		// Unstick an orphaned run (server/Inngest restarted mid-run) so the client
		// stops spinning and can retry instead of polling "running" forever.
		await reapIfStale(job, isJobLive(job.id));
		return c.json({
			jobId: job.id,
			status: job.status,
			context: job.context,
			events: job.events,
			scenes: job.scenes,
			slides: slidesOf(job),
			posts: postsOf(job),
			textOverlays: job.textOverlays,
			videoOverlays: job.videoOverlays,
			audioOverlays: job.audioOverlays,
			generatedCaptionSources: job.generatedCaptionSources,
			characters: job.characters,
			artifacts: job.artifacts,
			outcomeContract: job.outcomeContract,
			outcomeEvaluation: job.outcomeEvaluation,
			generationBatch: job.generationBatch,
			...runCommandWire(job),
			error: job.error ?? null,
		});
	});

	// Answer an ask_user question: resumes the suspended job from where it paused
	// (Design B) with the user's answer appended to the run transcript.
	app.post("/projects/:id/chat/:jobId/answer", async (c) => {
		const parsed = answerBody.safeParse(await c.req.json().catch(() => ({})));
		if (!parsed.success) return c.json({ error: "invalid_body", issues: parsed.error.issues }, 400);
		const body = parsed.data;
		const projectId = c.req.param("id");
		const jobId = c.req.param("jobId");
		const job = (await getAgentJob(jobId)) ?? (await getLatestActiveJobForProject(projectId));
		if (!job || job.id !== jobId || job.projectId !== projectId)
			return c.json({ error: "job_not_found" }, 404);
		let answer = typeof body.answer === "string" ? body.answer : "";
		if (job.status !== "awaiting_input") return c.json({ error: "not_awaiting" }, 409);
		if (body.action_id && job.pendingActionId && body.action_id !== job.pendingActionId) {
			return c.json({ error: "stale_action" }, 409);
		}
		/* A structured clarification submission is checked HERE, before anything is
		 * released: an incomplete answer, an unknown option, a mismatched batch id or a
		 * superseded action must leave the required action pending rather than resume
		 * the run with a half-answered batch. */
		if (body.batch_answer) {
			const check = validateClarificationSubmission(job, body.batch_answer, body.action_id);
			if (!check.ok) {
				const status =
					check.reason === "stale_action" ||
					check.reason === "batch_mismatch" ||
					check.reason === "no_pending_batch"
						? 409
						: 400;
				return c.json({ error: check.reason, missing: check.missing ?? null }, status);
			}
			answer = encodeClarificationAnswer(body.batch_answer);
		}
		let host;
		try {
			host = await runHost();
		} catch (err) {
			return c.json(
				{ error: `runtime_unavailable: ${err instanceof Error ? err.message : String(err)}` },
				502,
			);
		}
		// The answer resumes only the action the run waits on: a double-click or a
		// late answer for a past question resumes nothing.
		const outcome = await answerAgentRun(
			host,
			job.id,
			body.action_id ?? job.pendingActionId,
			answer,
			{ background: true },
		);
		if (outcome === "stale") return c.json({ error: "stale_action" }, 409);
		return c.json({ jobId: job.id, status: "running" }, 202);
	});

	app.post("/projects/:id/chat/:jobId/cancel", async (c) => {
		const projectId = c.req.param("id");
		const jobId = c.req.param("jobId");
		const job = (await getAgentJob(jobId)) ?? (await getLatestActiveJobForProject(projectId));
		if (!job || job.id !== jobId || job.projectId !== projectId)
			return c.json({ error: "job_not_found" }, 404);
		if (job.status === "done" || job.status === "needs_attention" || job.status === "error")
			return c.json({ jobId: job.id, status: job.status }, 200);
		// Ends the run on the product record at once; anything still executing makes no further change.
		return c.json({ jobId: job.id, status: await cancelAgentRun(job.id) }, 202);
	});

	// Resume an interrupted run: ONLY a run in "error" (reaped stale, abandoned
	// on timeout, failed). It continues on the same AgentJob — its conversation and
	// project state — as a fresh execution, since the errored one cannot resume.
	// A live "running" run needs no resume, "done" is finished, and
	// "awaiting_input" resumes via /answer.
	app.post("/projects/:id/chat/:jobId/resume", async (c) => {
		const projectId = c.req.param("id");
		const jobId = c.req.param("jobId");
		const job = await getAgentJob(jobId);
		if (!job || job.id !== jobId || job.projectId !== projectId)
			return c.json({ error: "job_not_found" }, 404);
		if (job.status !== "error") return c.json({ error: `not_resumable_from_${job.status}` }, 409);
		let host;
		try {
			host = await runHost();
		} catch (err) {
			return c.json(
				{ error: `runtime_unavailable: ${err instanceof Error ? err.message : String(err)}` },
				502,
			);
		}
		const state = runState(job);
		state.executionId = `${job.id}:resume:${Date.now()}`;
		job.error = undefined;
		// The fresh execution reads the project as the errored one left it, so the
		// original instruction carries on from there.
		await startAgentRun(host, job, state.instruction || job.brief || "continue", {
			background: true,
		});
		return c.json({ jobId: job.id, status: "running" }, 202);
	});

	// Poll an agent run for new events + the current storyboard scenes/overlays.
	app.get("/projects/:id/chat/:jobId", async (c) => {
		const job = await getAgentJob(c.req.param("jobId"));
		if (!job || job.projectId !== c.req.param("id")) return c.json({ error: "job_not_found" }, 404);
		// Unstick an orphaned run (server/Inngest restarted mid-run) so the client
		// stops spinning and can retry instead of polling "running" forever.
		await reapIfStale(job, isJobLive(job.id));
		return c.json({
			status: job.status,
			context: job.context,
			events: job.events,
			scenes: job.scenes,
			slides: slidesOf(job),
			posts: postsOf(job),
			textOverlays: job.textOverlays,
			videoOverlays: job.videoOverlays,
			audioOverlays: job.audioOverlays,
			generatedCaptionSources: job.generatedCaptionSources,
			characters: job.characters,
			artifacts: job.artifacts,
			outcomeContract: job.outcomeContract,
			outcomeEvaluation: job.outcomeEvaluation,
			generationBatch: job.generationBatch,
			...runCommandWire(job),
			error: job.error ?? null,
		});
	});

	// Incremental chat edit: apply an instruction to the current video storyboard
	// and return the full updated storyboard (client diffs to preserve frames).
	app.post("/storyboard-edit", async (c) => {
		const parsed = editVideoBody.safeParse(await c.req.json().catch(() => ({})));
		if (!parsed.success) return c.json({ error: "invalid_body", issues: parsed.error.issues }, 400);
		const body = parsed.data;
		if (!Array.isArray(body.scenes) || body.scenes.length === 0)
			return c.json({ error: "scenes required" }, 400);
		if (!body.instruction?.trim()) return c.json({ error: "instruction required" }, 400);
		try {
			// SAFETY: as at the run route above — the client returning the agent's own
			// scenes. Checked non-empty on the line above; the element shape waits on
			// a schema for the agent document.
			const scenes = body.scenes as EditVideoSceneInput[];
			const item = await editVideoStoryboard({
				scenes,
				instruction: body.instruction.trim(),
				audience: body.audience,
				format: body.format,
			});
			return c.json({ item });
		} catch (err) {
			return c.json({ error: err instanceof Error ? err.message : String(err) }, 502);
		}
	});
}
