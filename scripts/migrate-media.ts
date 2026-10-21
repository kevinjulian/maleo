/** Offline importer. Dry-run by default; --apply needs configured S3 and a DB
 * backup. Re-run safely after interruption. Never deletes legacy bytes. */
import { sqliteDb } from "../packages/db/src/db/handle";
import { Database } from "bun:sqlite";
import { createWriteStream, existsSync, statSync } from "node:fs";
import { once } from "node:events";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { mkdir } from "node:fs/promises";
import { openLegacySqlite, resolveLegacySqlitePath } from "../packages/db/src/db/legacy-sqlite";
import {
	getLegacyMediaLink,
	getMediaObject,
	linkLegacyMedia,
	mediaObjectUrl,
	registerMediaObject,
} from "../packages/db/src/db/media-objects";
import {
	getMedia,
	mediaStorageMode,
	putMedia,
	type MediaKind,
} from "../packages/storage/src/storage.ts";

type Spec = { table: string; column: string; owner: string; join?: string; immutable?: boolean };
const LEGACY_PATH = /^\/(uploads|files|api\/image-gen\/files)\/[A-Za-z0-9][A-Za-z0-9._-]*$/;
const SOURCES: Spec[] = [
	{
		table: "content_storyboards",
		column: "storyboard_json",
		owner: "p.workspace",
		join: "JOIN content_projects p ON p.id = t.project_id",
		immutable: true,
	},
	{ table: "image_ledger", column: "asset_url", owner: "t.workspace" },
	{ table: "image_jobs", column: "image_url", owner: "t.workspace" },
	{ table: "content_projects", column: "editor_state_json", owner: "t.workspace" },
	{ table: "reference_entity", column: "canonical_image_url", owner: "t.workspace" },
	{
		table: "project_style_lock",
		column: "board_image_url",
		owner: "p.workspace",
		join: "JOIN content_projects p ON p.id = t.project_id",
	},
	{
		table: "content_assets",
		column: "src",
		owner: "COALESCE(t.workspace, p.workspace)",
		join: "LEFT JOIN content_projects p ON p.id = t.project_id",
	},
	{ table: "voice_clone", column: "ref_url", owner: "t.workspace" },
	{
		table: "content_project_outputs",
		column: "content_json",
		owner: "p.workspace",
		join: "JOIN content_projects p ON p.id = t.project_id",
	},
	{ table: "drafts", column: "image_urls_json", owner: "t.workspace" },
	{ table: "drafts", column: "thread_image_urls_json", owner: "t.workspace" },
	{ table: "drafts", column: "video_output_url", owner: "t.workspace" },
];

export function legacyPath(raw: string, allowedOrigins: ReadonlySet<string>): string | null {
	let url: URL;
	try {
		url = new URL(raw, "http://local.invalid");
	} catch {
		return null;
	}
	if (url.origin !== "http://local.invalid" && !allowedOrigins.has(url.origin)) return null;
	let pathname: string;
	try {
		pathname = decodeURIComponent(url.pathname);
	} catch {
		return null;
	}
	return LEGACY_PATH.test(pathname) ? pathname : null;
}

function unrecognizedOrigin(
	raw: string,
	allowedOrigins: ReadonlySet<string>,
): { origin: string; url: string } | null {
	try {
		const url = new URL(raw);
		if (!["http:", "https:"].includes(url.protocol) || allowedOrigins.has(url.origin)) return null;
		return LEGACY_PATH.test(decodeURIComponent(url.pathname))
			? { origin: url.origin, url: `${url.origin}${url.pathname}` }
			: null;
	} catch {
		return null;
	}
}

function roots(pathname: string, root: string): string[] {
	const name = pathname.split("/").at(-1)!;
	if (pathname.startsWith("/uploads/"))
		return [join(root, "apps/api/public/uploads", name), join(root, "public/uploads", name)];
	const cache = process.env.CACHE_DIR?.trim() || "apps/media-worker/data/cache";
	return [join(isAbsolute(cache) ? cache : join(root, cache), name)];
}

type MediaType = { kind: MediaKind; contentType: string };
function typeOf(pathname: string): MediaType {
	const ext = pathname.split(".").at(-1)?.toLowerCase();
	const types: Record<string, string> = {
		jpg: "image/jpeg",
		jpeg: "image/jpeg",
		png: "image/png",
		webp: "image/webp",
		avif: "image/avif",
		gif: "image/gif",
		svg: "image/svg+xml",
		mp3: "audio/mpeg",
		wav: "audio/wav",
		ogg: "audio/ogg",
		m4a: "audio/mp4",
		mp4: "video/mp4",
		webm: "video/webm",
		json: "application/json",
	};
	const contentType = types[ext ?? ""] ?? "application/octet-stream";
	const kind: MediaKind = contentType.startsWith("image/")
		? "image"
		: contentType.startsWith("audio/")
			? "audio"
			: contentType.startsWith("video/")
				? "video"
				: ext === "json"
					? "manifest"
					: "file";
	return { kind, contentType };
}

