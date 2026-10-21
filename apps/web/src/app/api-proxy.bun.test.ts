/* The proxy carries the session, or nothing works.
 *
 * Driven against a real upstream server rather than a stubbed `fetch`, because
 * the things under test are header and body plumbing — precisely what a stub
 * would model rather than exercise. */
import { createConnection } from "node:net";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { apiUpstreams, proxyToApi } from "./api-proxy.ts";

let upstream: ReturnType<typeof Bun.serve>;
let apiUrl = "";
/** What the upstream last received, so the forwarded side can be asserted. */
let seen: { cookie: string | null; forwardedFor: string | null; path: string; body: string } = {
	cookie: null,
	forwardedFor: null,
	path: "",
	body: "",
};

beforeAll(() => {
	upstream = Bun.serve({
		port: 0,
		fetch: async (req) => {
			const url = new URL(req.url);
			seen = {
				cookie: req.headers.get("cookie"),
				forwardedFor: req.headers.get("x-forwarded-for"),
				path: url.pathname + url.search,
				body: req.method === "GET" ? "" : await req.text(),
			};
			if (url.pathname === "/api/auth/sign-in/email") {
				return new Response(JSON.stringify({ ok: true }), {
					headers: {
						"content-type": "application/json",
						"set-cookie": "better-auth.session_token=abc123; Path=/; HttpOnly; SameSite=Lax",
					},
				});
			}
			if (url.pathname === "/api/redirects") {
				return new Response(null, { status: 302, headers: { location: "/elsewhere" } });
			}
			return new Response("upstream ok");
		},
	});
	apiUrl = `http://127.0.0.1:${upstream.port}`;
});

afterAll(() => upstream.stop(true));

const proxied = (path: string, init?: RequestInit, clientIp?: string): Promise<Response> =>
	proxyToApi(new Request(`http://web.local${path}`, init), {
		apiUrls: [apiUrl],
		clientIp: clientIp ?? null,
	});

describe("the session cookie survives the proxy", () => {
	test("a request's cookie reaches the API unchanged", async () => {
		await proxied("/api/projects", { headers: { cookie: "better-auth.session_token=abc123" } });

		expect(seen.cookie).toBe("better-auth.session_token=abc123");
	});

	test("the API's Set-Cookie reaches the browser unmodified", async () => {
		const response = await proxied("/api/auth/sign-in/email", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ email: "a@example.com", password: "x" }),
		});

		// Verbatim: an attribute dropped here (HttpOnly, SameSite) is a cookie
		// weakened in transit, and nothing downstream would notice.
		expect(response.headers.get("set-cookie")).toBe(
			"better-auth.session_token=abc123; Path=/; HttpOnly; SameSite=Lax",
		);
	});

	test("a media request carries the cookie too", async () => {
		await proxied("/uploads/clip.mp4", {
			headers: { cookie: "better-auth.session_token=abc123", range: "bytes=0-1023" },
		});

		// Without this the API refuses every media load once /uploads is gated.
		expect(seen.cookie).toBe("better-auth.session_token=abc123");
		expect(seen.path).toBe("/uploads/clip.mp4");
	});
});

describe("the client address is forwarded", () => {
	test("the connecting address is passed upstream", async () => {
		await proxied("/api/projects", {}, "198.51.100.4");

		// The API's sign-in limiter keys on this. Absent, every caller through the
		// proxy shares one bucket and one attacker locks out everyone.
		expect(seen.forwardedFor).toBe("198.51.100.4");
	});

	test("an existing chain is appended to, not replaced", async () => {
		await proxied(
			"/api/projects",
			{ headers: { "x-forwarded-for": "203.0.113.9" } },
			"198.51.100.4",
		);

		expect(seen.forwardedFor).toBe("203.0.113.9, 198.51.100.4");
	});
});

describe("the proxy relays rather than interprets", () => {
	test("the request body is forwarded", async () => {
		await proxied("/api/projects", { method: "POST", body: "payload" });

		expect(seen.body).toBe("payload");
	});

	test("the query string is preserved", async () => {
		await proxied("/api/projects?workspace=alpha&limit=2");

		expect(seen.path).toBe("/api/projects?workspace=alpha&limit=2");
	});

	test("a redirect is handed to the browser, not followed", async () => {
		const response = await proxied("/api/redirects");

		expect(response.status).toBe(302);
		expect(response.headers.get("location")).toBe("/elsewhere");
	});

	test("an unreachable API answers 503 rather than throwing", async () => {
		const response = await proxyToApi(new Request("http://web.local/api/projects"), {
			// Port 1 is reserved and nothing listens there.
			apiUrls: ["http://127.0.0.1:1"],
		});

		expect(response.status).toBe(503);
		expect(((await response.json()) as { error: string }).error).toBe("api_unreachable");
	});
});

