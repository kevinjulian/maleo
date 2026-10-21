/* One recorded clip, as the ledger returns it.
 *
 * Lives in models rather than beside the requests that fetch it, for the same
 * reason `LedgerImage` does: the filter model and the components describe clips
 * without making a request, and a model that reached up into `api/` would invert
 * the layering the whole app is arranged by.
 *
 * The same ledger row the image gallery reads, with the speech columns populated
 * and the image ones absent — `aspect` and `job_id` are not missing here, they
 * are attributes speech does not have. */

export const SPEECH_SOURCES = ["lab", "scene", "agent"] as const;

/** Which producer made the clip. No `reference`: there is no reference speech,
 *  and offering one would be a filter that always returns nothing. */
export type SpeechSource = (typeof SPEECH_SOURCES)[number];

export interface LedgerClip {
	id: string;
	workspace: string;
	project_id: string | null;
	project_title: string | null;
	source: SpeechSource;
	/** What was spoken. Shares the ledger's `prompt` column with an image prompt. */
	prompt: string | null;
	asset_url: string | null;
	voice: string | null;
	provider: string | null;
	duration_sec: number | null;
	starred: number;
	created_at: number;
}
