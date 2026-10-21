/* Resolving configuration in a process that does not hold the database.
 *
 * The media worker is a separate deployment with its own storage, and it is the
 * process that resolves and runs providers for durable generation. It fetches
 * resolved configuration from the API rather than reading its own environment
 * alone, which is what makes a credential entered in Settings reach the process
 * that actually generates.
 *
 * Three properties matter more than the fetching:
 *
 *   FAIL CLOSED     an unreachable service leaves the snapshot empty, so
 *                   providers report `unconfigured`. It must never look like a
 *                   provider that is merely idle: the registry's LAST provider
 *                   is `sandbox`, which fabricates output and wins exactly when
 *                   everything above it is unconfigured. Failing open here turns
 *                   an outage into fake media that is indistinguishable from real
 *                   at every layer downstream.
 *   BOUNDED CACHE   one fetch serves many reads, and a rotated credential is
 *                   picked up without restarting the worker.
 *   ENV WINS        break-glass. A value in the process environment beats the
 *                   fetched one, so a deployment stays recoverable while the
 *                   config service is down. */
import type { ConfigSource } from "@maleo/shared/provider-config";

export interface HttpConfigSourceOptions {
	/** Base URL of the API serving `/internal/config`. */
	baseUrl: string;
	/** The service token this process presents. */
	token: string;
	/** How long a snapshot is served before it is re-fetched. */
	ttlMs?: number;
	/** Injected in tests. */
	fetchImpl?: typeof fetch;
	now?: () => number;
}

const DEFAULT_TTL_MS = 30_000;
const REQUEST_TIMEOUT_MS = 10_000;

export class ConfigServiceError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "ConfigServiceError";
	}
}

/** The shape `/internal/config` answers with. */
interface ConfigResponse {
	values: ConfigValues;
	errors: ConfigValues;
}

/* A map of configuration key to value. Named rather than written inline as an
 * open dictionary so the two halves of the response share one contract. */
type ConfigValues = Record<string, string>;

/* Read field by field rather than declaring the body IS a ConfigResponse. The
 * response crosses a process boundary, and a malformed one must degrade to "no
 * configuration" — which fails closed — rather than throw inside a provider. */
function stringMap(value: unknown) {
	const out: ConfigValues = {};
	if (typeof value !== "object" || value === null) return out;
	for (const [key, entry] of Object.entries(value)) {
		if (typeof entry === "string") out[key] = entry;
	}
	return out;
}

function readResponse(body: unknown): ConfigResponse {
	if (typeof body !== "object" || body === null) return { values: {}, errors: {} };
	return {
		values: stringMap("values" in body ? body.values : undefined),
		errors: stringMap("errors" in body ? body.errors : undefined),
	};
}

export function createHttpConfigSource(options: HttpConfigSourceOptions): ConfigSource {
	const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
	const doFetch = options.fetchImpl ?? fetch;
	const now = options.now ?? Date.now;
	const url = `${options.baseUrl.replace(/\/+$/, "")}/internal/config`;

	let snapshot: ConfigValues = {};
	let fetchedAt = 0;
	let loaded = false;

	async function load(): Promise<void> {
		let res: Response;
		try {
			res = await doFetch(url, {
				headers: { authorization: `Bearer ${options.token}` },
				signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
			});
		} catch (error) {
			throw new ConfigServiceError(
				`configuration service at ${url} is unreachable: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
		if (!res.ok) {
			throw new ConfigServiceError(`configuration service at ${url} returned ${res.status}`);
		}
		const body = readResponse(await res.json().catch(() => null));
		snapshot = body.values;
		fetchedAt = now();
		loaded = true;

		/* A key the API could not decrypt is reported, not silently absent. The
		 * provider would otherwise look unconfigured and an operator would go
		 * re-enter a credential that is intact behind a changed master key. */
		const errors = Object.entries(body.errors);
		if (errors.length > 0) {
			console.error(
				`[config] the API could not read ${errors.length} stored value(s): ` +
					errors.map(([key, message]) => `${key}: ${message}`).join("; "),
			);
		}
	}

	return {
		resolve(key) {
			// Break-glass first: recoverable while the config service is down.
			const fromEnv = process.env[key]?.trim();
			if (fromEnv) return fromEnv;
			return snapshot[key];
		},

		async refresh() {
			if (loaded && now() - fetchedAt < ttlMs) return;
			await load();
		},
	};
}
