/* Saving an edit-only run onto the document as it stands now
 * (`migrate-editor-to-shared-rust-core` task 4.6).
 *
 * A run that only edited the timeline is a list of editor commands against the
 * document it started from. Writing the run's own projection of that document
 * back would overwrite anything saved since — a hand edit, another run. So its
 * save re-executes the commands, in the Rust engine the editor uses, against the
 * latest saved document:
 *
 * - Every version a run writes records `agentEdit: {runId, applied}`, how many of
 *   its commands it holds. On the run's own last write, only the rest execute;
 *   execution is identified by run and position, so a retried save never applies
 *   a command twice.
 * - On the version the run started from, all of them execute.
 * - On anything else, someone saved since: the clips the commands write are
 *   fenced against the run's base fingerprints. A clip changed or taken
 *   meanwhile, or a command the engine refuses there, writes nothing and records
 *   the conflict on the run, rather than overwriting the newer work. */
import {
	clipFingerprint,
	type Clip,
	type EntityFingerprint,
	type TimelineDoc,
} from "@maleo/shared";
import {
	commandClipIds,
	commandInsertedClipIds,
	type AgentEditMarker,
	type EditorCommand,
	type EditScope,
} from "@maleo/shared/editor";
import { editorEngine } from "../../../lib/editor-engine.ts";
import type { AgentJob } from "./model.ts";

/** A run that changed the document only through its editing tools. */
export function isEditOnlyRun(job: AgentJob): boolean {
	return job.contentType === "video" && !job.run?.jobWrites && (job.editCommands?.length ?? 0) > 0;
}

export type Rebase =
	| { status: "write"; doc: TimelineDoc; applied: number }
	| { status: "unchanged" }
	| { status: "conflict"; reason: string };

/* A clip the commands write must be as the run found it: present with the same
 * fingerprint, or — for an insert — still absent. */
function staleClips(
	commands: readonly EditorCommand[],
	base: readonly EntityFingerprint[] | undefined,
	clips: readonly Clip[],
): string[] {
	if (!base) return commandClipIds(commands, clips);
	const then = new Map(base.map((entry) => [entry.id, entry]));
	const now = new Map(clips.map((clip) => [clip.id, clip]));
	const inserted = new Set(commandInsertedClipIds(commands));
	return commandClipIds(commands, clips, base).filter((id) => {
		const clip = now.get(id);
		if (inserted.has(id) && !then.has(id)) return clip !== undefined;
		const was = then.get(id);
		return !was || !clip || JSON.stringify(clipFingerprint(clip)) !== JSON.stringify(was);
	});
}

/** The run's commands executed onto `latest`, the newest saved document. */
export function rebaseRunEdits(
	job: AgentJob,
	latest: { id: string | null; doc: TimelineDoc; marker: AgentEditMarker | undefined },
): Rebase {
	const commands = job.editCommands ?? [];
	let start = 0;
	if (latest.marker?.runId === job.id) start = latest.marker.applied;
	else if (latest.id !== (job.baseRevisionId ?? null)) {
		const stale = staleClips(commands, job.baseFingerprints, latest.doc.clips);
		if (stale.length)
			return {
				status: "conflict",
				reason: `saved since this run started: ${stale.join(", ")} changed`,
			};
	}
	if (start >= commands.length) return { status: "unchanged" };
	let scope: EditScope = { mediaAssets: [], doc: latest.doc, slides: [], posts: [] };
	for (const command of commands.slice(start)) {
		const executed = editorEngine().executeOnce(JSON.stringify(scope), JSON.stringify(command));
		if (!executed.ok)
			return {
				status: "conflict",
				reason: `${command.type} no longer applies: ${executed.error.message}`,
			};
		// SAFETY: `{scope, inverse}` as the engine writes it.
		scope = (JSON.parse(executed.value) as { scope: EditScope }).scope;
	}
	return { status: "write", doc: scope.doc, applied: commands.length };
}
