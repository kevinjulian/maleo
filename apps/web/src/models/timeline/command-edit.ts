/* An edit a caller hands to the document writers: a command, or a function that
 * builds one from the live scope.
 *
 * The builder form exists for edits that must be computed against the state at
 * the moment they are committed rather than when the caller rendered (a keyframe
 * edit, a source-audio extraction): the React-mirrored scope can lag a render.
 * It is resolved to plain command data before anything executes or records it,
 * so the ledger only ever holds data. */
import type { EditorCommand, EditScope } from "@maleo/shared/editor";

export type CommandEdit = EditorCommand | ((scope: EditScope) => EditorCommand);

export function resolveEdit(edit: CommandEdit, scope: EditScope): EditorCommand {
	return typeof edit === "function" ? edit(scope) : edit;
}
