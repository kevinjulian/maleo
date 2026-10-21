/* Proof for tasks 4.3-4.5.
 *
 * The fail-closed case is the one that matters. `sandbox` is registered LAST and
 * fabricates output, so it wins precisely when everything above it is
 * unconfigured — which is the state an unreachable config service creates. A
 * source that failed open would turn an outage into fake media that is
 * indistinguishable from real at every layer downstream. */
import { afterEach, describe, expect, test } from "vite-plus/test";
import { setConfigSource, refreshConfig, resolveConfig } from "./config.ts";
import { ConfigServiceError, createHttpConfigSource } from "./http-config-source.ts";
import { kokoroBaseUrlFromEnv, KOKORO_URL_KEY } from "./kokoro/service.ts";

const BASE = "http://api.internal:8090";
const TOKEN = "service-token";

const saved = new Map<string, string | undefined>();
function setEnv(key: string, value: string | undefined): void {
	if (!saved.has(key)) saved.set(key, process.env[key]);
	if (value === undefined) delete process.env[key];
	else process.env[key] = value;
}

afterEach(() => {
	setConfigSource(null);
	for (const [key, value] of saved) setEnv(key, value);
	saved.clear();
});

function stubFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
	let calls = 0;
	const impl = (async (input: string | URL | Request, init?: RequestInit) => {
		calls += 1;
		return handler(String(input), init);
	}) as unknown as typeof fetch;
	return { impl, calls: () => calls };
}

function ok(values: Record<string, string>, errors?: Record<string, string>): Response {
	return new Response(JSON.stringify({ values, ...(errors ? { errors } : {}) }), {
		status: 200,
		headers: { "content-type": "application/json" },
	});
}

describe("fetching configuration", () => {
	test("a fetched value reaches a provider", async () => {
		setEnv(KOKORO_URL_KEY, undefined);
		const fetcher = stubFetch(() => ok({ [KOKORO_URL_KEY]: "http://fetched:8880" }));
		setConfigSource(
			createHttpConfigSource({ baseUrl: BASE, token: TOKEN, fetchImpl: fetcher.impl }),
		);

		await refreshConfig();
		expect(kokoroBaseUrlFromEnv()).toBe("http://fetched:8880");
	});

	test("presents the service token", async () => {
		let seenAuth: string | undefined;
		const fetcher = stubFetch((_url, init) => {
			seenAuth = new Headers(init?.headers).get("authorization") ?? undefined;
			return ok({});
		});
		setConfigSource(
			createHttpConfigSource({ baseUrl: BASE, token: TOKEN, fetchImpl: fetcher.impl }),
		);
		await refreshConfig();
		expect(seenAuth).toBe(`Bearer ${TOKEN}`);
	});

	test("calls the internal config endpoint", async () => {
		let seenUrl = "";
		const fetcher = stubFetch((url) => {
			seenUrl = url;
			return ok({});
		});
		setConfigSource(
			createHttpConfigSource({ baseUrl: `${BASE}/`, token: TOKEN, fetchImpl: fetcher.impl }),
		);
		await refreshConfig();
		expect(seenUrl).toBe(`${BASE}/internal/config`);
	});
});

describe("the cache is bounded", () => {
	test("one fetch serves repeated refreshes inside the TTL", async () => {
		const fetcher = stubFetch(() => ok({ [KOKORO_URL_KEY]: "http://a" }));
		let clock = 1000;
		setConfigSource(
			createHttpConfigSource({
				baseUrl: BASE,
				token: TOKEN,
				ttlMs: 30_000,
				fetchImpl: fetcher.impl,
				now: () => clock,
			}),
		);
		await refreshConfig();
		clock += 10_000;
		await refreshConfig();
		await refreshConfig();
		expect(fetcher.calls()).toBe(1);
	});

	// A rotated credential must land without redeploying the worker — the whole
	// reason configuration moved out of deploy-time environment variables.
	test("a changed value is observed after the TTL, with no restart", async () => {
		setEnv(KOKORO_URL_KEY, undefined);
		let value = "http://before";
		const fetcher = stubFetch(() => ok({ [KOKORO_URL_KEY]: value }));
		let clock = 1000;
		setConfigSource(
			createHttpConfigSource({
				baseUrl: BASE,
				token: TOKEN,
				ttlMs: 30_000,
				fetchImpl: fetcher.impl,
				now: () => clock,
			}),
		);

		await refreshConfig();
		expect(resolveConfig(KOKORO_URL_KEY)).toBe("http://before");

		value = "http://after";
		clock += 31_000;
		await refreshConfig();
		expect(resolveConfig(KOKORO_URL_KEY)).toBe("http://after");
		expect(fetcher.calls()).toBe(2);
	});
});

describe("it fails closed", () => {
	test("an unreachable service raises, naming the cause", async () => {
		const fetcher = stubFetch(() => {
			throw new Error("ECONNREFUSED");
		});
		setConfigSource(
			createHttpConfigSource({ baseUrl: BASE, token: TOKEN, fetchImpl: fetcher.impl }),
		);
		await expect(refreshConfig()).rejects.toThrow(ConfigServiceError);
		await expect(refreshConfig()).rejects.toThrow(/unreachable/);
	});

	test("a refusing service raises rather than resolving empty in silence", async () => {
		const fetcher = stubFetch(() => new Response("nope", { status: 401 }));
		setConfigSource(
			createHttpConfigSource({ baseUrl: BASE, token: TOKEN, fetchImpl: fetcher.impl }),
		);
		await expect(refreshConfig()).rejects.toThrow(/returned 401/);
	});

	test("nothing is resolved when the service never answered", async () => {
		setEnv(KOKORO_URL_KEY, undefined);
		const fetcher = stubFetch(() => {
			throw new Error("ECONNREFUSED");
		});
		setConfigSource(
			createHttpConfigSource({ baseUrl: BASE, token: TOKEN, fetchImpl: fetcher.impl }),
		);
		await refreshConfig().catch(() => undefined);
		// Unconfigured, which is what keeps a provider from running on nothing.
		expect(kokoroBaseUrlFromEnv()).toBeUndefined();
	});
});

describe("the environment is break-glass", () => {
	test("an environment value wins over the fetched one", async () => {
		setEnv(KOKORO_URL_KEY, "http://from-env:9000");
		const fetcher = stubFetch(() => ok({ [KOKORO_URL_KEY]: "http://fetched:8880" }));
		setConfigSource(
			createHttpConfigSource({ baseUrl: BASE, token: TOKEN, fetchImpl: fetcher.impl }),
		);
		await refreshConfig();
		expect(kokoroBaseUrlFromEnv()).toBe("http://from-env:9000");
	});

	// Recovering a deployment whose config service is down.
	test("the environment still resolves while the service is failing", async () => {
		setEnv(KOKORO_URL_KEY, "http://from-env:9000");
		const fetcher = stubFetch(() => {
			throw new Error("ECONNREFUSED");
		});
		setConfigSource(
			createHttpConfigSource({ baseUrl: BASE, token: TOKEN, fetchImpl: fetcher.impl }),
		);
		await refreshConfig().catch(() => undefined);
		expect(kokoroBaseUrlFromEnv()).toBe("http://from-env:9000");
	});
});
