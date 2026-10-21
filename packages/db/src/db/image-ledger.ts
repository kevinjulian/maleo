/* The image ledger — one row per generation attempt, across every producer.
 *
 * Replaces prompt-library.ts, which was UNIQUE(workspace, prompt) and merged
 * image_url on conflict: it held one row per PROMPT, so regenerating a prompt
 * overwrote the earlier image, and it carried no project_id. Only one of the four
 * image producers ever wrote to it.
 *
 * A row is opened before the generation is submitted and resolved when the attempt
 * concludes. Opening at submit is the point: attribution used to live in an
 * in-memory Map, so an API restart between submit and completion lost it silently.
 *
 * Reads return COMPLETED, NOT-DELETED rows only. That filter lives here rather than
 * at each call site so a caller cannot leak a pending attempt into a gallery by
 * forgetting a WHERE.
 */

import { randomUUID } from "node:crypto";
import type { Param } from "./handle.ts";
import { openDb } from "./connection.ts";
import type { Db } from "./handle.ts";

/** What kind of artifact a row recorded. The ledger is no longer image-only, and
 *  the medium is stored rather than inferred from which columns are populated —
 *  a speech row with no duration is still speech. */
export const MEDIA = ["image", "speech"] as const;

export type Medium = (typeof MEDIA)[number];

/** Which producer made the artifact. Not a free-text column by accident: the
 *  gallery filters on it and each value is a code path.
 *
 *  The vocabulary is PER MEDIUM. There is no reference speech and no scene image,
 *  so a single flat union would let a gallery offer a filter value its medium can
 *  never produce — a control that always returns nothing. `sourcesFor` is what a
 *  facet builder asks, so the two lists cannot drift from the two unions.
 *
 * The members are values as well as types, so a route can check a `?source=`
 * query param rather than assert it.
 *
 * Note there is an unrelated `ImageSource` in `@maleo/video`
 * (`"cache" | "service" | "placeholder"`) — same name, different domain. Neither
 * is wrong; they are just not the same type, and a reader who greps the name
 * will find both. */
export const IMAGE_SOURCES = ["lab", "clip", "reference", "agent"] as const;

export const SPEECH_SOURCES = ["lab", "scene", "agent"] as const;

export type ImageSource = (typeof IMAGE_SOURCES)[number];

export type SpeechSource = (typeof SPEECH_SOURCES)[number];

export type LedgerSource = ImageSource | SpeechSource;

/** The source values a medium can actually be produced by. */
export function sourcesFor(medium: Medium): readonly LedgerSource[] {
	return medium === "speech" ? SPEECH_SOURCES : IMAGE_SOURCES;
}

export type ImageLedgerStatus = "pending" | "completed" | "failed";

export interface ImageLedgerRow {
	id: string;
	workspace: string;
	project_id: string | null;
	medium: Medium;
	source: LedgerSource;
	status: ImageLedgerStatus;
	prompt: string | null;
	asset_url: string | null;
	/** Image-only. Absent on speech because speech has no aspect, not because it
	 *  is unknown. */
	aspect: string | null;
	/** Speech-only, and absent on images for the same reason. */
	voice: string | null;
	provider: string | null;
	duration_sec: number | null;
	job_id: string | null;
	/** The generation's identity across retries; see migration 0004. */
	generation_key: string | null;
	backfilled: number;
	starred: number;
	created_at: number;
	resolved_at: number | null;
	deleted_at: number | null;
}

/* A ledger row plus the name of the project it belongs to.
 *
 * Joined here rather than resolved by the caller: a gallery tile must say WHERE
 * an image came from, and making the client map ids to titles would mean either
 * an N+1 or shipping the whole project list to render one label. */
export interface ImageLedgerListRow extends ImageLedgerRow {
	project_title: string | null;
}

export interface OpenGenerationInput {
	workspace: string;
	/** Absent for lab and workspace-scoped reference images — means "no project". */
	projectId?: string | null;
	/** Defaults to image: every caller that predates speech generates images. */
	medium?: Medium;
	source: LedgerSource;
	prompt?: string | null;
	aspect?: string | null;
	/** Speech-only, known before synthesis is attempted. */
	voice?: string | null;
	provider?: string | null;
	jobId?: string | null;
	/** The generation's identity across retries; at most one live row holds it. */
	generationKey?: string | null;
	createdAt?: number;
}

/* Opened before the provider is called. Returns the row id so the caller can
 * resolve it even when the provider gives back no job id — which is every
 * synchronous producer, since there is no job at all. */
