/* Storyboard retention — which saved versions a project keeps.
 *
 * The durable agent loop persists the storyboard after every step, so history
 * grows at the rate the agent works. Unbounded, that was 7.3 GB of one database.
 * A project keeps:
 *
 *   - a window of its newest versions (the newest is the current version, so the
 *     current version is always kept and `MAX(version)` is always the highest
 *     number ever issued — which is what keeps numbering monotonic);
 *   - every version whose status is approved or rendered;
 *   - every version an output or a render record points at;
 *   - the newest carrier of each seedable artifact kind, because a run is seeded
 *     from those (`loadPriorArtifacts` walks history for them — an editor autosave
 *     carries no artifacts, so the head is often not a carrier).
 *
 * Everything else is pruned, inside the transaction that wrote the new version. */
import {
	documentArtifacts,
	readStoryboardDocument,
	seedableArtifactKind,
	type SeedableArtifactKind,
} from "@maleo/shared";
import type { Db } from "./handle.ts";
import { deleteCommandEntries } from "./project-commands.ts";

export const STORYBOARD_RETENTION_WINDOW_ENV = "MALEO_STORYBOARD_RETENTION_WINDOW";
/** Nothing in the product steps back through versions; the window exists so a
 *  recent mistake is recoverable by hand. Twenty covers one agent run's tail. */
export const DEFAULT_STORYBOARD_RETENTION_WINDOW = 20;
const PINNED_STATUSES: ReadonlySet<string> = new Set(["approved", "rendered"]);
/** SQLite's default bound-parameter ceiling is far above this; the chunk keeps
 *  a reclaim's single statement small. */
const DELETE_CHUNK = 500;

/** `window: null` disables pruning — the rollback lever. */
export interface StoryboardRetentionPolicy {
	readonly window: number | null;
}

/** Read from the environment: a positive integer, or `off`. Anything else is a
 *  configuration error, reported rather than guessed at — a typo must not turn
 *  retention off or shrink it to one version. */
export function storyboardRetentionPolicy(
	env: Record<string, string | undefined> = process.env,
): StoryboardRetentionPolicy {
	const raw = env[STORYBOARD_RETENTION_WINDOW_ENV]?.trim();
	if (!raw) return { window: DEFAULT_STORYBOARD_RETENTION_WINDOW };
	if (raw.toLowerCase() === "off") return { window: null };
	const n = Number(raw);
	if (!Number.isInteger(n) || n < 1) {
		throw new Error(
			`${STORYBOARD_RETENTION_WINDOW_ENV} must be a positive integer or "off", got "${raw}"`,
		);
	}
	return { window: n };
}

export interface RetentionRow {
	readonly id: string;
	readonly version: number;
	readonly status: string;
	/** An output or render record points at this version. */
	readonly referenced: boolean;
}

/** The ids a project may drop, given its versions newest-first.
 *
 *  A version outside the window is the newest carrier of a kind when no newer
 *  version carries that kind. `kindsOf` is called as little as that question
 *  allows: a candidate's own kinds first — an autosave carries none, so it drops
 *  on one read — and newer versions' kinds only until the candidate's are all
 *  found. Each version is read at most once. */
export async function prunableStoryboardIds(
	rowsNewestFirst: readonly RetentionRow[],
	window: number,
	kindsOf: (
		row: RetentionRow,
	) => readonly SeedableArtifactKind[] | Promise<readonly SeedableArtifactKind[]>,
): Promise<string[]> {
	const read = new Map<string, readonly SeedableArtifactKind[]>();
	const kinds = async (row: RetentionRow): Promise<readonly SeedableArtifactKind[]> => {
		const known = read.get(row.id);
		if (known) return known;
		const fresh = await kindsOf(row);
		read.set(row.id, fresh);
		return fresh;
	};
	/* `seenNewer` holds the kinds of rowsNewestFirst[0 .. scanned). */
	const seenNewer = new Set<SeedableArtifactKind>();
	let scanned = 0;
	const prunable: string[] = [];
	for (let index = window; index < rowsNewestFirst.length; index++) {
		const row = rowsNewestFirst[index]!;
		if (row.referenced || PINNED_STATUSES.has(row.status)) continue;
		const own = await kinds(row);
		while (scanned < index && own.some((kind) => !seenNewer.has(kind))) {
			for (const kind of await kinds(rowsNewestFirst[scanned]!)) seenNewer.add(kind);
			scanned++;
		}
		if (own.every((kind) => seenNewer.has(kind))) prunable.push(row.id);
	}
	return prunable;
}

