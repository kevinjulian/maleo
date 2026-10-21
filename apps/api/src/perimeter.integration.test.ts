/* The perimeter as the network sees it.
 *
 * A real process, started the way a deployment starts it, probed over HTTP.
 * `perimeter.test.ts` asserts the exempt LIST; this asserts the DISPATCH —
 * whether `/uploads/*` really is checked before the file is read, and whether
 * `/api/inngest` really is reached without a session. Those are properties of
 * mounting order, and mounting order is exactly what a unit test of the list
 * cannot see.
 *
 * `index.ts` starts a server at import, so it is spawned rather than imported.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { setTimeout as sleep } from "node:timers/promises";
import { afterAll, beforeAll, describe, expect, test } from "vite-plus/test";
import { stopWithThisProcess } from "@maleo/db/pg-embedded";

const SERVICE_TOKEN = "test-service-token-value";
const PASSWORD = "correct-horse-battery-staple";

let proc: ChildProcess | undefined;
let base = "";
let dataDir = "";
let sessionCookie = "";

const url = (path: string): string => `${base}${path}`;

async function waitForHealth(timeoutMs = 30_000): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		try {
			const r = await fetch(url("/health"));
			if (r.ok) return;
		} catch {
			/* not listening yet */
		}
		await sleep(150);
	}
	throw new Error("api did not become healthy");
}

beforeAll(async () => {
	dataDir = mkdtempSync(join(tmpdir(), "maleo-perimeter-"));
	// A real file for the /uploads probe: the point of gating before
	// `resolveUploadFilePath` is that an EXISTING file is still refused.
	mkdirSync(join(dataDir, "public", "uploads"), { recursive: true });
	writeFileSync(join(dataDir, "public", "uploads", "secret.txt"), "classified");

	const port = 8100 + Math.floor(Math.random() * 400);
	base = `http://127.0.0.1:${port}`;
	// The server is the Bun program a deployment starts.
	proc = spawn("bun", [join(import.meta.dirname, "index.ts")], {
		cwd: dataDir,
		env: {
			...process.env,
			MALEO_DATA_DIR: dataDir,
			MALEO_DB_PATH: join(dataDir, "test.db"),
			MALEO_API_PORT: String(port),
			MALEO_SERVICE_TOKEN: SERVICE_TOKEN,
			NODE_ENV: "development",
		},
		stdio: "ignore",
	});
	if (proc.pid) stopWithThisProcess(proc.pid);
});

afterAll(() => {
	proc?.kill();
	rmSync(dataDir, { recursive: true, force: true });
});

/* Booting the API — a real process that starts its own throwaway database — can
 * take longer than a hook's fixed 5s under a parallel test run. So the boot is
 * waited on here, in a test with its own budget, rather than in beforeAll; the
 * tests after it run against a server that is already up. */
test("the API boots and the deployment can be claimed", async () => {
	await waitForHealth(60_000);

	// Claim the deployment, and keep the cookie for the authenticated probes.
	const signUp = await fetch(url("/api/auth/sign-up/email"), {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ email: "owner@example.com", password: PASSWORD, name: "Owner" }),
	});
	expect(signUp.status).toBe(200);
	sessionCookie = (signUp.headers.get("set-cookie") ?? "").split(";")[0]!;
	expect(sessionCookie).toContain("session_token");
}, 60_000);

describe("anonymous requests are refused by default", () => {
	test("a data route answers 401", async () => {
		const response = await fetch(url("/api/workspaces"));

		expect(response.status).toBe(401);
		expect(await response.json()).toEqual({ error: "unauthorized" });
	});

	test("the refusal clears the stale cookie", async () => {
		const response = await fetch(url("/api/workspaces"), {
			headers: { cookie: "better-auth.session_token=long-since-revoked" },
		});

		expect(response.status).toBe(401);
		// Left set, the browser presents a dead credential on every later request.
		expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
	});

	test("a route that does not exist answers 401, not 404", async () => {
		// Coverage runs before routing, so an anonymous prober cannot map the API
		// by reading which paths 404.
		const response = await fetch(url("/api/does-not-exist"));

		expect(response.status).toBe(401);
	});
});

describe("media files are behind the perimeter", () => {
	test("an anonymous request for an existing file is refused", async () => {
		const response = await fetch(url("/uploads/secret.txt"));

		expect(response.status).toBe(401);
		// The bytes are the thing being protected.
		expect(await response.text()).not.toContain("classified");
	});

	test("an anonymous range request is refused too", async () => {
		// The path a video player takes. Missing this would leave media readable
		// to anyone willing to send a Range header.
		const response = await fetch(url("/uploads/secret.txt"), {
			headers: { range: "bytes=0-4" },
		});

		expect(response.status).toBe(401);
	});

	test("a signed-in request is served, ranges included", async () => {
		const whole = await fetch(url("/uploads/secret.txt"), {
			headers: { cookie: sessionCookie },
		});
		const ranged = await fetch(url("/uploads/secret.txt"), {
			headers: { cookie: sessionCookie, range: "bytes=0-4" },
		});

		expect(whole.status).toBe(200);
		expect(await whole.text()).toBe("classified");
		// Still 206 with correct bytes: the gate must not have broken playback.
		expect(ranged.status).toBe(206);
		expect(await ranged.text()).toBe("class");
	});
});

