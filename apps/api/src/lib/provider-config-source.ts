/* Teach provider layers where this process's configuration lives.
 *
 * The API is the process that holds the database, so here a provider's
 * configuration resolves `process.env` first and the stored settings second. A
 * host that installs nothing keeps reading the environment alone, which is what
 * the media worker does until it is given a config service to call.
 *
 * Text and media providers share one process-local source. */
import { refreshConfig, setConfigSource } from "@maleo/shared/provider-config";
import { listStoredConfigKeys } from "@maleo/db/config-resolution";
import { resolveDeclared } from "./declared-config.ts";
import { allDeclaredConfigKeys } from "./provider-catalog.ts";

/* Providers read configuration synchronously, deep inside a call; the stored
 * half now lives behind a network round trip. So the source holds a snapshot of
 * every declared key and reloads it at the async boundaries that already exist
 * — provider selection, and after any settings write — which keeps "a saved
 * setting takes effect without a restart" without a query per read. The
 * environment is still read live and still wins. */
export async function installProviderConfigSource(): Promise<void> {
	let snapshot: Record<string, string> = {};
	const load = async (): Promise<void> => {
		// Declared keys plus anything stored, so an undeclared stored key still resolves.
		const stored = (await listStoredConfigKeys()).map((key) => ({ key }));
		snapshot = (await resolveDeclared([...allDeclaredConfigKeys(), ...stored])).values;
	};
	await load();
	setConfigSource({
		resolve(key) {
			const fromEnv = process.env[key]?.trim();
			return fromEnv ? fromEnv : snapshot[key];
		},
		refresh: load,
	});
}

/** Reload the snapshot after configuration changed. */
export const refreshProviderConfig = refreshConfig;
