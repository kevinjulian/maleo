/* The project command log (`p1-command-log`): submit pending editor commands,
 * read the entries after a sequence. */
import type { EditorCommand } from "@maleo/shared/editor";
import { get, patch, post } from "./client.ts";
import { BASE } from "./base.ts";
import { withReadyPending } from "@models/core/pending-media-sources.ts";

export interface CommandLogEntry {
	seq: number;
	version: number | null;
	commands: EditorCommand[];
	actor: string;
	snapshot?: true;
}

export interface CommandRejection {
	clientCommandId: string;
	kind: string;
	message: string;
}

export interface SubmitCommandsReply {
	headSeq: number;
	headVersion: number;
	accepted: { clientCommandId: string; seq: number; version: number | null }[];
	rejected: CommandRejection[];
	delivered: CommandLogEntry[];
}

export interface CommandLogRead {
	headSeq: number;
	headVersion: number;
	headStoryboardId: string | null;
	entries: CommandLogEntry[];
}

export function submitCommands(
	projectId: string,
	baseSeq: number,
	commands: readonly { clientCommandId: string; command: EditorCommand }[],
): Promise<SubmitCommandsReply> {
	return post<SubmitCommandsReply>(`${BASE}/projects/${projectId}/commands`, {
		baseSeq,
		// Ready imports take their server metadata; unfinished ones keep their minted URL.
		commands: commands.map((c) => ({ ...c, command: withReadyPending(c.command) })),
	});
}

/** `after` absent: the head only, to learn where a freshly loaded editor starts. */
export function readCommandLog(projectId: string, after?: number): Promise<CommandLogRead> {
	const query = after === undefined ? "" : `?after=${after}`;
	return get<CommandLogRead>(`${BASE}/projects/${projectId}/commands${query}`);
}

/** The stored fields outside the editable scope, written alone onto the head. */
export function savePresentation(
	projectId: string,
	fields: {
		pacingDevices: object | null;
		infographicStyle: object | null;
		presentation: object | null;
	},
): Promise<{ ok: true; version: number }> {
	return patch(`${BASE}/projects/${projectId}/storyboard-presentation`, fields);
}
