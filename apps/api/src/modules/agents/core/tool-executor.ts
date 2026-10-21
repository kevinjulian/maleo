/* Tool dispatch seam. Validates + coerces a tool call against its registry schema,
 * enforces the approval gate for gated generates, then runs the tool's ToolDef
 * handler with an assembled ToolContext (job + helpers). Also holds the
 * coercion helpers (TOOL_HELPERS) and the existing-edit draft gate. Tools reach
 * their services by importing them; there is no capability bag in between. */
import { toolByName, RETIRED_TOOL_NAMES, TOOL_ALIAS_CANONICAL } from "./registry.ts";
import type { ToolHelpers, ToolContext, ToolEffect, ToolKind } from "./types.ts";
import { type EditDraft } from "./pipeline.ts";
import { clampShortformSceneDuration } from "./visual-gen.ts";
import { parseMotionGraphic } from "./trace.ts";
import { getStoryPlan } from "./plan-state.ts";
import { str, num } from "./services/util.ts";
import {
	beginToolRun,
	completeToolRun,
	failToolRun,
	markToolRunRunning,
	recordStepRun,
	lookupToolReplay,
	saveRun,
} from "./run-repository.ts";
import { applyToolReplay } from "./tool-replay.ts";
import type { AgentJob } from "./model.ts";
import { toolResultSchema } from "./helpers/schemas.ts";
import { inGenerationScope } from "../../../lib/generation/generation-scope.ts";

// Coercion helpers injected into migrated tool handlers so tool files need no
// orchestrator value import (which would form a cycle).
const TOOL_HELPERS: ToolHelpers = {
	str,
	num,
	index: clampIndex,
	clampSceneDuration: clampShortformSceneDuration,
	parseMotionGraphic,
};

// Resolve an `index` argument against a list. Eight tools wrote this expression
// out verbatim, which is eight chances for one of them to round differently.
function clampIndex(value: unknown, length: number): number {
	return Math.max(0, Math.min(length - 1, Math.round(num(value, -1))));
}

// The context a migrated tool handler runs with. Exposed so an MCP `tools/call`
// bridge can build the same context per invocation (given a job).
export function buildToolContext(job: AgentJob, toolCallId?: string): ToolContext {
	return { job, toolCallId, helpers: TOOL_HELPERS };
}

// Tools whose entire effect is "generate an asset + set one ref's image", so a
// replay can re-apply the stored url without side effects. Only these consult the
// replayable-output dedupe (others mutate the job in ways a stored output can't
// reconstruct — running them again is the safe path).
const REPLAYABLE_TOOLS = new Set(["generate_frame"]);

// How the client renders a tool's result, defaulted from the tool's kind. This
// dispatch seam is where the ToolDef is already resolved, so the effect travels
// out on the result — the trace leaf must not import the registry to look it up
// (that import closes a cycle across the whole agent path).
const KIND_EFFECT: Record<ToolKind, ToolEffect> = {
	read: "note",
	mutate: "patch",
	generate: "asset",
	approve: "await",
	respond: "note",
};

/** `viaMcp`: an MCP client's read, made outside any run (mcp/dispatch.ts). */
export interface ToolCallOptions {
	viaMcp?: boolean;
}

