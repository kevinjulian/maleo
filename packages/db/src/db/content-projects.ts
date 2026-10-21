/* Content projects — the row every other family hangs off, plus the list, feed,
 * create, patch and editor-state writes. The detail aggregate lives above this in
 * `project-detail.ts`, because it reads seven families. */
import { openDb } from "./connection.ts";
import type { Db } from "./handle.ts";
import { parseJsonValue, isJsonObjectOrNull } from "./row-json.ts";
import type {
	ContentProjectBrief,
	ContentProjectStatus,
	ContentProjectType,
} from "./content-types.ts";
import { projectFeedPreview, type ProjectFeedSort } from "@maleo/shared";

export interface ContentProjectRow {
	id: string;
	/** Tenant partition key. Resolves which reference_entity library the project
	 *  selects from. Pre-tenancy rows were backfilled to DEFAULT_CONTENT_WORKSPACE. */
	workspace: string;
	title: string;
	type: ContentProjectType;
	status: ContentProjectStatus;
	target_platform: string | null;
	target_audience: string | null;
	target_duration_sec: number | null;
	target_format: string | null;
	language: string | null;
	campaign_id: string | null;
	brief_json: ContentProjectBrief | null;
	reference_notes: string | null;
	/** Mutable, unversioned editor state (chat log, media library) kept OUT of the
	 *  versioned storyboard snapshot so it isn't duplicated/lost across versions. */
	editor_state_json: Record<string, unknown> | null;
	created_at: number;
	updated_at: number;
	storyboard_count?: number;
	reference_count?: number;
	render_count?: number;
	output_count?: number;
	latest_storyboard_id?: string | null;
	latest_storyboard_version?: number | null;
	latest_output_status?: string | null;
	latest_output_updated_at?: number | null;
	campaign_name?: string | null;
	thumbnail_url?: string | null;
	duration_sec?: number | null;
}

export const CONTENT_PROJECT_COUNT_COLS = `
	(SELECT COUNT(*) FROM content_storyboards s WHERE s.project_id = p.id) AS storyboard_count,
	(SELECT COUNT(*) FROM project_reference s WHERE s.project_id = p.id AND s.scene_key IS NULL) AS reference_count,
	(SELECT COUNT(*) FROM content_renders rr WHERE rr.project_id = p.id) AS render_count,
	(SELECT COUNT(*) FROM content_project_outputs o WHERE o.project_id = p.id) AS output_count,
	(SELECT s.id FROM content_storyboards s WHERE s.project_id = p.id ORDER BY s.version DESC LIMIT 1) AS latest_storyboard_id,
	(SELECT s.version FROM content_storyboards s WHERE s.project_id = p.id ORDER BY s.version DESC LIMIT 1) AS latest_storyboard_version,
	(SELECT o.status FROM content_project_outputs o WHERE o.project_id = p.id ORDER BY o.updated_at DESC, o.created_at DESC LIMIT 1) AS latest_output_status,
	(SELECT MAX(o.updated_at) FROM content_project_outputs o WHERE o.project_id = p.id) AS latest_output_updated_at`;

/** The row as SQLite returns it: the two JSON columns are still text, and
 *  `mapContentProjectRow` is what turns them into `ContentProjectRow`. Named
 *  because four call sites were spelling the same `Omit<…> & {…}` out longhand,
 *  three of them inside a `as` on the query result. */
export type StoredContentProjectRow = Omit<
	ContentProjectRow,
	"brief_json" | "editor_state_json"
> & {
	brief_json: string | null;
	editor_state_json: string | null;
};

export function mapContentProjectRow(
	row: Omit<StoredContentProjectRow, "editor_state_json"> & { editor_state_json?: string | null },
): ContentProjectRow {
	return {
		...row,
		brief_json: parseJsonValue<ContentProjectBrief | null>(row.brief_json, null),
		editor_state_json: parseJsonValue(row.editor_state_json ?? null, null, isJsonObjectOrNull),
	};
}

export async function listContentProjects(
	input?: {
		/** Tenant partition. Same contract as the feed below: absent means every
		 *  workspace, and every operator-facing caller passes one. */
		workspace?: string;
		type?: ContentProjectType;
		status?: ContentProjectStatus;
		campaign_id?: string;
		limit?: number;
		offset?: number;
	},
	db: Db = openDb(),
): Promise<ContentProjectRow[]> {
	const clauses: string[] = [];
	const params: Array<string | number> = [];
	if (input?.workspace) {
		clauses.push("p.workspace = ?");
		params.push(input.workspace);
	}
	if (input?.type) {
		clauses.push("p.type = ?");
		params.push(input.type);
	}
	if (input?.status) {
		clauses.push("p.status = ?");
		params.push(input.status);
	}
	if (input?.campaign_id) {
		clauses.push("p.campaign_id = ?");
		params.push(input.campaign_id);
	}
	const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
	const limit = Math.max(1, Math.min(input?.limit ?? 100, 500));
	const offset = Math.max(0, input?.offset ?? 0);
	const rows = await db.all<StoredContentProjectRow>(
		`SELECT
			p.*,
			${CONTENT_PROJECT_COUNT_COLS}
		 FROM content_projects p
		 ${where}
		 -- p.id breaks ties. Timestamps are millisecond integers, so two projects
		 -- touched in the same millisecond otherwise come back in whatever order the
		 -- scan produced — and with LIMIT/OFFSET that lets a tied row appear on two
		 -- pages or on none.
		 ORDER BY p.updated_at DESC, p.id DESC
		 LIMIT ? OFFSET ?`,
		[...params, limit, offset],
	);
	return rows.map(mapContentProjectRow);
}

