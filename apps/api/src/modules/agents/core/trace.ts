/* Trace leaf — the shared run/emit primitives every flow uses: push a thinking
 * note, run a tool through the traced envelope (emit started/completed events +
 * record the tool event + tag the effect kind), and parse a motion-graphic arg.
 * Depends only on agent-trace (event recording) and shared schemas; domain types
 * are imported type-only from the orchestrator, so both the orchestrator and the
 * flow services import these directly.
 *
 * This leaf must NOT import the registry. The registry eagerly loads every tool
 * barrel, and every tool reaches its service, and every service wants pushNote —
 * so one value import here closes a cycle for the whole agent path. The effect
 * kind therefore travels back on the run's own result (runValidatedTool stamps
 * it from the ToolDef) rather than being looked up by name. */
import type { AgentJob } from "./model.ts";
import type { ToolEffect } from "./types.ts";
import { motionGraphicSchema, type MotionGraphicDecision } from "@maleo/shared";
import { recordAgentToolEvent } from "../../../lib/agent-trace.ts";
import { classifyAgentError } from "@maleo/shared/agent-errors";

export function pushNote(job: AgentJob, title: string, body: string): void {
	job.events.push({ kind: "thinking_note", title, body, elapsedSec: 0 });
}

// Run a tool through the traced envelope: emit started, run, emit completed with
// the effect kind, and record the tool event. A thrown error is caught so the loop
// stays alive, and reported as data — `ok: false` with the message as the note —
// never as a note whose text has to be parsed to know it failed.
export async function emitToolCall(
	job: AgentJob,
	tool: string,
	args: Record<string, unknown>,
	run: (
		toolCallId: string,
	) => Promise<{ note: string; thumbs?: string[]; effect?: ToolEffect; suspended?: true }>,
): Promise<{ note: string; ok: boolean; thumbs?: string[]; suspended?: true }> {
	const startedAt = Date.now();
	const toolCallId = crypto.randomUUID();
	job.events.push({ kind: "tool_call_started", tool, args });
	let ok = true;
	let note: string;
	let thumbs: string[] | undefined;
	let effect: ToolEffect = "note";
	// A tool that parked mid-execution. The envelope still closes — the phase that
	// ran produced this note, and the trace should show it — but the flag travels
	// out so the loop knows the CALL is unfinished.
	let suspended: true | undefined;
	try {
		const r = await run(toolCallId);
		note = r.note;
		thumbs = r.thumbs;
		effect = r.effect ?? "note";
		suspended = r.suspended;
	} catch (e) {
		ok = false;
		note = e instanceof Error ? e.message : String(e);
	}
	job.events.push({
		kind: "tool_call_completed",
		tool,
		note,
		thumbs,
		effect: ok ? effect : "note",
		errorInfo: ok ? undefined : classifyAgentError(note),
	});
	await recordAgentToolEvent(job, { toolCallId, tool, args, note, ok, startedAt });
	return { note, ok, thumbs, suspended };
}

export function parseMotionGraphic(value: unknown): MotionGraphicDecision | undefined {
	if (!value || typeof value !== "object") return undefined;
	const parsed = motionGraphicSchema.safeParse(value);
	return parsed.success ? parsed.data : undefined;
}
