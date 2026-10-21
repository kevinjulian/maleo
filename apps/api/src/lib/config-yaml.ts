/* Workspace configuration: read from and written to the database.
 *
 * The document is the YAML an operator edits — stored as a row in
 * `workspace_config` rather than as `data/workspaces/<ws>/config.yaml`. A file
 * of that name left on disk is ignored: the row is the only source of truth.
 *
 * Reads parse with `WorkspaceSchema`, whose dashboard-managed blocks read a
 * malformed block as absent so one bad block cannot take unrelated readers
 * down. Writes are stricter: they validate against `WorkspaceWriteSchema` and
 * are refused, naming the field, when the document is invalid — a row that was
 * written is a row that reads back valid. A credential-shaped key is refused
 * too: secrets live in the encrypted secret store, never in configuration.
 *
 * `name` defaults from the workspace the caller named, as it did when the
 * directory was the name: a document that omits it (the metering suite writes
 * one holding `image_policy` alone) is still that workspace's configuration. */
import YAML from "yaml";
import { getWorkspaceConfigText, putWorkspaceConfigText } from "@maleo/db/workspace-config";
import type { Db } from "@maleo/db/handle";
import { resolveWriterStyle, type WriterStyleProfile } from "@maleo/shared";
import { WorkspaceSchema, WorkspaceWriteSchema, type Workspace } from "./workspace/schema.ts";

export class WorkspaceConfigError extends Error {
	override name = "WorkspaceConfigError";
}

const named = (workspace: string, raw: unknown): unknown =>
	typeof raw === "object" && raw !== null && !Array.isArray(raw)
		? { name: workspace, ...raw }
		: raw;

export async function readWorkspaceConfigText(workspace: string, db?: Db): Promise<string> {
	const text = await getWorkspaceConfigText(workspace, db);
	if (text === null)
		throw new WorkspaceConfigError(`workspace "${workspace}" has no stored configuration`);
	return text;
}

export async function readWorkspaceConfig(workspace: string, db?: Db): Promise<Workspace> {
	const raw: unknown = YAML.parse(await readWorkspaceConfigText(workspace, db)) ?? {};
	return WorkspaceSchema.parse(named(workspace, raw));
}

/* Keys that name a credential. Matched on the key, not the value: a value
 * cannot be told apart from an ordinary string, and a key that says `token` is
 * where one would be put. */
const CREDENTIAL_KEY =
	/(secret|password|passwd|token|api[_-]?key|private[_-]?key|credential|bearer)/i;

function credentialPath(value: unknown, path: string[] = []): string | null {
	if (Array.isArray(value)) {
		for (const [i, item] of value.entries()) {
			const found = credentialPath(item, [...path, String(i)]);
			if (found) return found;
		}
		return null;
	}
	if (value && typeof value === "object") {
		for (const [key, item] of Object.entries(value)) {
			if (CREDENTIAL_KEY.test(key)) return [...path, key].join(".");
			const found = credentialPath(item, [...path, key]);
			if (found) return found;
		}
	}
	return null;
}

/** Parse and validate a configuration document, refusing it naming the field.
 *  Exported for the one-time carry-over of files, which must stop on the same
 *  documents a write would refuse. */
export function validateWorkspaceConfigText(workspace: string, text: string): void {
	let raw: unknown;
	try {
		raw = YAML.parse(text) ?? {};
	} catch (error) {
		throw new WorkspaceConfigError(
			`configuration for "${workspace}" is not valid YAML: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
	const secret = credentialPath(raw);
	if (secret) {
		throw new WorkspaceConfigError(
			`configuration for "${workspace}" holds a credential at "${secret}"; credentials belong in the secret store`,
		);
	}
	const parsed = WorkspaceWriteSchema.safeParse(named(workspace, raw));
	if (!parsed.success) {
		const issue = parsed.error.issues[0]!;
		throw new WorkspaceConfigError(
			`configuration for "${workspace}" is invalid at "${issue.path.join(".") || "(root)"}": ${issue.message}`,
		);
	}
}

export async function writeWorkspaceConfigText(
	workspace: string,
	text: string,
	db?: Db,
): Promise<void> {
	validateWorkspaceConfigText(workspace, text);
	await putWorkspaceConfigText(workspace, text, db);
}

/* The workspace's narration writer style, resolved to its profile.
 *
 * Absent workspace, unreadable config and unknown key all mean the same thing —
 * no writer style — and none of them is an error worth failing a plan over. */
export async function workspaceWriterStyle(
	workspace: string | undefined,
): Promise<WriterStyleProfile | undefined> {
	if (!workspace) return undefined;
	try {
		return resolveWriterStyle((await readWorkspaceConfig(workspace)).writer_style);
	} catch {
		return undefined;
	}
}
