/* Resolving one configuration value: environment first, stored second.
 *
 *   process.env  >  stored  >  unset
 *
 * The environment wins so a deployment configured entirely by environment
 * variables keeps working untouched, with no master key and no migration, and so
 * an operator keeps a way to override the database from outside it.
 *
 * That precedence creates one hazard, and it is the reason `shadowed` is part of
 * the result rather than something a caller works out: an operator sets a value in
 * the UI, an environment variable silently overrides it, the change has no
 * effect, and nothing explains why. Precedence that is implemented but not
 * reported is how that becomes a support question instead of a label.
 *
 * A field's key IS its environment variable name (`MALEO_KOKORO_URL`), so there
 * is one identifier per field and the shadowing check cannot drift from it. */
import { openDb } from "./connection.ts";
import type { Db } from "./handle.ts";
import { getGlobalSetting, SECRET_NAMESPACE, setGlobalSetting } from "./global-settings.ts";
import { getSecret, hasSecret, SecretStoreError } from "./secret-store.ts";

/** Prefix for stored non-secret configuration, kept clear of the secret one. */
export const CONFIG_NAMESPACE = "config.";

export type ConfigSource = "env" | "stored" | "unset";

export interface ResolvedConfig {
	value: string | undefined;
	source: ConfigSource;
	/** A value is stored for this key, but an environment variable overrides it. */
	shadowed: boolean;
	/** Set when a stored value exists and could not be read. */
	error?: string;
}

function envValue(key: string): string | undefined {
	const raw = process.env[key]?.trim();
	return raw ? raw : undefined;
}

export function configKey(key: string): string {
	return `${CONFIG_NAMESPACE}${key}`;
}

/**
 * Resolve a configuration value.
 *
 * `secret` selects the store: encrypted secrets are read through the secret
 * store, everything else from plain settings. An unreadable stored secret is
 * reported through `error` rather than as absent — presenting a key problem as an
 * unconfigured provider sends an operator to re-enter credentials that are intact.
 */
export async function resolveConfig(
	key: string,
	options: { secret?: boolean } = {},
	db: Db = openDb(),
): Promise<ResolvedConfig> {
	const fromEnv = envValue(key);

	let stored: string | undefined;
	let error: string | undefined;
	let storedExists = false;
	if (options.secret) {
		storedExists = await hasSecret(key, db);
		if (storedExists) {
			try {
				stored = await getSecret(key, db);
			} catch (caught) {
				error = caught instanceof SecretStoreError ? caught.message : String(caught);
			}
		}
	} else {
		stored = await getGlobalSetting(configKey(key), db);
		storedExists = stored != null;
	}

	if (fromEnv != null) {
		return { value: fromEnv, source: "env", shadowed: storedExists, error };
	}
	if (stored != null) return { value: stored, source: "stored", shadowed: false, error };
	return { value: undefined, source: "unset", shadowed: false, error };
}

/**
 * Resolve a key without being told which store it belongs to.
 *
 * The provider seam resolves by key name alone — it has no idea whether a value
 * is a credential — so this checks both. A key lives in one store or the other,
 * never both, so the order only decides which lookup runs first.
 *
 * An unreadable secret is NOT swallowed into "unset": it carries its error, so a
 * master key problem reaches the operator as a master key problem.
 */
export async function resolveAnyConfig(key: string, db: Db = openDb()): Promise<ResolvedConfig> {
	const asSecret = await resolveConfig(key, { secret: true }, db);
	if (asSecret.value != null || asSecret.error) return asSecret;
	return resolveConfig(key, {}, db);
}

/** Store a non-secret configuration value. Secrets go through `setSecret`. */
export async function setConfig(
	key: string,
	value: string | null,
	db: Db = openDb(),
): Promise<void> {
	await setGlobalSetting(configKey(key), value, db);
}

/** Every key among `keys` whose stored value an environment variable overrides. */
export async function shadowedConfigKeys(
	keys: readonly { key: string; secret?: boolean }[],
	db: Db = openDb(),
): Promise<string[]> {
	const resolved = await Promise.all(
		keys.map((k) => resolveConfig(k.key, { secret: k.secret }, db)),
	);
	return keys.filter((_, i) => resolved[i]!.shadowed).map((k) => k.key);
}

/** Every key with a stored value: plain configuration and secret names alike.
 *  A key need not be declared by a provider to be stored and resolved. */
export async function listStoredConfigKeys(db: Db = openDb()): Promise<string[]> {
	const rows = await db.all<{ key: string }>(
		`SELECT key FROM global_settings WHERE key LIKE ?1 || '%' OR (key LIKE ?2 || '%' AND key <> ?2 || '__envelope')`,
		[CONFIG_NAMESPACE, SECRET_NAMESPACE],
	);
	return rows.map((r) =>
		r.key.startsWith(CONFIG_NAMESPACE)
			? r.key.slice(CONFIG_NAMESPACE.length)
			: r.key.slice(SECRET_NAMESPACE.length),
	);
}