export async function openGeneration(
	input: OpenGenerationInput,
	db: Db = openDb(),
): Promise<string> {
	const medium: Medium = input.medium ?? "image";
	// The id prefix names the medium so a row is identifiable on sight in a log or
	// a failed-attempt dump, where the medium column is not in front of you.
	const id = `${medium === "speech" ? "spk" : "img"}-${randomUUID()}`;
	await db.run(
		`INSERT INTO image_ledger (id, workspace, project_id, medium, source, status, prompt, aspect, voice, provider, job_id, generation_key, created_at)
		 VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?)`,
		[
			id,
			input.workspace,
			input.projectId ?? null,
			medium,
			input.source,
			input.prompt?.trim() || null,
			input.aspect ?? null,
			input.voice ?? null,
			input.provider ?? null,
			input.jobId ?? null,
			input.generationKey ?? null,
			input.createdAt ?? Date.now(),
		],
	);
	return id;
}

/* The attempt that holds a generation key: pending or completed. A failed
 * attempt has given its key up. */
export async function findLiveByGenerationKey(
	key: string,
	db: Db = openDb(),
): Promise<ImageLedgerRow | null> {
	return await db.get<ImageLedgerRow>(
		`SELECT * FROM image_ledger WHERE generation_key = ? AND status <> 'failed'`,
		[key],
	);
}

/* The job id is often known only after submit returns. */
export async function attachJobId(id: string, jobId: string, db: Db = openDb()): Promise<void> {
	await db.run(`UPDATE image_ledger SET job_id = ? WHERE id = ? AND job_id IS NULL`, [jobId, id]);
}

/* Idempotent by design: resolving an already-resolved row is a no-op, so a
 * doubly-polled completion cannot write twice. This replaces the in-memory
 * `jobRecorded` Set, which guarded the same thing but was lost on restart. */
export async function resolveCompleted(
	id: string,
	assetUrl: string,
	db: Db = openDb(),
): Promise<boolean> {
	const result = await db.run(
		`UPDATE image_ledger SET status = 'completed', asset_url = ?, resolved_at = ?
		 WHERE id = ? AND status = 'pending'`,
		[assetUrl, Date.now(), id],
	);
	return result.changes > 0;
}

/* Resolving a speech attempt, which knows its clip's duration only once the
 * provider has returned the bytes. Separate from `resolveCompleted` rather than an
 * optional parameter on it: duration is speech's alone, and an image caller should
 * not be offered a field it can never fill. */
export async function resolveSpeechCompleted(
	id: string,
	assetUrl: string,
	durationSec: number | null,
	db: Db = openDb(),
): Promise<boolean> {
	const result = await db.run(
		`UPDATE image_ledger SET status = 'completed', asset_url = ?, duration_sec = ?, resolved_at = ?
		 WHERE id = ? AND status = 'pending'`,
		[assetUrl, durationSec, Date.now(), id],
	);
	return result.changes > 0;
}

export async function resolveFailed(id: string, db: Db = openDb()): Promise<boolean> {
	const result = await db.run(
		`UPDATE image_ledger SET status = 'failed', resolved_at = ? WHERE id = ? AND status = 'pending'`,
		[Date.now(), id],
	);
	return result.changes > 0;
}

export async function findByJobId(
	jobId: string,
	db: Db = openDb(),
): Promise<ImageLedgerRow | null> {
	return await db.get<ImageLedgerRow>(`SELECT * FROM image_ledger WHERE job_id = ?`, [jobId]);
}

/* The route path polls by job id and has no row id to hand. These are what replace
 * the in-memory jobWorkspaceMap: the association is read back from SQLite, so a
 * restart between submit and completion no longer loses it. */
export async function completeByJobId(
	jobId: string,
	assetUrl: string,
	db: Db = openDb(),
): Promise<boolean> {
	const result = await db.run(
		`UPDATE image_ledger SET status = 'completed', asset_url = ?, resolved_at = ?
		 WHERE job_id = ? AND status = 'pending'`,
		[assetUrl, Date.now(), jobId],
	);
	return result.changes > 0;
}

export async function failByJobId(jobId: string, db: Db = openDb()): Promise<boolean> {
	const result = await db.run(
		`UPDATE image_ledger SET status = 'failed', resolved_at = ? WHERE job_id = ? AND status = 'pending'`,
		[Date.now(), jobId],
	);
	return result.changes > 0;
}

export interface ListImagesInput {
	workspace?: string;
	/** `null` selects rows with no project; omit the key to not filter at all. */
	projectId?: string | null;
	source?: LedgerSource;
	search?: string;
	limit?: number;
	offset?: number;
}

