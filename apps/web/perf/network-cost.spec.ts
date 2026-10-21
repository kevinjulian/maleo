/* What the editor asks the network for, per clip.
 *
 * A timeline with thirty clips pointing at three files should not fetch thirty
 * times. This counts every request the editor makes while opening a project and
 * playing it, grouped by URL, so a duplicate is visible as a number rather than
 * as a hunch.
 *
 * Skipped unless `PROBE_PROJECT` names a project on the running dev server.
 */
import { test } from "@playwright/test";

const PROJECT = process.env.PROBE_PROJECT ?? "";
/* The app under test, defaulting to the suite's own server rather than the
 * developer's — a long-lived `--hot` process holds a stale module resolver and
 * will report a build failure for a file that exists. */
const ORIGIN = process.env.PROBE_ORIGIN ?? "http://127.0.0.1:3031";

test("what the editor fetches", async ({ page }) => {
	test.skip(!PROJECT, "set PROBE_PROJECT");
	test.setTimeout(120_000);
	const seen = new Map<string, { n: number; kinds: string[]; cache: string; bytes: number }>();
	page.on("request", (req) => {
		const url = req.url();
		if (url.startsWith("data:")) return;
		const type = req.resourceType();
		if (type === "document" || type === "script" || type === "stylesheet" || type === "font")
			return;
		const headers = req.headers();
		const kind = [type, headers.range ? "range" : "", headers.cookie ? "cookie" : ""]
			.filter(Boolean)
			.join("+");
		const row = seen.get(url) ?? { n: 0, kinds: [], cache: "-", bytes: 0 };
		row.n += 1;
		row.kinds.push(kind);
		seen.set(url, row);
	});
	page.on("response", (res) => {
		const row = seen.get(res.url());
		if (!row) return;
		if (row.cache === "-") row.cache = res.headers()["cache-control"] ?? "-";
		row.bytes += Number(res.headers()["content-length"] ?? 0);
	});
	/* Scripts and styles are excluded from the request counts above — they are
	   the app, not the project — but they are exactly what a phone on a tunnel
	   waits for, so their weight is tracked separately. */
	let appBytes = 0;
	page.on("response", (res) => {
		const type = res.request().resourceType();
		if (type === "script" || type === "stylesheet" || type === "document" || type === "font") {
			appBytes += Number(res.headers()["content-length"] ?? 0);
		}
	});

	if (process.env.PROBE_NO_PRELOAD === "1")
		await page.addInitScript("globalThis.__noPreload = true;");
	if (process.env.PROBE_STACKS === "1")
		await page.addInitScript(
			'{\n  const real = globalThis.fetch;\n  globalThis.__calls = [];\n  globalThis.fetch = (input, init) => {\n    const url = typeof input === "string" ? input : input.url;\n    if (/api\\/(operations\\/projects\\/[^/?]+($|\\?)|workspaces|credits)/.test(url)) {\n      globalThis.__calls.push({ url: url.slice(-48), stack: String(new Error().stack).split("\\n").slice(1, 7).join(" <- ") });\n    }\n    return real(input, init);\n  };\n}',
		);
	await page.setViewportSize({ width: 1440, height: 900 });
	await page.goto(`${ORIGIN}/content/${PROJECT}`);
	await page.locator(".tl2-timeline").waitFor({ state: "visible", timeout: 120_000 });
	await page.waitForTimeout(6000);
	await page.locator(".tl2-timeline [data-transport='play']").click();
	await page.waitForTimeout(5000);
	await page.locator(".tl2-timeline [data-transport='play']").click();

	/* Selecting a clip should cost nothing on the network: the document is
	 * already loaded and the media already mounted. Counted separately, with the
	 * urls named, so a refetch on click cannot hide inside the load total. */
	const clips = page.locator(
		"[data-vui-slot='row']:not([data-vui-row='scene']) [data-vui-slot='item']",
	);
	const flat = (): string[] =>
		[...seen.entries()].flatMap(([url, r]) => Array.from({ length: r.n }, () => url));
	let last = flat();
	const phases: Array<[string, () => Promise<void>]> = [
		[
			"click clip A",
			async () => {
				await clips.nth(0).click();
			},
		],
		[
			"click clip B",
			async () => {
				await clips.nth(1).click();
			},
		],
		[
			"click clip A again",
			async () => {
				await clips.nth(0).click();
			},
		],
		[
			"click an audio clip",
			async () => {
				await page.locator(".tl2-clip-audio").first().click();
			},
		],
	];
	for (const [label, run] of phases) {
		await run();
		await page.waitForTimeout(1200);
		const now = flat();
		const added = [...now];
		for (const url of last) {
			const at = added.indexOf(url);
			if (at >= 0) added.splice(at, 1);
		}
		console.log(`[click] ${label}: +${added.length} requests`);
		for (const url of added)
			console.log(`[click]     ${url.replace(/^https?:\/\//, "").slice(0, 78)}`);
		last = now;
	}

	if (process.env.PROBE_STACKS === "1") {
		const calls = await page.evaluate(
			() => (globalThis as { __calls?: Array<{ url: string; stack: string }> }).__calls ?? [],
		);
		for (const c of calls)
			console.log("[call] " + c.url + "\n        " + c.stack.replace(/https?:\/\/[^\s)]+\//g, ""));
	}
	const rows = [...seen.entries()].map(([url, r]) => ({ url, ...r })).sort((a, b) => b.n - a.n);
	const total = rows.reduce((sum, r) => sum + r.n, 0);
	const dupes = rows.filter((r) => r.n > 1);
	const byKind = new Map<string, number>();
	for (const r of rows) for (const k of r.kinds) byKind.set(k, (byKind.get(k) ?? 0) + 1);
	console.log(
		`[net] ${total} requests, ${rows.length} distinct urls, ${dupes.length} fetched more than once`,
	);
	const mb = (n: number): string => (n / 1024 / 1024).toFixed(2) + " MB";
	const weight = new Map<string, number>();
	for (const r of rows)
		for (const k of r.kinds) weight.set(k, (weight.get(k) ?? 0) + r.bytes / r.kinds.length);
	console.log(
		`[net] transferred: app ${mb(appBytes)}, project media ${mb(rows.reduce((sum, r) => sum + r.bytes, 0))}`,
	);
	console.log(
		`[net] by weight: ${[...weight.entries()]
			.sort((a, b) => b[1] - a[1])
			.map(([k, n]) => k + "=" + mb(n))
			.join(" ")}`,
	);
	console.log(
		`[net] heaviest: ${rows
			.slice()
			.sort((a, b) => b.bytes - a.bytes)
			.slice(0, 6)
			.map((r) => mb(r.bytes) + " " + r.url.split("/").slice(-1)[0]?.slice(0, 34))
			.join(" | ")}`,
	);
	console.log(
		`[net] by requester: ${[...byKind.entries()]
			.sort((a, b) => b[1] - a[1])
			.map(([k, n]) => k + "=" + n)
			.join(" ")}`,
	);
	for (const r of rows.slice(0, 14)) {
		console.log(
			`[net] x${String(r.n).padStart(3)} ${r.kinds.join(",").padEnd(28)} cache=${String(r.cache).padEnd(22)} ${r.url.replace(/^https?:\/\//, "").slice(0, 64)}`,
		);
	}
});