export async function runValidatedTool(
	job: AgentJob,
	tool: string,
	args: Record<string, unknown>,
	toolCallId?: string,
	options: ToolCallOptions = {},
): Promise<{ note: string; thumbs?: string[]; effect?: ToolEffect; suspended?: true }> {
	// Resolve aliases (add_beat → add_scene) and names retired by a rename
	// (generate_longform_assets → generate_story_assets, arriving from a persisted
	// run snapshot) to the canonical schema + handler.
	const canonical = RETIRED_TOOL_NAMES.get(tool) ?? TOOL_ALIAS_CANONICAL[tool] ?? tool;
	const def = toolByName.get(canonical);
	if (def) {
		const effect = KIND_EFFECT[def.kind];
		const parsed = def.input.safeParse(args);
		if (!parsed.success) {
			const detail = parsed.error.issues
				.map((i) => `${i.path.join(".") || "arg"}: ${i.message}`)
				.join("; ");
			throw new Error(`invalid args for ${tool} (${detail}) — fix the arguments and retry`);
		}
		const coerced: Record<string, unknown> = parsed.data;
		// Gate: a `generate` marked gated must not run until its proposal is approved.
		if (def.gated && !isProposalApproved(job, def.proposes)) {
			throw new Error(
				`${tool} is gated — the ${def.proposes ?? "proposal"} must be approved first; ask the user to approve.`,
			);
		}
		/* An MCP read belongs to no run: it reads the project's saved state, and
		 * nothing is recorded as a run's step or offered for replay — recording it
		 * would leave a run behind that reads as active. Only reads are served. */
		if (options.viaMcp) {
			if (def.kind !== "read" || !def.handler) throw new Error(`${tool} is not served over MCP`);
			return {
				...toolResultSchema.parse(await def.handler(buildToolContext(job, toolCallId), coerced)),
				effect,
			};
		}
		// Registry dispatch: every tool runs from its ToolDef handler. Wrap it in a
		// durable tool_run + step_run record (WP5).
		if (def.handler) {
			/* Marked before the handler, not after: a tool that throws may already have
			 * written part of the job, and the merge is the path that carries that. */
			if ((def.kind === "mutate" || def.kind === "generate") && !def.edits && job.run)
				job.run.jobWrites = true;
			const startedAt = Date.now();
			const stepIndex = job.run?.step ?? 0;
			// Replayable-output dedupe: if a prior run of this exact (run, step, tool,
			// args) already produced an asset, re-apply it from storage instead of
			// re-billing the provider. Guards the tiny window where a segment retry
			// replays a completed expensive tool (crash between the tool and the cursor
			// persist). Only replayable generate tools store a `replay`.
			const prior =
				REPLAYABLE_TOOLS.has(canonical) || def.edits
					? await lookupToolReplay(job.id, stepIndex, canonical, coerced)
					: null;
			if (prior?.replay && applyToolReplay(job, prior.replay)) {
				await saveRun(job);
				return { note: prior.note, thumbs: prior.thumbs, effect };
			}
			const begun = await beginToolRun({
				runId: job.id,
				tool: canonical,
				args: coerced,
				stepIndex,
			});
			/* A generate tool re-entered inside a generation scope is the durable host
			 * retrying its step after the process died: its generations are keyed to the
			 * scope, so the retry resumes the provider work already started. */
			const resumable = def.kind === "generate" && inGenerationScope();
			if (!begun.created && !def.reentrant && !resumable) {
				throw new Error(
					`${tool} has an uncertain prior attempt at this step; inspect tool run ${begun.row.id} before retrying to avoid duplicate provider work`,
				);
			}
			await markToolRunRunning(begun.row.id);
			let result: Awaited<ReturnType<NonNullable<typeof def.handler>>>;
			const heldBefore = job.editCommands?.length ?? 0;
			try {
				const rawResult = await def.handler(buildToolContext(job, toolCallId), coerced);
				const parsedResult = toolResultSchema.safeParse(rawResult);
				if (!parsedResult.success) {
					const detail = parsedResult.error.issues
						.map((issue) => `${issue.path.join(".") || "result"}: ${issue.message}`)
						.join("; ");
					throw new Error(`invalid result from ${tool} (${detail})`);
				}
				result = parsedResult.data;
			} catch (error) {
				await failToolRun({ rowId: begun.row.id, startedAt, error });
				await recordStepRun(job, canonical, "failed", { error });
				throw error;
			}
			// An editing call's commands ride its durable record, so a retry that finds
			// the call done re-applies them rather than refusing an uncertain attempt.
			const executed = job.editCommands?.slice(heldBefore) ?? [];
			if (def.edits && executed.length)
				result = { ...result, replay: { kind: "edit", commands: executed } };
			// Complete the durable effect record before advancing the workflow snapshot.
			// If snapshot persistence then fails, replay can recover without re-billing.
			await completeToolRun({ rowId: begun.row.id, projectId: job.projectId, startedAt, result });
			await saveRun(job);
			await recordStepRun(job, canonical, "completed");
			// A suspended result is a checkpoint, not the tool's outcome, so it renders
			// as one ("await") rather than as the patch its kind would imply.
			const { replay: _replay, ...shown } = result;
			return { ...shown, effect: result.effect ?? (result.suspended ? "await" : effect) };
		}
		throw new Error(`${tool} is registered but has no handler`);
	}
	return { note: `Unknown tool ${tool}` };
}

// A gated `generate` runs only after its proposal artifact is approved. No tool
// is gated today (approval is the deterministic route); this enforces the
// contract for future gated commits (e.g. a regenerate-then-approve scene tool).
function isProposalApproved(job: AgentJob, proposes?: string): boolean {
	if (proposes === "story_plan")
		return (getStoryPlan(job)?.sections ?? []).some((s) => s.status && s.status !== "draft");
	return false;
}

function finiteIndex(value: unknown): number | null {
	const n =
		typeof value === "number"
			? value
			: typeof value === "string" && value.trim()
				? Number(value)
				: NaN;
	return Number.isFinite(n) ? Math.round(n) : null;
}

export function editGateLabel(job: AgentJob, tool?: string): string {
	if (tool === "update_section") return "section edit";
	return "scene edit";
}

// Detect a tool call that edits EXISTING work (scene/section). Such a
// call must route through an approval gate before mutating; returns the draft to
// approve, or null when the call creates new content (no gate).
export function existingEditDraft(
	job: AgentJob,
	tool: string,
	args: Record<string, unknown>,
): EditDraft | null {
	const index = finiteIndex(args.index);
	if (index == null) return null;
	if (tool === "update_scene" || tool === "remove_scene") {
		if (job.contentType !== "video" || !job.scenes[index]) return null;
		const s = job.scenes[index]!;
		return {
			operation: tool === "remove_scene" ? "delete" : "update",
			targetsExisting: true,
			summary:
				tool === "remove_scene"
					? `Remove scene ${index + 1}: ${s.name}`
					: `Update scene ${index + 1}: ${s.name}`,
			payload: { kind: "edit", tool, args },
		};
	}
	if (tool === "update_section") {
		const plan = getStoryPlan(job);
		const s = plan?.sections[index];
		if (!plan || !s) return null;
		return {
			operation: "update",
			targetsExisting: true,
			summary: `Update section ${index + 1}: ${s.title}`,
			payload: { kind: "edit", tool, args },
		};
	}
	return null;
}