/* The predicate every gallery read shares, medium included.
 *
 * `medium` is a parameter of this function rather than a field of
 * `ListImagesInput` on purpose: a caller cannot forget it, and cannot pass the
 * wrong one. The exported reads below each bind it to their own medium. This is
 * the same reasoning that already keeps `status`, `deleted_at` and the url check
 * here instead of at each call site — a missing predicate is not a type error, so
 * the only place it can be reliably enforced is the one place it is written.
 *
 * Alias-qualified because the project join brings a second table into scope; an
 * unqualified `status` would be ambiguous the moment content_projects grows one. */
interface VisiblePredicate {
	clauses: string[];
	params: Array<string | number>;
}

function visibleClauses(medium: Medium, input: ListImagesInput): VisiblePredicate {
	const clauses = [
		"l.medium = ?",
		"l.status = 'completed'",
		"l.deleted_at IS NULL",
		"l.asset_url IS NOT NULL",
	];
	const params: Array<string | number> = [medium];
	if (input.workspace) {
		clauses.push("l.workspace = ?");
		params.push(input.workspace);
	}
	if (input.projectId !== undefined) {
		if (input.projectId === null) clauses.push("l.project_id IS NULL");
		else {
			clauses.push("l.project_id = ?");
			params.push(input.projectId);
		}
	}
	if (input.source) {
		clauses.push("l.source = ?");
		params.push(input.source);
	}
	const search = input.search?.trim();
	if (search) {
		// SQLite's LIKE ignored case; Postgres' does not. Lowering both sides keeps it.
		clauses.push("lower(l.prompt) LIKE lower(?)");
		params.push(`%${search}%`);
	}
	return { clauses, params };
}

/* Completed and not deleted, newest first, for one medium. Pending and failed
 * attempts are operational state and never appear as artifacts. */
async function listMedium(
	medium: Medium,
	input: ListImagesInput,
	db: Db,
): Promise<ImageLedgerListRow[]> {
	const { clauses, params } = visibleClauses(medium, input);
	const limit = Math.max(1, Math.min(input.limit ?? 100, 500));
	const offset = Math.max(0, input.offset ?? 0);
	// LEFT JOIN, not INNER: an artifact whose project was deleted keeps its row and
	// its workspace. Losing the title must not lose the artifact.
	return await db.all<ImageLedgerListRow>(
		`SELECT l.*, p.title AS project_title
		 FROM image_ledger l
		 LEFT JOIN content_projects p ON p.id = l.project_id
		 WHERE ${clauses.join(" AND ")}
		 ORDER BY l.created_at DESC, l.id DESC LIMIT ? OFFSET ?`,
		[...params, limit, offset],
	);
}

export async function listImages(
	input: ListImagesInput = {},
	db: Db = openDb(),
): Promise<ImageLedgerListRow[]> {
	return await listMedium("image", input, db);
}

export async function listSpeech(
	input: ListImagesInput = {},
	db: Db = openDb(),
): Promise<ImageLedgerListRow[]> {
	return await listMedium("speech", input, db);
}

/* Every attempt, whatever its status — the operational view, not the gallery's.
 * The spec requires an abandoned attempt stay distinguishable from an in-flight
 * one, which needs a read that does not filter to completed. */
export async function listAttempts(
	input: { workspace?: string; status?: ImageLedgerStatus; limit?: number } = {},
	db: Db = openDb(),
): Promise<ImageLedgerRow[]> {
	const clauses: string[] = [];
	const params: Array<string | number> = [];
	if (input.workspace) {
		clauses.push("workspace = ?");
		params.push(input.workspace);
	}
	if (input.status) {
		clauses.push("status = ?");
		params.push(input.status);
	}
	const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
	const limit = Math.max(1, Math.min(input.limit ?? 200, 1000));
	return await db.all<ImageLedgerRow>(
		`SELECT * FROM image_ledger ${where} ORDER BY created_at DESC, id DESC LIMIT ?`,
		[...params, limit],
	);
}

/* The values a gallery filter can offer, taken from the artifacts that exist
 * rather than from a separate registry: a project with no images is not a useful
 * filter option, and neither is a source nothing was produced by. */
export interface ImageFacets {
	projects: Array<{ id: string; title: string }>;
	sources: LedgerSource[];
}

