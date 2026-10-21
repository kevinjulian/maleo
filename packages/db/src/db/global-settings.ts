/* App-global settings — a small key/value table the media provider choice, the
 * default content preset, and the AI text provider choice all read.
 *
 * Was `workspace-settings.ts` against a `workspace_settings` table. The primary
 * key is `key` alone, with no workspace column: these settings are and always
 * were application-level. */
import { openDb } from "./connection.ts";
import type { Db } from "./handle.ts";

export const IMAGE_PROVIDER_SETTING = "media.provider.image";
/** The TTS provider choice, the twin of the image one. App-wide for the same
 *  reason: this table's primary key is `key` alone, so there is no workspace to
 *  scope it to and claiming otherwise would label it in the UI as something the
 *  schema cannot honour. */
export const TTS_PROVIDER_SETTING = "media.provider.tts";
/** Holds `{ "default": { providerId, model, thinking } }` — a per-task map with
 *  one entry, so per-task routing later needs no settings migration. */
export const TEXT_PROVIDER_SETTING = "ai.text.provider";

/* Reserved prefix for encrypted material — stored secrets and the wrapped data
 * key. This table is a bare key/value store shared with ordinary settings, so
 * without a namespace one careless listing returns every secret and nothing in
 * the code makes that mistake visible where it is written. `listGlobalSettings`
 * excludes it; direct `getGlobalSetting` on a namespaced key is how
 * `secret-store.ts` reaches its own rows, and is the only intended reader. */
export const SECRET_NAMESPACE = "secret.";

export function isSecretNamespaced(key: string): boolean {
	return key.startsWith(SECRET_NAMESPACE);
}

export async function getGlobalSetting(
	key: string,
	db: Db = openDb(),
): Promise<string | undefined> {
	const row = await db.get<{ value: string }>(`SELECT value FROM global_settings WHERE key = ?`, [
		key,
	]);
	return row?.value || undefined;
}

export async function setGlobalSetting(
	key: string,
	value: string | null,
	db: Db = openDb(),
): Promise<void> {
	const normalized = value?.trim() ?? "";
	if (!normalized) {
		await db.run(`DELETE FROM global_settings WHERE key = ?`, [key]);
		return;
	}
	await db.run(
		`INSERT INTO global_settings (key, value, updated_at) VALUES (?, ?, ?)
		 ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
		[key, normalized, Date.now()],
	);
}

/**
 * Every ordinary application setting.
 *
 * Encrypted material is excluded here rather than at each call site: a listing
 * that has to remember to filter is one that eventually forgets, and the value it
 * leaks is a credential.
 */
export async function listGlobalSettings(
	db: Db = openDb(),
): Promise<{ key: string; value: string }[]> {
	return await db.all<{ key: string; value: string }>(
		`SELECT key, value FROM global_settings WHERE key NOT LIKE ?1 || '%' ORDER BY key`,
		[SECRET_NAMESPACE],
	);
}

export async function getGlobalImageProvider(db: Db = openDb()): Promise<string | undefined> {
	return await getGlobalSetting(IMAGE_PROVIDER_SETTING, db);
}

export async function setGlobalImageProvider(
	providerId: string | null,
	db: Db = openDb(),
): Promise<void> {
	await setGlobalSetting(IMAGE_PROVIDER_SETTING, providerId, db);
}

export async function getGlobalTtsProvider(db: Db = openDb()): Promise<string | undefined> {
	return await getGlobalSetting(TTS_PROVIDER_SETTING, db);
}

export async function setGlobalTtsProvider(
	providerId: string | null,
	db: Db = openDb(),
): Promise<void> {
	await setGlobalSetting(TTS_PROVIDER_SETTING, providerId, db);
}
