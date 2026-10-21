/* Which clips a command writes. One rule for every fence that holds an agent
 * run's commands against a document that moved: the editor's settle
 * (`apps/web/src/models/agent/apply-agent-commands.ts`) and the server's
 * rebase of an edit-only run (`apps/api/src/modules/agents/core/persistence.ts`). */
import type { EditorCommand } from "./commands.ts";
import type { Clip } from "../timeline-doc.ts";
import type { EntityFingerprint } from "../chat-context-envelope.ts";

const flatten = (commands: readonly EditorCommand[]): EditorCommand[] =>
	commands.flatMap((command) => (command.type === "batch" ? flatten(command.commands) : [command]));

/** The ids of the clips the commands write, in first-mention order. */
export function commandClipIds(
	commands: readonly EditorCommand[],
	clips: readonly Clip[] = [],
	captured: readonly EntityFingerprint[] = [],
): string[] {
	const ids = flatten(commands).flatMap((command) => {
		if (command.type === "caption.edit") {
			const edit = command.edit;
			if (edit.action === "create") return [edit.clip.id];
			if (edit.action === "apply-result")
				return [...edit.ids, ...edit.candidates.map((clip) => clip.id)];
			if (edit.action === "split") return [edit.id, edit.newId];
			return "ids" in edit ? edit.ids : [edit.id];
		}
		if (command.type === "clip.insert") return [command.clip.id];
		return "id" in command && typeof command.id === "string" && command.type.startsWith("clip.")
			? [command.id]
			: [];
	});
	const touched = new Set(ids);
	if (flatten(commands).some((command) => command.type === "doc.setTrackFlags")) {
		for (const clip of clips.filter(
			(clip) => clip.type === "audio" || clip.type === "video" || clip.scene || clip.vis,
		))
			touched.add(clip.id);
		for (const entry of captured) for (const id of entry.sourceClipIds ?? []) touched.add(id);
	}
	for (const clip of clips) {
		if (clip.caption?.sources.some((source) => touched.has(source.clipId))) touched.add(clip.id);
	}
	for (const entry of captured)
		if (entry.sourceClipIds?.some((id) => touched.has(id))) touched.add(entry.id);
	return [...touched];
}

/** The ids of the clips the commands insert: a document that already holds one
 *  has had it taken since, and an insert would duplicate it. */
export function commandInsertedClipIds(commands: readonly EditorCommand[]): string[] {
	return flatten(commands).flatMap((command) => {
		if (command.type === "caption.edit") {
			const edit = command.edit;
			if (edit.action === "create") return [edit.clip.id];
			if (edit.action === "apply-result")
				return edit.candidates.map((clip) => clip.id).filter((id) => !edit.ids.includes(id));
			if (edit.action === "split") return [edit.newId];
		}
		return command.type === "clip.insert" ? [command.clip.id] : [];
	});
}
