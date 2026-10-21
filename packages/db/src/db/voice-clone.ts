/* Cloned TTS voices — a workspace's own voices, supplied as recordings.
 *
 * A clone's `id` is the voice identity everywhere a voice identity already
 * travels. Nothing here hands out the reference audio to a surface; only the
 * layer that resolves a voice for synthesis reads `refUrl`, and it does so once,
 * at the provider boundary.
 *
 * There is no update. Re-recording mints a new clone: the audio behind an id
 * never changes, because every cache entry and staleness hash naming that id
 * assumes exactly that.
 */
import { randomUUID } from "node:crypto";
import { openDb } from "./connection.ts";
import type { Db } from "./handle.ts";

export interface VoiceCloneRow {
	id: string;
	workspace: string;
	provider_id: string;
	label: string;
	lang: string;
	gender: "male" | "female" | null;
	ref_url: string;
	created_at: number;
	updated_at: number;
	deleted_at: number | null;
}

export interface VoiceClone {
	id: string;
	workspace: string;
	providerId: string;
	label: string;
	lang: string;
	gender: "male" | "female" | null;
	refUrl: string;
	createdAt: number;
	updatedAt: number;
}

function mapRow(row: VoiceCloneRow): VoiceClone {
	return {
		id: row.id,
		workspace: row.workspace,
		providerId: row.provider_id,
		label: row.label,
		lang: row.lang,
		gender: row.gender,
		refUrl: row.ref_url,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}

export interface CreateVoiceCloneInput {
	workspace: string;
	providerId: string;
	label: string;
	lang: string;
	gender?: "male" | "female" | null;
	refUrl: string;
}

/* `vc_` prefixed so a clone id is recognisable next to a provider's own speaker
 * id in a stored selection, a ledger row, or a log line. */
export async function createVoiceClone(
	input: CreateVoiceCloneInput,
	db: Db = openDb(),
): Promise<VoiceClone> {
	const id = `vc_${randomUUID().replaceAll("-", "").slice(0, 16)}`;
	const now = Date.now();
	await db.run(
		`INSERT INTO voice_clone (id, workspace, provider_id, label, lang, gender, ref_url, created_at, updated_at, deleted_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
		[
			id,
			input.workspace,
			input.providerId,
			input.label,
			input.lang,
			input.gender ?? null,
			input.refUrl,
			now,
			now,
		],
	);
	return {
		id,
		workspace: input.workspace,
		providerId: input.providerId,
		label: input.label,
		lang: input.lang,
		gender: input.gender ?? null,
		refUrl: input.refUrl,
		createdAt: now,
		updatedAt: now,
	};
}

/** A workspace's live clones for one provider, in catalogue (creation) order. */
export async function listVoiceClones(
	workspace: string,
	providerId: string,
	db: Db = openDb(),
): Promise<VoiceClone[]> {
	return (
		await db.all<VoiceCloneRow>(
			`SELECT * FROM voice_clone
			 WHERE workspace = ? AND provider_id = ? AND deleted_at IS NULL
			 ORDER BY created_at ASC, id ASC`,
			[workspace, providerId],
		)
	).map(mapRow);
}

/* A live clone, scoped to the workspace that owns it.
 *
 * The workspace is a PARAMETER, not something the caller checks after the fact:
 * a synthesis resolves a voice id that arrived from a request, and an id from
 * another workspace must read as absent rather than as a voice to speak with. */
export async function getVoiceClone(
	workspace: string,
	id: string,
	db: Db = openDb(),
): Promise<VoiceClone | null> {
	const row = await db.get<VoiceCloneRow>(
		`SELECT * FROM voice_clone WHERE workspace = ? AND id = ? AND deleted_at IS NULL`,
		[workspace, id],
	);
	return row ? mapRow(row) : null;
}

/* A clone regardless of its deleted state, for attributing a past synthesis.
 *
 * Separate from `getVoiceClone` on purpose: a listing or a synthesis must not
 * resurrect a removed voice, but a ledger row naming one still has to resolve to
 * the voice that produced it. */
export async function getVoiceCloneForAttribution(
	id: string,
	db: Db = openDb(),
): Promise<VoiceClone | null> {
	const row = await db.get<VoiceCloneRow>(`SELECT * FROM voice_clone WHERE id = ?`, [id]);
	return row ? mapRow(row) : null;
}

/** Hide a clone from every listing. Returns false when there was nothing live. */
export async function softDeleteVoiceClone(
	workspace: string,
	id: string,
	db: Db = openDb(),
): Promise<boolean> {
	const now = Date.now();
	/* `changes`, not a re-read: it distinguishes "there was a live clone and it is
	 * now hidden" from "there was nothing to hide" — which a post-hoc lookup
	 * cannot, since an already-deleted clone reads the same either way. */
	const result = await db.run(
		`UPDATE voice_clone SET deleted_at = ?, updated_at = ?
		 WHERE workspace = ? AND id = ? AND deleted_at IS NULL`,
		[now, now, workspace, id],
	);
	return result.changes > 0;
}