type Report = {
	scanned: number;
	references: number;
	availableFiles: number;
	availableBytes: number;
	copied: number;
	rewritten: number;
	missing: number;
	unresolved: number;
	unrecognizedOrigins: number;
	failures: number;
};

export async function migrateLegacyMedia(input: {
	db: Database;
	root: string;
	apply: boolean;
	allowedOrigins?: ReadonlySet<string>;
	onMissing?: (row: Record<string, unknown>) => void | Promise<void>;
	onProgress?: (report: Report) => void;
	failureCeiling?: number;
}): Promise<Report> {
	const report: Report = {
		scanned: 0,
		references: 0,
		availableFiles: 0,
		availableBytes: 0,
		copied: 0,
		rewritten: 0,
		missing: 0,
		unresolved: 0,
		unrecognizedOrigins: 0,
		failures: 0,
	};
	let consecutiveFailures = 0;
	const origins = input.allowedOrigins ?? new Set<string>();
	const hasLinks = Boolean(
		input.db
			.query<{ name: string }, []>(
				"SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'legacy_media_links'",
			)
			.get(),
	);
	const resolved = new Map<string, string | null | false>();
	const reportedOrigins = new Set<string>();
	for (const spec of SOURCES) {
		if (
			!input.db
				.query<{ name: string }, [string]>(
					"SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
				)
				.get(spec.table)
		)
			continue;
		let cursor = 0;
		for (;;) {
			const rows = input.db
				.query<{ rid: number; workspace: string | null; value: string | null }, [number]>(
					`SELECT t.rowid rid, ${spec.owner} workspace, t.${spec.column} value FROM ${spec.table} t ${spec.join ?? ""}
         WHERE t.rowid > ? AND (instr(t.${spec.column}, '/uploads/') > 0 OR instr(t.${spec.column}, '/files/') > 0)
         ORDER BY t.rowid LIMIT 200`,
				)
				.all(cursor);
			if (!rows.length) break;
			for (const row of rows) {
				cursor = row.rid;
				report.scanned++;
				if (!row.value) continue;
				let value: unknown = row.value;
				const json = spec.column.endsWith("_json");
				if (json) {
					try {
						value = JSON.parse(row.value);
					} catch {
						report.unresolved++;
						await input.onMissing?.({
							table: spec.table,
							column: spec.column,
							rowid: row.rid,
							reason: "invalid_json",
						});
						continue;
					}
				}
				let changed = false;
				const rewrite = async (node: unknown): Promise<unknown> => {
					if (typeof node === "string") {
						const pathname = legacyPath(node, origins);
						if (!pathname) {
							const foreign = unrecognizedOrigin(node, origins);
							if (foreign) {
								report.unrecognizedOrigins++;
								const key = `${row.workspace}\0${foreign.url}`;
								if (!reportedOrigins.has(key)) {
									reportedOrigins.add(key);
									await input.onMissing?.({
										table: spec.table,
										column: spec.column,
										rowid: row.rid,
										workspace: row.workspace,
										url: foreign.url,
										origin: foreign.origin,
										reason: "origin_not_allowed",
									});
								}
							}
							return node;
						}
						report.references++;
						if (!row.workspace) {
							report.unresolved++;
							await input.onMissing?.({
								table: spec.table,
								column: spec.column,
								rowid: row.rid,
								url: pathname,
								reason: "unknown_owner",
							});
							return node;
						}
						const cacheKey = `${row.workspace}\0${pathname}`;
						let id = resolved.get(cacheKey);
						if (id === undefined) {
							id = hasLinks
								? await getLegacyMediaLink(pathname, row.workspace, sqliteDb(input.db))
								: null;
							if (id) {
								try {
									await getMedia((await getMediaObject(id, sqliteDb(input.db)))!.storage_key);
								} catch {
									id = null;
								}
							}
							if (!id) {
								const file = roots(pathname, input.root).find(existsSync);
								if (!file) id = false;
								else if (!input.apply) {
									report.availableFiles++;
									report.availableBytes += statSync(file).size;
								} else {
									const mediaType = typeOf(pathname);
									const stored = await putMedia({
										workspace: row.workspace,
										...mediaType,
										body: Bun.file(file),
										filename: pathname.split("/").at(-1),
									});
									id = (
										await registerMediaObject(
											{
												workspace: row.workspace,
												kind: mediaType.kind,
												hash: stored.hash,
												storage_key: stored.key,
												content_type: stored.contentType,
												size: stored.size,
											},
											sqliteDb(input.db),
										)
									).id;
									await linkLegacyMedia(pathname, row.workspace, id, sqliteDb(input.db));
									report.copied++;
								}
							}
							resolved.set(cacheKey, id);
						}
						if (id === false) {
							report.missing++;
							await input.onMissing?.({
								table: spec.table,
								column: spec.column,
								rowid: row.rid,
								workspace: row.workspace,
								url: pathname,
								reason: "file_missing",
							});
							return node;
						}
						// `id` is null only on a dry run, which never rewrites.
						if (!input.apply || spec.immutable || id === null) return node;
						changed = true;
						return mediaObjectUrl(id);
					}
					if (Array.isArray(node)) {
						const result = [];
						for (const item of node) result.push(await rewrite(item));
						return result;
					}
					if (node && typeof node === "object") {
						const entries = [];
						for (const [key, item] of Object.entries(node))
							entries.push([key, await rewrite(item)] as const);
						return Object.fromEntries(entries);
					}
					return node;
				};
				/* One unreadable row must not end a multi-hour import: it is reported and
				 * skipped, and the legacy bytes it points at are never deleted, so a
				 * later run retries it. A dead store or bad credentials would otherwise
				 * "skip" every remaining row and look like a success, so a run of
				 * consecutive failures still aborts. */
				try {
					const next = await rewrite(value);
					if (changed && input.apply) {
						const serialized = json ? JSON.stringify(next) : String(next);
						const result = input.db.run(
							`UPDATE ${spec.table} SET ${spec.column} = ? WHERE rowid = ? AND ${spec.column} = ?`,
							[serialized, row.rid, row.value],
						);
						if (result.changes !== 1)
							throw new Error(
								`migration concurrent edit: ${spec.table}.${spec.column} row ${row.rid}`,
							);
						report.rewritten++;
					}
					consecutiveFailures = 0;
				} catch (error) {
					report.failures++;
					consecutiveFailures++;
					await input.onMissing?.({
						table: spec.table,
						column: spec.column,
						rowid: row.rid,
						workspace: row.workspace,
						reason: "row_failed",
						error: error instanceof Error ? error.message : String(error),
					});
					if (consecutiveFailures >= (input.failureCeiling ?? 50))
						throw new Error(
							`migration aborted after ${consecutiveFailures} consecutive row failures; last: ${error instanceof Error ? error.message : String(error)}`,
						);
				}
			}
			input.onProgress?.({ ...report });
			// Let report writes drain between batches during multi-gigabyte imports.
			await Bun.sleep(0);
		}
	}
	return report;
}

