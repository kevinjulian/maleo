/* The image lab's vocabulary: what the service reports, what a generation
 * looks like while it runs, and the history it is replayed from.
 */

export interface Health {
	configured: boolean;
	ok: boolean;
	browser_alive?: boolean;
	queue_depth?: number;
	uptime_s?: number;
	error?: string;
}

export interface JobResult {
	/** "queued", "running", "done" or "failed"; open on the wire. */
	status: string;
	image_url?: string;
	error?: string;
}

export interface ChatMessage {
	id: string;
	prompt: string;
	image_url: string | null;
	status: "generating" | "done" | "failed";
	error?: string;
	elapsed?: number;
	aspect: string;
	workspace: string;
	created_at: number;
}

/* One recorded image, as the ledger returns it.
 *
 * Replaces PromptEntry, which mirrored prompt_library: one row per PROMPT with a
 * numeric id and a mutable `use_count`. Regenerating a prompt overwrote its
 * image_url there, so two generations collapsed into one feed entry. */
export interface LedgerImage {
	id: string;
	workspace: string;
	project_id: string | null;
	source: "lab" | "clip" | "reference" | "agent";
	prompt: string | null;
	/** Named for the artifact, not the medium: the ledger behind this records
	 *  speech as well, and one column locates both. */
	asset_url: string | null;
	aspect: string | null;
	/** 1 when recovered from a pre-ledger record; such a row has no prompt and its
	 *  timestamp is an approximation. */
	backfilled: number;
	starred: number;
	created_at: number;
	/** Joined server-side. Null for an image with no project, and also for one
	 *  whose project was deleted — the image outlives it. */
	project_title?: string | null;
}

export type Aspect = "1:1" | "16:9" | "9:16";

export const ASPECTS: readonly Aspect[] = ["1:1", "16:9", "9:16"];

/** References are sent as absolute URLs; the service fetches them itself. */
export const MAX_REFS = 4;

export const absUrl = (src: string): string =>
	src.startsWith("http") ? src : `${window.location.origin}${src}`;

/* Unknown health is muted rather than red: "not checked yet" and "down" are
 * different answers, and only one of them is the operator's problem. */
export function healthDotColor(health: Health | null): string {
	if (!health) return "var(--muted)";
	return !health.configured || !health.ok ? "var(--err)" : "var(--ok)";
}

export function canGenerate(input: {
	health: Health | null;
	workspace: string;
	prompt: string;
	busy: boolean;
}): boolean {
	return (
		!input.busy &&
		input.prompt.trim().length > 0 &&
		input.health?.ok === true &&
		input.workspace.length > 0
	);
}

/* History arrives newest-first; the feed shows oldest-first.
 *
 * The url filter stays because a backfilled row can carry none. What is gone is
 * the assumption that one entry means one prompt: two generations of the same
 * prompt are two rows and become two feed entries. */
export function historyToMessages(entries: LedgerImage[], workspace: string): ChatMessage[] {
	return entries
		.filter((e) => e.asset_url)
		.map((e) => ({
			id: e.id,
			prompt: e.prompt ?? "",
			image_url: e.asset_url,
			status: "done" as const,
			aspect: "1:1",
			workspace,
			created_at: e.created_at,
		}))
		.reverse();
}

export function toggleReference(selected: string[], id: string): string[] {
	if (selected.includes(id)) return selected.filter((x) => x !== id);
	return selected.length >= MAX_REFS ? selected : [...selected, id];
}