export interface ContentFeedResult {
	items: ContentProjectRow[];
	total: number;
	facets: { platforms: string[] };
}

/**
 * Project-centric, server-paginated content feed. Unlike listContentProjects this
 * resolves the real total count (for pagination), supports a free-text search across
 * title / platform / notes / campaign name, and returns distinct platform facets so
 * the client can render complete filter dropdowns without fetching every row.
 */
export async function listContentFeed(
	input?: {
		/** Tenant partition. Absent means every workspace, which is what this did
		 *  before scoping existed — callers on the operator path always pass one. */
		workspace?: string;
		type?: ContentProjectType;
		status?: ContentProjectStatus;
		platform?: string;
		campaign_id?: string;
		search?: string;
		sort?: ProjectFeedSort;
		limit?: number;
		offset?: number;
	},
	db: Db = openDb(),
): Promise<ContentFeedResult> {
	const clauses: string[] = [];
	const params: Array<string | number> = [];
	if (input?.workspace) {
		clauses.push("p.workspace = ?");
		params.push(input.workspace);
	}
	if (input?.type) {
		clauses.push("p.type = ?");
		params.push(input.type);
	}
	if (input?.status) {
		clauses.push("p.status = ?");
		params.push(input.status);
	}
	if (input?.platform) {
		clauses.push("p.target_platform = ?");
		params.push(input.platform);
	}
	if (input?.campaign_id) {
		clauses.push("p.campaign_id = ?");
		params.push(input.campaign_id);
	}
	const search = input?.search?.trim();
	if (search) {
		const like = `%${search.toLowerCase()}%`;
		clauses.push(`(
			LOWER(p.title) LIKE ?
			OR LOWER(COALESCE(p.target_platform, '')) LIKE ?
			OR LOWER(COALESCE(p.reference_notes, '')) LIKE ?
			OR LOWER(COALESCE(c.name, '')) LIKE ?
		)`);
		params.push(like, like, like, like);
	}
	const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
	const totalRow = await db.get<{ n: number }>(
		`SELECT COUNT(*) AS n
		 FROM content_projects p
		 LEFT JOIN campaigns c ON c.id = p.campaign_id
		 ${where}`,
		params,
	);
	const limit = Math.max(1, Math.min(input?.limit ?? 20, 100));
	const offset = Math.max(0, input?.offset ?? 0);
	const modifiedOrder =
		"GREATEST(p.updated_at, COALESCE((SELECT MAX(o.updated_at) FROM content_project_outputs o WHERE o.project_id = p.id), 0))";
	const order =
		input?.sort === "name"
			? "LOWER(p.title) ASC, p.id ASC"
			: input?.sort === "name-desc"
				? "LOWER(p.title) DESC, p.id DESC"
				: input?.sort === "modified-asc"
					? `${modifiedOrder} ASC, p.id ASC`
					: `${modifiedOrder} DESC, p.id DESC`;
	const rows = await db.all<
		StoredContentProjectRow & {
			campaign_name: string | null;
			latest_storyboard_json: string | null;
		}
	>(
		`SELECT
			p.*,
			c.name AS campaign_name,
			(SELECT s.storyboard_json FROM content_storyboards s WHERE s.project_id = p.id ORDER BY s.version DESC LIMIT 1) AS latest_storyboard_json,
			${CONTENT_PROJECT_COUNT_COLS}
		 FROM content_projects p
		 LEFT JOIN campaigns c ON c.id = p.campaign_id
		 ${where}
		 -- Same tiebreaker as the list: stable paging needs a unique final key.
		 ORDER BY ${order}
		 LIMIT ? OFFSET ?`,
		[...params, limit, offset],
	);

	// Facets are scoped by workspace and content type so the dropdowns stay complete
	// regardless of the active status / platform / search filters. The workspace is
	// NOT one of the filters they stay complete across: a platform only another
	// tenant uses would be offered here and then match nothing.
	const facetClauses: string[] = [];
	const facetParams: Array<string | number> = [];
	if (input?.workspace) {
		facetClauses.push("p.workspace = ?");
		facetParams.push(input.workspace);
	}
	if (input?.type) {
		facetClauses.push("p.type = ?");
		facetParams.push(input.type);
	}
	facetClauses.push("p.target_platform IS NOT NULL AND TRIM(p.target_platform) <> ''");
	const platformRows = await db.all<{ value: string }>(
		`SELECT DISTINCT p.target_platform AS value
		 FROM content_projects p
		 WHERE ${facetClauses.join(" AND ")}
		 ORDER BY value`,
		facetParams,
	);

	return {
		items: rows.map(({ latest_storyboard_json, ...row }) => ({
			...mapContentProjectRow(row),
			...projectFeedPreview(parseJsonValue<unknown>(latest_storyboard_json, null), row.type),
		})),
		// COUNT(*) with no GROUP BY returns exactly one row, so the old `as
		// { n: number }` was true and just never stated. `?? 0` states it.
		total: totalRow?.n ?? 0,
		facets: {
			platforms: platformRows.map((row) => row.value),
		},
	};
}

/** How much work each workspace holds, as a name→count map.
 *
 *  Grouped in one query rather than counted per workspace by the caller: the
 *  switcher renders every workspace at once, so a per-row count would be N
 *  queries to draw one menu. Workspaces owning nothing are absent from the map
 *  (there is no row to group), so callers default to 0. */
export async function countContentProjectsByWorkspace(
	db: Db = openDb(),
): Promise<Record<string, number>> {
	const rows = await db.all<{ workspace: string; n: number }>(
		`SELECT workspace, COUNT(*) AS n FROM content_projects GROUP BY workspace`,
	);
	const out: Record<string, number> = {};
	for (const row of rows) out[row.workspace] = row.n;
	return out;
}
