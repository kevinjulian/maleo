/* The browser's single HTTP boundary.
 *
 * These two helpers exist because fifteen call sites bypassed the boundary: the
 * JSON helpers always set a JSON content-type (so uploads used raw `fetch`) and
 * had no way to say "absent is fine" (so the chat surface used raw `fetch` too).
 * Bypassing meant skipping `apiUrl()`, which is what resolves `API_BASE` — under
 * cross-origin mode those calls hit the web origin instead of the api. The tests
 * that matter here are the ones about origin and about what counts as absence. */
import { afterEach, beforeEach, describe, expect, test } from "vite-plus/test";
import { ApiError, getOrNull, postForm } from "./client.ts";

const realFetch = globalThis.fetch;

interface Call {
	url: string;
	init?: RequestInit;
}

let calls: Call[] = [];
let reply: () => Response;

function stubFetch(): void {
	globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
		calls.push({ url: String(input), init });
		return Promise.resolve(reply());
	}) as typeof fetch;
}

function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json" },
	});
}

beforeEach(() => {
	calls = [];
	reply = () => json({ ok: true });
	stubFetch();
});

afterEach(() => {
	globalThis.fetch = realFetch;
});

describe("postForm", () => {
	test("resolves the path through apiUrl rather than sending it raw", async () => {
		await postForm("/api/image-gen/upload", new FormData());

		// `apiUrl` is what applies API_BASE. With no base configured it returns the
		// path unchanged, so what this pins is that the helper went through it at
		// all — the raw-fetch callers did not, which is the defect being closed.
		expect(calls).toHaveLength(1);
		expect(calls[0]?.url).toBe("/api/image-gen/upload");
	});

	test("sends the form without a content-type so the browser sets the boundary", async () => {
		const form = new FormData();
		form.set("file", new Blob(["x"]), "x.png");
		await postForm("/api/image-gen/upload", form);

		const init = calls[0]?.init;
		expect(init?.method).toBe("POST");
		expect(init?.credentials).toBe("include");
		expect(init?.body).toBe(form);
		expect(init?.headers).toBeUndefined();
	});

	test("returns the parsed body", async () => {
		reply = () => json({ url: "/uploads/a.png" });
		expect(await postForm<{ url: string }>("/api/image-gen/upload", new FormData())).toEqual({
			url: "/uploads/a.png",
		});
	});

	test("throws an ApiError carrying the backend's message and status", async () => {
		reply = () => json({ error: "file too large" }, 413);

		const err = await postForm("/api/image-gen/upload", new FormData()).catch((e: unknown) => e);
		expect(err).toBeInstanceOf(ApiError);
		expect((err as ApiError).status).toBe(413);
		expect((err as ApiError).message).toContain("file too large");
	});

	test("falls back to the raw body when the error is not JSON", async () => {
		reply = () => new Response("gateway exploded", { status: 502 });

		const err = await postForm("/api/image-gen/upload", new FormData()).catch((e: unknown) => e);
		expect((err as ApiError).message).toContain("gateway exploded");
	});
});

describe("getOrNull", () => {
	test("returns the body when the resource exists", async () => {
		reply = () => json({ jobId: "j1" });
		expect(await getOrNull<{ jobId: string }>("/api/x/chat")).toEqual({ jobId: "j1" });
	});

	test("returns null on 404, which is the only status that means absent", async () => {
		reply = () => new Response("", { status: 404 });
		expect(await getOrNull("/api/x/chat")).toBeNull();
	});

	/* The behavior change this helper exists to make. `getCurrentChatJob` used to
	 * return null for ANY non-ok response, so a 500 while asking "is a run already
	 * in flight?" read as "nothing is running" — and the caller's next move is to
	 * start a second run. Absence and failure are now different answers. */
	test("throws on a server error instead of reporting absence", async () => {
		reply = () => json({ error: "db down" }, 500);

		const err = await getOrNull("/api/x/chat").catch((e: unknown) => e);
		expect(err).toBeInstanceOf(ApiError);
		expect((err as ApiError).status).toBe(500);
	});

	test("resolves the path through apiUrl", async () => {
		await getOrNull("/api/x/chat");
		expect(calls[0]?.url).toBe("/api/x/chat");
		expect(calls[0]?.init?.credentials).toBe("include");
	});
});

/* An expired session used to surface as a raw error mid-generation, because the
 * raw-fetch callers never checked for 401. Both helpers bounce to login like the
 * rest of the app. */
describe("an expired session bounces to login", () => {
	const realWindow = (globalThis as { window?: unknown }).window;
	let href = "";

	beforeEach(() => {
		href = "";
		(globalThis as { window?: unknown }).window = {
			location: {
				get href() {
					return href;
				},
				set href(v: string) {
					href = v;
				},
			},
		};
		reply = () => new Response("", { status: 401 });
	});

	afterEach(() => {
		if (realWindow === undefined) delete (globalThis as { window?: unknown }).window;
		else (globalThis as { window?: unknown }).window = realWindow;
	});

	test("postForm redirects", async () => {
		await postForm("/api/image-gen/upload", new FormData()).catch(() => undefined);
		expect(href).toBe("/login");
	});

	test("getOrNull redirects rather than reporting absence", async () => {
		await getOrNull("/api/x/chat").catch(() => undefined);
		expect(href).toBe("/login");
	});
});
