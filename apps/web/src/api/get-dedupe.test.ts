/* Concurrent GETs for the same URL share one request.
 *
 * Written against the real client rather than a copy of its logic, because the
 * thing being asserted is a property of the seam every read goes through — and
 * the failure it prevents (two surfaces, two identical requests) is invisible
 * from any one call site.
 */
import { afterEach, beforeEach, describe, expect, test } from "vite-plus/test";
import { get } from "./client.ts";

const realFetch = globalThis.fetch;
let calls: string[] = [];
let pending: Array<() => void> = [];
const releaseAll = (): void => {
	for (const r of pending) r();
	pending = [];
};

beforeEach(() => {
	calls = [];
	pending = [];
	globalThis.fetch = ((input: string | URL | Request) => {
		calls.push(
			String(typeof input === "string" ? input : input instanceof URL ? input.href : input.url),
		);
		return new Promise((resolve) => {
			pending.push(() =>
				resolve(
					new Response(JSON.stringify({ ok: true }), {
						status: 200,
						headers: { "content-type": "application/json" },
					}),
				),
			);
		});
	}) as typeof fetch;
});

afterEach(() => {
	globalThis.fetch = realFetch;
	pending = [];
});

describe("get coalescing", () => {
	test("two concurrent reads of one path make one request", async () => {
		const a = get<{ ok: boolean }>("/api/credits/balance");
		const b = get<{ ok: boolean }>("/api/credits/balance");
		releaseAll();
		expect(await a).toEqual({ ok: true });
		expect(await b).toEqual({ ok: true });
		expect(calls.length).toBe(1);
	});

	test("different paths are not shared", async () => {
		const a = get("/api/credits/balance");
		const b = get("/api/workspaces");
		releaseAll();
		await Promise.allSettled([a, b]);
		expect(calls.length).toBe(2);
	});

	test("a later read after the first settles is a fresh request — this is not a cache", async () => {
		const first = get("/api/workspaces");
		releaseAll();
		await first;
		const second = get("/api/workspaces");
		releaseAll();
		await second;
		expect(calls.length).toBe(2);
	});
});
