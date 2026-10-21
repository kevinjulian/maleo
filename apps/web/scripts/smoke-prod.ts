/* Does the deployable build actually run?
 *
 * Every other gate in this repo exercises the development bundle: `bun run
 * dev` and the visual suite's webServer both start the server without
 * NODE_ENV. So a production-only failure was invisible, and there was one —
 * the bundler emitted the automatic JSX transform's `jsxDEV` calls while
 * NODE_ENV=production made React resolve `react/jsx-dev-runtime` to its
 * production build, whose entire contents are `exports.jsxDEV = void 0`. The
 * app served a 200 and died at "loading…".
 *
 * That is why this asserts the app RENDERED rather than that the server
 * answered: a 200 was never the thing in doubt.
 *
 * The api is not required. Requests to it may fail and that is fine — this
 * checks that the client boots, not that it has data.
 *
 * Run: bun run smoke:prod
 */
import { chromium } from "@playwright/test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkProductIdentity } from "../../../scripts/check-release-hygiene.ts";

const PORT = Number(process.env.MALEO_SMOKE_PORT ?? 3032);
const ORIGIN = `http://127.0.0.1:${PORT}`;

const server = Bun.spawn(["bun", "src/app/serve.ts"], {
	cwd: new URL("..", import.meta.url).pathname,
	env: { ...process.env, NODE_ENV: "production", MALEO_WEB_PORT: String(PORT) },
	stdout: "pipe",
	stderr: "pipe",
});

async function waitForServer(timeoutMs = 60_000): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		try {
			const res = await fetch(ORIGIN, { signal: AbortSignal.timeout(2000) });
			if (res.ok) return;
		} catch {
			/* not up yet */
		}
		await Bun.sleep(300);
	}
	throw new Error(`production server did not answer on ${ORIGIN} within ${timeoutMs}ms`);
}