describe("more than one API replica", () => {
	const replica = (name: string) => Bun.serve({ port: 0, fetch: () => new Response(name) });
	const dead = "http://127.0.0.1:1";

	test("requests take turns across the replicas", async () => {
		const [a, b] = [replica("a"), replica("b")];
		const next = apiUpstreams(`http://127.0.0.1:${a.port}, http://127.0.0.1:${b.port}/`);
		const answers: string[] = [];
		for (let i = 0; i < 4; i += 1) {
			answers.push(
				await (await proxyToApi(new Request("http://web.local/api/x"), { apiUrls: next() })).text(),
			);
		}
		expect(answers).toEqual(["a", "b", "a", "b"]);
		void a.stop(true);
		void b.stop(true);
	});

	test("a read that finds one replica down is answered by the other", async () => {
		const a = replica("a");
		const response = await proxyToApi(new Request("http://web.local/api/x"), {
			apiUrls: [dead, `http://127.0.0.1:${a.port}`],
		});
		/* Status and body together: CI once saw an empty body here (2026-10-08) and
		 * it has not reproduced since in 440 runs, so a repeat should say which
		 * answer it was rather than only that the text was missing. */
		expect({ status: response.status, body: await response.text() }).toEqual({
			status: 200,
			body: "a",
		});
		void a.stop(true);
	});

	test("a write is never sent twice: a replica that is down answers 503", async () => {
		let writes = 0;
		const a = Bun.serve({
			port: 0,
			fetch: () => {
				writes += 1;
				return new Response("a");
			},
		});
		const response = await proxyToApi(
			new Request("http://web.local/api/x", { method: "POST", body: "payload" }),
			{ apiUrls: [dead, `http://127.0.0.1:${a.port}`] },
		);
		expect(response.status).toBe(503);
		expect(writes).toBe(0);
		void a.stop(true);
	});

	test("one URL, the development default, still works", () => {
		expect(apiUpstreams("http://127.0.0.1:8090/")()).toEqual(["http://127.0.0.1:8090"]);
	});
});

describe("a client that hangs up mid-upload", () => {
	test("reaches the API as an aborted body, never as a shorter complete one", async () => {
		let outcome = "pending";
		const api = Bun.serve({
			port: 0,
			fetch: async (req) => {
				try {
					outcome = `complete:${(await req.arrayBuffer()).byteLength}`;
				} catch {
					outcome = "aborted";
				}
				return new Response("ok");
			},
		});
		const web = Bun.serve({
			port: 0,
			fetch: (req) => proxyToApi(req, { apiUrls: [`http://127.0.0.1:${api.port}`] }),
		});
		try {
			// A raw socket, because fetch cannot send part of a declared body and then disconnect the way a reloading tab does.
			const socket = createConnection({ host: "127.0.0.1", port: Number(web.port) });
			await new Promise<void>((resolve) => socket.once("connect", () => resolve()));
			socket.write(
				"POST /api/upload HTTP/1.1\r\nHost: web.local\r\nContent-Length: 1000000\r\n\r\n",
			);
			socket.write(new Uint8Array(64 * 1024));
			for (let i = 0; i < 100 && outcome === "pending"; i++) await Bun.sleep(10);
			socket.end();
			for (let i = 0; i < 300 && outcome === "pending"; i++) await Bun.sleep(10);
			expect(outcome).toBe("aborted");
		} finally {
			void web.stop(true);
			void api.stop(true);
		}
	});
});

describe("a write the API answers before reading its body", () => {
	test("does not corrupt the next request on the same kept-alive connection", async () => {
		const api = Bun.serve({
			port: 0,
			fetch: () => Response.json({ error: "unauthorized" }, { status: 401 }),
		});
		const web = Bun.serve({
			port: 0,
			fetch: (req) => proxyToApi(req, { apiUrls: [`http://127.0.0.1:${api.port}`] }),
		});
		try {
			const body = new Uint8Array(2 * 1024 * 1024);
			const statuses: number[] = [];
			// A race: the remainder only poisons a pooled connection some of the time, so send enough to see it.
			for (let i = 0; i < 30; i++) {
				/* The test's own client must not pool either. Bun's fetch has the same
				 * defect on this hop: under load it reused its socket to `web` with part of
				 * the last 2 MiB unsent, and `web` refused the next request with a 400
				 * before the proxy ran (3 of 14,400 requests; 0 with this). That failed
				 * the test for a hop it does not test. Still caught: dropping the proxy's
				 * own `keepalive = false` returns 400 for ~40% of these requests. */
				const response = await fetch(`http://127.0.0.1:${web.port}/api/upload`, {
					method: "POST",
					body,
					keepalive: false,
				});
				statuses.push(response.status);
				await response.arrayBuffer();
			}
			expect(statuses.filter((status) => status !== 401)).toEqual([]);
		} finally {
			void web.stop(true);
			void api.stop(true);
		}
	});
});