/* One workspace's filter options, for one medium.
 *
 * There is no `workspaces` facet any more: the gallery shows the ACTIVE
 * workspace and offers no control to leave it, so a list of the others was only
 * ever the raw material for a filter that no longer exists.
 *
 * The project list is scoped for a reason of its own. An unscoped facet offers
 * another tenant's project titles in the dropdown — a cross-tenant disclosure
 * that survives every filter applied afterwards, because choosing one just
 * returns nothing.
 *
 * `sources` is read from the rows rather than from `sourcesFor(medium)` for the
 * same reason the projects are: the vocabulary says what a medium COULD be
 * produced by, and a filter should offer what it WAS. Deriving it here also means
 * the Speech gallery cannot be handed an image-only value — a control that would
 * always return nothing.
 */
async function facetsForMedium(
	medium: Medium,
	workspace: string | undefined,
	db: Db,
): Promise<ImageFacets> {
	const visible =
		"l.medium = ? AND l.status = 'completed' AND l.deleted_at IS NULL AND l.asset_url IS NOT NULL";
	const scope = workspace ? "AND l.workspace = ?" : "";
	const params: Param[] = workspace ? [medium, workspace] : [medium];
	const projects = await db.all<{ id: string; title: string }>(
		`SELECT DISTINCT l.project_id AS id, p.title AS title
		 FROM image_ledger l
		 JOIN content_projects p ON p.id = l.project_id
		 WHERE ${visible} AND l.project_id IS NOT NULL ${scope}
		 ORDER BY p.title`,
		params,
	);
	const sources = await db.all<{ source: LedgerSource }>(
		`SELECT DISTINCT l.source AS source
		 FROM image_ledger l
		 WHERE ${visible} ${scope}
		 ORDER BY l.source`,
		params,
	);
	return { projects, sources: sources.map((s) => s.source) };
}

export async function imageFacets(workspace?: string, db: Db = openDb()): Promise<ImageFacets> {
	return await facetsForMedium("image", workspace, db);
}

export async function speechFacets(workspace?: string, db: Db = openDb()): Promise<ImageFacets> {
	return await facetsForMedium("speech", workspace, db);
}

/* Counting shares the list's predicate rather than restating it. The two used to
 * be written out separately, which is how a count can disagree with the gallery it
 * labels — the count is of the same rows or it is of nothing useful. */
async function countMedium(medium: Medium, input: ListImagesInput, db: Db): Promise<number> {
	const { clauses, params } = visibleClauses(medium, input);
	const row = await db.get<{ n: number }>(
		`SELECT COUNT(*) AS n FROM image_ledger l WHERE ${clauses.join(" AND ")}`,
		params,
	);
	// COUNT(*) with no GROUP BY returns exactly one row; `?? 0` states what the
	// assertion used to claim.
	return row?.n ?? 0;
}

export async function countImages(input: ListImagesInput = {}, db: Db = openDb()): Promise<number> {
	return await countMedium("image", input, db);
}

export async function countSpeech(input: ListImagesInput = {}, db: Db = openDb()): Promise<number> {
	return await countMedium("speech", input, db);
}

/** How many completed images a prompt has produced in a workspace. Derived, not
 *  stored: prompt_library's mutable use_count is what made a regenerated image
 *  unrepresentable. Failed attempts do not count.
 *
 *  Image-scoped: this answers "how often has this image prompt been used", and it
 *  feeds an image surface. Speech shares the `prompt` column for its spoken text,
 *  so without the medium predicate a voiceover saying the same words as an image
 *  prompt would inflate the count. */
export async function promptUseCount(
	workspace: string,
	prompt: string,
	db: Db = openDb(),
): Promise<number> {
	const row = await db.get<{ n: number }>(
		`SELECT COUNT(*) AS n FROM image_ledger
		 WHERE medium = 'image' AND workspace = ? AND prompt = ? AND status = 'completed' AND deleted_at IS NULL`,
		[workspace, prompt.trim()],
	);
	// `COUNT(*)` without GROUP BY always returns exactly one row; no rows counted
	// is 0, not a missing row. The previous cast asserted the row non-null instead.
	return row?.n ?? 0;
}

export async function toggleStar(id: string, db: Db = openDb()): Promise<boolean> {
	const row = await db.get<{ starred: number }>(`SELECT starred FROM image_ledger WHERE id = ?`, [
		id,
	]);
	if (!row) return false;
	await db.run(`UPDATE image_ledger SET starred = ? WHERE id = ?`, [row.starred ? 0 : 1, id]);
	return true;
}

/* A hide, not a delete. The row is the artifact side of a metered, billed
 * generation; a per-tile affordance must not make that spend unattributable.
 * Permanent removal is an administrative operation against the store. */
export async function softDeleteImage(id: string, db: Db = openDb()): Promise<boolean> {
	const result = await db.run(
		`UPDATE image_ledger SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL`,
		[Date.now(), id],
	);
	return result.changes > 0;
}
