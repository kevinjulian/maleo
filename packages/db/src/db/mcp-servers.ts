/* MCP servers configured for a workspace (migration 0005).
 *
 * Headers are sealed on write and opened only by `getMcpServersWithHeaders`, the
 * one reader that connects. Every other read reports which headers are set, never
 * their values. */
import { randomUUID } from "node:crypto";
import { openDb } from "./connection.ts";
import type { Db } from "./handle.ts";
import { openSealedValue, sealValue } from "./secret-store.ts";

export interface McpServer {
	id: string;
	workspace: string;
	name: string;
	url: string;
	/** The server's own tool names that may reach the model. */
	allow: string[];
	/** The names of the headers stored for it. */
	headerNames: string[];
	updatedAt: number;
}

export interface McpServerWithHeaders extends McpServer {
	headers: Record<string, string>;
}

interface Row {
	id: string;
	workspace: string;
	name: string;
	url: string;
	allow_json: string;
	headers_sealed: string | null;
	updated_at: number;
}

export interface PutMcpServerInput {
	workspace: string;
	name: string;
	url: string;
	allow: string[];
	/** Replaces the stored headers; omit to keep them. */
	headers?: Record<string, string>;
}

function stringList(json: string): string[] {
	const parsed: unknown = JSON.parse(json);
	return Array.isArray(parsed)
		? parsed.filter((item): item is string => typeof item === "string")
		: [];
}

async function openHeaders(row: Row, db: Db): Promise<Record<string, string>> {
	if (!row.headers_sealed) return {};
	const parsed: unknown = JSON.parse(await openSealedValue(row.headers_sealed, db));
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
	return Object.fromEntries(
		Object.entries(parsed).filter(
			(entry): entry is [string, string] => typeof entry[1] === "string",
		),
	);
}

async function toServer(row: Row, db: Db): Promise<McpServer> {
	return {
		id: row.id,
		workspace: row.workspace,
		name: row.name,
		url: row.url,
		allow: stringList(row.allow_json),
		headerNames: Object.keys(await openHeaders(row, db)).sort(),
		updatedAt: row.updated_at,
	};
}

export async function listMcpServers(workspace: string, db: Db = openDb()): Promise<McpServer[]> {
	const rows = await db.all<Row>("SELECT * FROM mcp_servers WHERE workspace = ? ORDER BY name", [
		workspace,
	]);
	return await Promise.all(rows.map((row) => toServer(row, db)));
}

/** The workspace's servers with their headers, for connecting. */
export async function getMcpServersWithHeaders(
	workspace: string,
	db: Db = openDb(),
): Promise<McpServerWithHeaders[]> {
	const rows = await db.all<Row>("SELECT * FROM mcp_servers WHERE workspace = ? ORDER BY name", [
		workspace,
	]);
	return await Promise.all(
		rows.map(async (row) => ({
			...(await toServer(row, db)),
			headers: await openHeaders(row, db),
		})),
	);
}

/** Create or replace the workspace's server of this name. */
export async function putMcpServer(
	input: PutMcpServerInput,
	db: Db = openDb(),
): Promise<McpServer> {
	const now = Date.now();
	const sealed =
		input.headers === undefined
			? undefined
			: Object.keys(input.headers).length
				? await sealValue(JSON.stringify(input.headers), db)
				: null;
	await db.run(
		`INSERT INTO mcp_servers (id, workspace, name, url, allow_json, headers_sealed, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?)
		 ON CONFLICT (workspace, name) DO UPDATE SET url = excluded.url, allow_json = excluded.allow_json,
		   headers_sealed = ${sealed === undefined ? "mcp_servers.headers_sealed" : "excluded.headers_sealed"}, updated_at = excluded.updated_at`,
		[
			randomUUID(),
			input.workspace,
			input.name,
			input.url,
			JSON.stringify(input.allow),
			sealed ?? null,
			now,
			now,
		],
	);
	const row = await db.get<Row>("SELECT * FROM mcp_servers WHERE workspace = ? AND name = ?", [
		input.workspace,
		input.name,
	]);
	if (!row) throw new Error("mcp_servers: the written row could not be read back");
	return await toServer(row, db);
}

export async function deleteMcpServer(
	workspace: string,
	name: string,
	db: Db = openDb(),
): Promise<boolean> {
	return (
		(await db.run("DELETE FROM mcp_servers WHERE workspace = ? AND name = ?", [workspace, name]))
			.changes > 0
	);
}