if (import.meta.main) {
	const apply = process.argv.includes("--apply");
	if (apply && mediaStorageMode() !== "s3")
		throw new Error("--apply requires S3 backend; keep old data until cutover proof");
	const root = resolve(import.meta.dir, "..");
	const reportPath = resolve(
		process.env.MALEO_DATA_DIR?.trim() || join(root, "data"),
		"media-migration-missing.jsonl",
	);
	await mkdir(dirname(reportPath), { recursive: true });
	const out = createWriteStream(reportPath);
	const allowedOrigins = new Set(
		[
			process.env.MALEO_API_URL,
			process.env.MALEO_WEB_URL,
			process.env.MALEO_GEN_WORKER_URL,
			process.env.MALEO_IMAGE_GEN_URL,
		]
			.filter((value): value is string => Boolean(value))
			.map((value) => new URL(value).origin),
	);
	for (let index = 0; index < process.argv.length; index++) {
		if (process.argv[index] !== "--origin") continue;
		const value = process.argv[++index];
		if (!value) throw new Error("--origin needs an http(s) URL");
		const url = new URL(value);
		if (!["http:", "https:"].includes(url.protocol))
			throw new Error("--origin needs an http(s) URL");
		allowedOrigins.add(url.origin);
	}
	try {
		const db = apply
			? openLegacySqlite()
			: new Database(resolveLegacySqlitePath(), { readonly: true });
		const report = await migrateLegacyMedia({
			db,
			root,
			apply,
			allowedOrigins,
			onMissing: async (item) => {
				if (!out.write(`${JSON.stringify(item)}\n`)) await once(out, "drain");
			},
			onProgress: (progress) => {
				if (progress.scanned % 5000 === 0)
					console.error(
						JSON.stringify({
							scanned: progress.scanned,
							references: progress.references,
							copied: progress.copied,
							rewritten: progress.rewritten,
							missing: progress.missing,
							unresolved: progress.unresolved,
							unrecognizedOrigins: progress.unrecognizedOrigins,
							failures: progress.failures,
						}),
					);
			},
		});
		console.log(
			JSON.stringify({ mode: apply ? "apply" : "dry-run", report, missingReport: reportPath }),
		);
	} finally {
		await new Promise<void>((resolve) => out.end(resolve));
	}
}