describe("the durable execution boundary is not covered", () => {
	test("the sync endpoint answers a request with no session", async () => {
		const response = await fetch(url("/api/inngest"), { method: "PUT" });

		/* The assertion that matters is NOT the status — the Inngest SDK decides
		 * that, and it varies with signing configuration. It is that the answer
		 * came from the SDK at all rather than from our refusal. A 401 with this
		 * body means session middleware swallowed the sync, which is the silent
		 * outage this whole exemption exists to prevent. */
		const body = await response.text();
		expect(body).not.toBe(JSON.stringify({ error: "unauthorized" }));
	});

	test("the sync endpoint is reachable by GET without a session", async () => {
		const response = await fetch(url("/api/inngest"));

		expect(await response.text()).not.toBe(JSON.stringify({ error: "unauthorized" }));
	});
});

describe("the internal service boundary", () => {
	test("a valid service token with no session succeeds", async () => {
		const response = await fetch(url("/internal/config"), {
			headers: { authorization: `Bearer ${SERVICE_TOKEN}` },
		});

		expect(response.status).toBe(200);
		expect(await response.json()).toHaveProperty("values");
	});

	test("a browser session with no service token is refused", async () => {
		const response = await fetch(url("/internal/config"), {
			headers: { cookie: sessionCookie },
		});

		// An operator session must not be a way to read decrypted credentials.
		expect(response.status).toBe(401);
		expect(await response.json()).toMatchObject({ error: "unauthorized" });
	});

	test("a wrong service token is refused", async () => {
		const response = await fetch(url("/internal/config"), {
			headers: { authorization: "Bearer not-the-token" },
		});

		expect(response.status).toBe(401);
	});
});

describe("a misconfigured production deployment refuses to start", () => {
	test("no service token is a startup failure, not a runtime surprise", async () => {
		const dir = mkdtempSync(join(tmpdir(), "maleo-noservicetoken-"));
		const { MALEO_SERVICE_TOKEN: _dropped, ...withoutToken } = process.env;
		const child = spawn("bun", [join(import.meta.dirname, "index.ts")], {
			cwd: dir,
			env: {
				...withoutToken,
				MALEO_DATA_DIR: dir,
				MALEO_DB_PATH: join(dir, "test.db"),
				MALEO_API_PORT: String(8600 + Math.floor(Math.random() * 300)),
				NODE_ENV: "production",
				// Satisfied so the service-token guard is the one under test; the
				// Inngest client has its own production guard and throws at import.
				INNGEST_BASE_URL: "http://127.0.0.1:8288",
			},
			stdio: ["ignore", "ignore", "pipe"],
		});
		let stderr = "";
		child.stderr?.on("data", (chunk: Buffer) => (stderr += chunk));
		const [exitCode] = (await once(child, "close")) as [number | null];
		rmSync(dir, { recursive: true, force: true });

		expect(exitCode).not.toBe(0);
		// Naming the variable is the whole value: the alternative failure mode is
		// a worker failing jobs with credential errors that read as provider bugs.
		expect(stderr).toContain("MALEO_SERVICE_TOKEN");
		// The child imports the whole API before it reaches the guard, which outlasts
		// the default 5s under a parallel `bun run test`, so this one is given room.
	}, 30_000);
});

describe("the cross-origin allowlist is a credential boundary", () => {
	test("an unlisted origin is not granted access to a credentialed response", async () => {
		const response = await fetch(url("/api/workspaces"), {
			headers: { cookie: sessionCookie, origin: "https://evil.example" },
		});

		/* The session is valid, so the request itself succeeds — what must not
		 * happen is the browser being told it may READ the answer. With no
		 * allowlist configured this process trusts nothing, so the header is
		 * absent and the response is unreadable cross-origin. */
		expect(response.headers.get("access-control-allow-origin")).toBeNull();
	});

	test("a preflight is answered rather than refused", async () => {
		// The perimeter lets OPTIONS through on purpose: a preflight carries no
		// cookie, so refusing it would break every cross-origin request with a
		// CORS error that hides the real 401.
		const response = await fetch(url("/api/workspaces"), {
			method: "OPTIONS",
			headers: {
				origin: "https://evil.example",
				"access-control-request-method": "GET",
			},
		});

		expect(response.status).not.toBe(401);
		// Answered, but still not granted.
		expect(response.headers.get("access-control-allow-origin")).toBeNull();
	});
});

describe("signed-in requests pass", () => {
	test("a data route answers", async () => {
		const response = await fetch(url("/api/workspaces"), {
			headers: { cookie: sessionCookie },
		});

		expect(response.status).toBe(200);
	});

	test("liveness needs nothing", async () => {
		expect((await fetch(url("/health"))).status).toBe(200);
	});

	test("the sign-in screen can ask which screen it is", async () => {
		const response = await fetch(url("/api/auth-state"));

		expect(response.status).toBe(200);
		expect(await response.json()).toMatchObject({ hasAccounts: true });
	});
});
