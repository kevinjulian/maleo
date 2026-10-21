/* How a provider obtains its configuration.
 *
 * Providers used to read `process.env` directly. That is the coupling which makes
 * configuration stored in a database impossible to honour anywhere except a
 * process that happens to hold that database — and the process that actually runs
 * durable generation, the media worker, is not that process. A credential entered
 * in Settings was invisible exactly where it was needed.
 *
 * So a host supplies a source, and providers read through it:
 *
 *   default        process.env                unchanged behavior
 *   API process    env > stored (@maleo/db)
 *   media worker   HTTP client to the API
 *
 * `packages/media` gains no dependency on storage or on `@maleo/db` — it holds
 * an interface, and each host supplies resolution it already has.
 *
 * NOT EXPORTED FROM THE PACKAGE BARREL, and must not be: `AsyncLocalStorage`
 * comes from `node:async_hooks`, `@maleo/shared`'s index is bundled into the web
 * client, and a browser reaching this module dies at import with
 * "import_node_async_hooks is not defined" — taking the whole page with it, which
 * is how this was found. Import it as `@maleo/shared/provider-config` from
 * server-side packages only. The browser has no business resolving provider
 * configuration anyway.
 *
 * READS ARE SYNCHRONOUS on purpose. Every provider's configuration read
 * (`readCredentials`, `kokoroBaseUrlFromEnv`, …) is a synchronous function called
 * from async code. Making resolution async would turn a seam into a rewrite of
 * every generation path. Instead a source keeps a snapshot, `refreshConfig()`
 * reloads it at the async boundaries that already exist, and providers read the
 * snapshot synchronously — the same split a config sidecar uses. */

import { AsyncLocalStorage } from "node:async_hooks";

/** Resolve one configuration key. Synchronous; served from the source's snapshot. */
export type ConfigResolver = (key: string) => string | undefined;

export interface ConfigSource {
	resolve: ConfigResolver;
	/* Reload the snapshot. Called at async boundaries — provider selection, and
	 * the start of a generation job — never per read. A source backed by the
	 * process environment has nothing to reload and omits this. */
	refresh?: () => Promise<void>;
}

/** Reads the process environment. What every host gets until it supplies otherwise. */
export const environmentConfigSource: ConfigSource = {
	resolve(key) {
		const value = process.env[key]?.trim();
		return value ? value : undefined;
	},
};

let active: ConfigSource = environmentConfigSource;

/**
 * Install the configuration source for this process.
 *
 * Passing null restores the environment source, which is what tests use to undo
 * an injection rather than leaving one installed for whatever runs next.
 */
export function setConfigSource(source: ConfigSource | null): void {
	active = source ?? environmentConfigSource;
}

export function getConfigSource(): ConfigSource {
	return active;
}

/* Candidate configuration, scoped to one async call.
 *
 * "Test this before I save it" needs a provider's health check to evaluate values
 * that are not stored yet. The alternatives were both bad: threading a config
 * argument through `health()` and every generation path (a rewrite, and every
 * caller then has to know how to obtain configuration), or swapping the module's
 * source around the call (a race — two operators testing at once would each see
 * the other's candidate).
 *
 * AsyncLocalStorage scopes the override to one async execution, so concurrent
 * tests cannot observe each other's values. */
const overrides = new AsyncLocalStorage<Readonly<Record<string, string>>>();

/**
 * Run `fn` with `values` taking precedence over the installed source.
 *
 * Only for evaluating candidate configuration. Nothing is persisted, and nothing
 * outside this call observes the values.
 */
export function withConfigOverride<T>(
	values: Readonly<Record<string, string>>,
	fn: () => Promise<T>,
): Promise<T> {
	return overrides.run(values, fn);
}

/** Resolve a configuration value. The one call providers make. */
export function resolveConfig(key: string): string | undefined {
	const candidate = overrides.getStore()?.[key]?.trim();
	if (candidate) return candidate;
	return active.resolve(key);
}

/**
 * Refresh the active source's snapshot.
 *
 * Deliberately swallows nothing: a source that cannot refresh must be able to say
 * so, because the caller's correct response is to report providers unconfigured
 * rather than to run them against stale or absent credentials.
 */
export async function refreshConfig(): Promise<void> {
	await active.refresh?.();
}