let failure: string | null = null;
try {
	await waitForServer();
	const browser = await chromium.launch();
	const page = await browser.newPage({ baseURL: ORIGIN });

	const errors: string[] = [];
	page.on("console", (m) => {
		if (m.type() === "error") errors.push(m.text());
	});
	page.on("pageerror", (e) => errors.push(String(e)));

	await page.goto("/", { waitUntil: "domcontentloaded" });
	// Auth may show the private sign-in screen when the api is unavailable.
	await page
		.locator(".sb-item, .signin-card")
		.first()
		.waitFor({ state: "visible", timeout: 30_000 })
		.catch(() => {
			throw new Error("the app never rendered — still on the boot placeholder");
		});

	/* A failed api call is expected here and is not a build problem. Anything
	 * else is: a module-level TypeError is exactly how the jsxDEV break showed. */
	const real = errors.filter((e) => !/Failed to load resource|502|ERR_CONNECTION/.test(e));
	if (real.length)
		throw new Error(`console errors in the production build:\n  ${real.join("\n  ")}`);
	const artifacts = mkdtempSync(join(tmpdir(), "maleo-served-identity-"));
	try {
		const urls = await page
			.locator('script[src], link[rel="stylesheet"]')
			.evaluateAll((nodes) =>
				nodes.map((node) => node.getAttribute("src") ?? node.getAttribute("href")!),
			);
		const files: string[] = [];
		for (const [index, href] of urls.entries()) {
			const url = new URL(href, ORIGIN);
			if (url.origin !== ORIGIN) continue;
			const response = await fetch(url);
			if (!response.ok) throw new Error("Served production artifact is unavailable");
			const name = `artifact-${index}.js`;
			writeFileSync(join(artifacts, name), await response.text());
			files.push(name);
		}
		if (!files.length) throw new Error("No production artifacts inspected");
		const findings = checkProductIdentity(artifacts, files);
		if (findings.length)
			throw new Error(`Production identity check failed: ${JSON.stringify(findings)}`);
	} finally {
		rmSync(artifacts, { recursive: true, force: true });
	}

	/* The PWA assets are served, not bundled — and the way that breaks is
	 * silent. An unregistered route falls through to the "/*" catch-all, which
	 * answers 200 with the SPA shell, so a status check passes while the
	 * manifest reports as invalid JSON and the worker is rejected on MIME type.
	 * Asserting the content type is what separates "served" from "answered". */
	for (const [path, expected] of [
		["/manifest.webmanifest", "application/manifest+json"],
		["/sw.js", "text/javascript"],
		["/maleo-favicon-32.png", "image/png"],
		["/maleo-apple-touch-180.png", "image/png"],
	] as const) {
		const res = await fetch(`${ORIGIN}${path}`);
		const type = res.headers.get("content-type") ?? "";
		if (!res.ok) throw new Error(`${path} returned ${res.status}`);
		if (!type.startsWith(expected)) {
			throw new Error(
				`${path} served as "${type}", expected "${expected}" — it is falling through to the SPA catch-all`,
			);
		}
	}

	/* The other half of the same rule: the catch-all must still answer client
	 * routes with the shell, or deep links break. */
	const spa = await fetch(`${ORIGIN}/content`);
	if (!(spa.headers.get("content-type") ?? "").startsWith("text/html")) {
		throw new Error("a client route no longer returns the SPA shell");
	}

	/* Installability, asserted rather than eyeballed.
	 *
	 * It is a conjunction — manifest, worker, icons — and it fails as a whole
	 * with no message saying which leg is missing. Checking the legs
	 * separately is the only way the failure names itself. */
	const manifestHref = await page.getAttribute('link[rel="manifest"]', "href");
	if (!manifestHref) throw new Error("no <link rel=manifest> in the served document");
	const manifest = await (await fetch(new URL(manifestHref, ORIGIN))).json();
	if (manifest.name !== "Maleo" || manifest.short_name !== "Maleo")
		throw new Error("Manifest must identify Maleo");
	if ((await page.title()) !== "Maleo") throw new Error("Browser title must identify Maleo");
	for (const rel of ["icon", "apple-touch-icon"]) {
		const href = await page.getAttribute(`link[rel="${rel}"]`, "href");
		if (!href) throw new Error(`Missing ${rel}`);
		const response = await fetch(new URL(href, ORIGIN));
		if (!response.ok || !response.headers.get("content-type")?.startsWith("image/png"))
			throw new Error(`Invalid ${rel} asset`);
	}

	for (const field of ["name", "start_url", "display", "icons"] as const) {
		if (!manifest[field]) throw new Error(`manifest is missing "${field}"`);
	}
	if (manifest.display !== "standalone") {
		throw new Error(`manifest display is "${manifest.display}", expected "standalone"`);
	}

	/* A scalable icon covers installer sizes; maskable keeps Android from
	 * masking an already-rounded tile a second time. */
	const sizes = new Set(manifest.icons.map((i: { sizes: string }) => i.sizes));
	for (const need of sizes.has("any") ? [] : ["192x192", "512x512"]) {
		if (!sizes.has(need)) throw new Error(`manifest has no ${need} icon`);
	}
	if (
		!manifest.icons.some((i: { purpose?: string }) => i.purpose?.split(/\s+/).includes("maskable"))
	) {
		throw new Error("manifest declares no maskable icon");
	}

	/* Every icon must actually be served — a manifest can reference a 404 and
	 * still parse, which is the failure this catches. */
	// SAFETY: fields are used only as strings for fetch/content-type checks.
	for (const icon of manifest.icons as Array<{ src: string; type?: string }>) {
		const res = await fetch(new URL(icon.src, ORIGIN));
		const type = res.headers.get("content-type") ?? "";
		if (!res.ok) throw new Error(`manifest icon ${icon.src} returned ${res.status}`);
		if (!type.startsWith(icon.type ?? "image/")) {
			throw new Error(`manifest icon ${icon.src} served as "${type}"`);
		}
	}

	/* Polled, not sampled once. Registration is deferred to the `load` event and
	 * then resolves asynchronously, while this page was navigated with
	 * `domcontentloaded` — so a single read races the thing it is measuring and
	 * reports "absent" for a worker that arrives a tick later. */
	const swRegistered = await page.evaluate(async () => {
		if (!("serviceWorker" in navigator)) return "unsupported";
		const deadline = Date.now() + 10_000;
		while (Date.now() < deadline) {
			if (await navigator.serviceWorker.getRegistration()) return "registered";
			await new Promise((r) => setTimeout(r, 100));
		}
		return "absent";
	});
	if (swRegistered !== "registered") {
		throw new Error(`service worker is "${swRegistered}" — the app is not installable`);
	}

	await browser.close();
	console.log("smoke:prod ok — production bundle boots, renders, and serves its PWA assets");
} catch (e) {
	failure = e instanceof Error ? e.message : String(e);
} finally {
	server.kill();
}

if (failure) {
	console.error(`smoke:prod FAILED — ${failure}`);
	process.exit(1);
}
