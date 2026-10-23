/* The command log's wire shapes (`p1-command-log`), as the api answers them.
 * They live here so the sync model reads them without importing the api layer. */
import type { EditorCommand } from "@maleo/shared/editor";

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