async function retentionRows(db: Db, projectId: string): Promise<RetentionRow[]> {
	// CASE, not a bare EXISTS: Postgres returns a boolean where SQLite returns 1/0.
	return (
		await db.all<{ id: string; version: number; status: string; referenced: number }>(
			`SELECT s.id, s.version, s.status,
		   CASE WHEN EXISTS (SELECT 1 FROM content_project_outputs o WHERE o.storyboard_id = s.id)
		          OR EXISTS (SELECT 1 FROM content_renders r WHERE r.storyboard_id = s.id) THEN 1 ELSE 0 END AS referenced
		 FROM content_storyboards s
		 WHERE s.project_id = ?
		 ORDER BY s.version DESC`,
			[projectId],
		)
	).map((row) => ({ ...row, referenced: row.referenced === 1 }));
}

/** The seedable kinds one saved version carries.
 *
 *  Only the `artifacts` array is extracted, in the database, instead of decoding the
 *  whole document in JS on every write; it is then read through the document
 *  contract, which keeps `artifacts` at the root in every generation. A row whose
 *  text is not valid JSON carries nothing — the same answer the agent's own read
 *  of it gets. */
async function seedableKindsOf(db: Db, id: string): Promise<SeedableArtifactKind[]> {
	const artifactsExpr =
		db.dialect === "postgres"
			? "CASE WHEN storyboard_json IS JSON THEN (storyboard_json::jsonb -> 'artifacts')::text END"
			: "CASE WHEN json_valid(storyboard_json) THEN json_extract(storyboard_json, '$.artifacts') END";
	const row = await db.get<{ artifacts: string | null }>(
		`SELECT ${artifactsExpr} AS artifacts FROM content_storyboards WHERE id = ?`,
		[id],
	);
	if (!row?.artifacts) return [];
	let artifacts: unknown;
	try {
		artifacts = JSON.parse(row.artifacts);
	} catch {
		return [];
	}
	// Parsed the same way the agent seeds from them, so an artifact the agent would
	// not seed never pins a version.
	const kinds = documentArtifacts(readStoryboardDocument({ artifacts }).doc.artifacts).map(
		seedableArtifactKind,
	);
	return kinds.filter((kind): kind is SeedableArtifactKind => kind !== null);
}

/** What a project would drop under `window`, with the bytes it would free. */
export interface StoryboardPrunePlan {
	readonly ids: string[];
	readonly bytes: number;
}

export async function planStoryboardPrune(
	db: Db,
	projectId: string,
	window: number,
): Promise<StoryboardPrunePlan> {
	const ids = await prunableStoryboardIds(await retentionRows(db, projectId), window, (row) =>
		seedableKindsOf(db, row.id),
	);
	let bytes = 0;
	for (let i = 0; i < ids.length; i += DELETE_CHUNK) {
		const chunk = ids.slice(i, i + DELETE_CHUNK);
		const row = await db.get<{ bytes: number | null }>(
			`SELECT SUM(length(storyboard_json)) AS bytes FROM content_storyboards WHERE id IN (${chunk.map(() => "?").join(",")})`,
			chunk,
		);
		bytes += row?.bytes ?? 0;
	}
	return { ids, bytes };
}

export async function deleteStoryboardVersions(db: Db, ids: readonly string[]): Promise<number> {
	let deleted = 0;
	for (let i = 0; i < ids.length; i += DELETE_CHUNK) {
		const chunk = ids.slice(i, i + DELETE_CHUNK);
		deleted += (
			await db.run(
				`DELETE FROM content_storyboards WHERE id IN (${chunk.map(() => "?").join(",")})`,
				chunk,
			)
		).changes;
	}
	return deleted;
}

/** Enforce retention for one project. Callers run this inside the transaction
 *  that wrote the new version, so a failed write prunes nothing. A pruned
 *  version's command log entry goes with it. */
export async function pruneStoryboardVersions(
	db: Db,
	projectId: string,
	policy: StoryboardRetentionPolicy = storyboardRetentionPolicy(),
): Promise<number> {
	if (policy.window === null) return 0;
	const ids = await prunableStoryboardIds(
		await retentionRows(db, projectId),
		policy.window,
		(row) => seedableKindsOf(db, row.id),
	);
	await deleteCommandEntries(db, projectId, ids);
	return deleteStoryboardVersions(db, ids);
}
