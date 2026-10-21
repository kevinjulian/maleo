/* Replayable tool output — re-apply a stored generate mutation without calling
 * the provider. When a segment retry replays a step whose expensive tool already
 * ran (recorded in tool_run with a matching idempotency key), the executor
 * re-applies the stored asset here instead of regenerating it, so a retry never
 * double-bills. Immutable updates (no in-place mutation), matching the codebase
 * style. Pure leaf: model + types are type-only imports, so no runtime cycle. */
import { executeEdit } from "./edit-document.ts";
import type { AgentJob } from "./model.ts";
import type { ToolReplay } from "./types.ts";

// Re-apply a stored generate mutation onto the job. No-op when the target ref no
// longer exists (the snapshot changed shape) — the caller then falls back to
// running the tool normally.
export function applyToolReplay(job: AgentJob, replay: ToolReplay): boolean {
	if (replay.kind === "scene_frame") {
		if (!job.scenes[replay.index]) return false;
		job.scenes = job.scenes.map((s, i) => (i === replay.index ? { ...s, image: replay.url } : s));
		return true;
	}
	if (replay.kind === "edit") {
		/* The snapshot may already hold the call's commands (the crash came after it
		 * was saved) or not (before). Re-applying in the first case would edit twice. */
		const held = job.editCommands ?? [];
		if (
			JSON.stringify(held.slice(held.length - replay.commands.length)) ===
			JSON.stringify(replay.commands)
		)
			return true;
		return replay.commands.every((command) => executeEdit(job, command).ok);
	}
	return false;
}
