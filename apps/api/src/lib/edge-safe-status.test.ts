import { expect, test } from "vite-plus/test";
import { Hono } from "hono";
import { edgeSafeStatus } from "./edge-safe-status.ts";

const app = new Hono();
app.use("*", edgeSafeStatus());
app.get("/tts", (c) => c.json({ error: "kokoro: connect ECONNREFUSED" }, 502));
app.get("/slow", (c) => c.json({ error: "render timed out" }, 504));
app.get("/setup", (c) => c.json({ error: "TTS provider not configured" }, 503));
app.get("/ok", (c) => c.json({ ok: true }));

test("a provider failure keeps its message through a CDN that replaces 502/504 pages", async () => {
	for (const [path, original, error] of [
		["/tts", "502", "kokoro: connect ECONNREFUSED"],
		["/slow", "504", "render timed out"],
	] as const) {
		const response = await app.request(path);
		expect(response.status).toBe(503);
		expect(response.headers.get("x-upstream-status")).toBe(original);
		expect(await response.json()).toEqual({ error });
	}
});

test("other statuses pass through untouched", async () => {
	const setup = await app.request("/setup");
	expect(setup.status).toBe(503);
	expect(setup.headers.get("x-upstream-status")).toBeNull();
	expect((await app.request("/ok")).status).toBe(200);
});
