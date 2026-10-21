// Standalone dev/preview server for the web client. Bundles the React app via
// Bun's HTML bundler in development and a split Bun.build in production; CSS
// enters through styles.css. Every client route serves the same SPA shell.
//
// The api is a separate deployable. In this server it is reached by reverse-
// proxying /api/* and /uploads/* to MALEO_API_URL, so the browser sees a single
// origin and every client URL can stay relative (XHR, <img src>, Remotion
// player). Persisted storyboards therefore keep relative asset URLs. For a
// direct cross-origin deployment (no proxy — e.g. a native client), set
// MALEO_API_URL in the client bundle instead and drop this proxy.
import index from "./index.html";
import { MAX_IMPORT_REQUEST_BYTES } from "@maleo/shared";
import { apiUpstreams, proxyToApi } from "./api-proxy.ts";
import { engineRoutes } from "./engine-routes.ts";
import tailwind from "bun-plugin-tailwind";

const PORT = parseInt(process.env.MALEO_WEB_PORT ?? "3030", 10) || 3030;
const STATIC_DIR = new URL("../../static/", import.meta.url).pathname;

/* Client-owned static assets, served from the web origin at their own paths.
 *
 * These are neither api resources nor bundle modules. The manifest is not a
 * module and the service worker is a second module graph, so Bun's HTML
 * bundler cannot emit either — see static/README.md.
 *
 * They must resolve BEFORE the "/*" catch-all. Falling through returns the SPA
 * shell with a 200 and an HTML content type, and both failures then read as
 * authoring bugs rather than routing bugs: the manifest reports as invalid
 * JSON, and the worker registration is rejected on MIME type.
 *
 * sw.js in particular has to stay at the origin root. A worker's default scope
 * is its own directory, so serving it from a subpath would scope it there and
 * need a Service-Worker-Allowed header to widen. */
const STATIC_ASSETS: Record<string, string> = {
	"/manifest.webmanifest": "application/manifest+json",
	"/sw.js": "text/javascript; charset=utf-8",
	"/maleo-logo.png": "image/png",
	"/maleo-favicon-32.png": "image/png",
	"/maleo-apple-touch-180.png": "image/png",
	"/maleo-icon-192.png": "image/png",
	"/maleo-icon-512.png": "image/png",
	"/maleo-maskable-512.png": "image/png",
	"/player-licenses.txt": "text/plain; charset=utf-8",
};

function staticRoutes(): Record<string, () => Response> {
	return Object.fromEntries(
		Object.entries(STATIC_ASSETS).map(([path, type]) => [
			path,
			() =>
				new Response(Bun.file(`${STATIC_DIR}${path.slice(1)}`), {
					headers: { "content-type": type },
				}),
		]),
	);
}
const HOST = process.env.MALEO_WEB_HOST?.trim() || "127.0.0.1";
/* MALEO_API_URLS lists every API replica; MALEO_API_URL, the single origin
 * other services read, is the fallback. */
const API_URLS =
	process.env.MALEO_API_URLS?.trim() || process.env.MALEO_API_URL || "http://127.0.0.1:8090";
const nextUpstreams = apiUpstreams(API_URLS);

/* Declared before `Bun.serve` so the route handlers can reach `server` without
 * the whole config inferring its own type circularly. */
const proxy = (req: Request): Promise<Response> =>
	proxyToApi(req, { apiUrls: nextUpstreams(), clientIp: server.requestIP(req)?.address ?? null });

// HTML runtime bundling folds import() into the entry. Production needs real chunks for optional destinations.
async function frontendRoutes(): Promise<
	Record<string, Response | Bun.HTMLBundle> & { "/*": Response | Bun.HTMLBundle }
> {
	if (process.env.NODE_ENV !== "production") return { "/*": index };
	const build = await Bun.build({
		entrypoints: [new URL("./index.html", import.meta.url).pathname],
		target: "browser",
		publicPath: "/",
		splitting: true,
		minify: true,
		plugins: [tailwind],
		define: { "process.env.NODE_ENV": JSON.stringify("production") },
	});
	if (!build.success) throw new AggregateError(build.logs, "Production frontend build failed");
	const routes: Record<string, Response> = {};
	for (const output of build.outputs) {
		const name = output.path.split("/").at(-1)!;
		routes[`/${name}`] = new Response(output, { headers: { "content-type": output.type } });
		if (output.kind === "entry-point" && name.endsWith(".html")) routes["/*"] = routes[`/${name}`]!;
	}
	if (!routes["/*"]) throw new Error("Production frontend build did not emit HTML");
	return { ...routes, "/*": routes["/*"] };
}

const server = Bun.serve({
	port: PORT,
	hostname: HOST,
	// SSE (activity stream) is long-lived; keep the proxy connection open.
	idleTimeout: 255,
	// The proxy must admit every upload the API accepts.
	maxRequestBodySize: MAX_IMPORT_REQUEST_BYTES,
	routes: {
		/* `server.requestIP` is why these are closures rather than bare
		 * references: the API's sign-in limiter keys on the client address, and
		 * only this hop knows it. See api-proxy.ts. */
		"/api/*": (req): Promise<Response> => proxy(req),
		"/uploads/*": (req): Promise<Response> => proxy(req),
		...staticRoutes(),
		...engineRoutes(),
		...(await frontendRoutes()),
	},
	/* `false`, not `{ hmr: false }`. An object here still selects the bundler's
	 * development mode, which emits the automatic JSX transform's `jsxDEV`
	 * calls — while NODE_ENV=production makes React resolve
	 * `react/jsx-dev-runtime` to its production build, whose entire contents
	 * are `exports.jsxDEV = void 0`. The two settings disagreed and the app
	 * died at "loading…" with `jsxDEV is not a function`. Nothing caught it
	 * because `bun run dev` and the visual suite both run without NODE_ENV.
	 *
	 * `MALEO_WEB_HMR=0` keeps development mode and drops hot reload, for the
	 * visual suite's server: nothing edits files under it, and the HMR client's
	 * `<bun-hmr>` overlay once covered a tab mid-run and failed a click
	 * (clip-animation-ux, 2026-10-08). */
	development:
		process.env.NODE_ENV === "production" ? false : { hmr: process.env.MALEO_WEB_HMR !== "0" },
});

console.log(`maleo-web listening on http://${server.hostname}:${server.port}`);
console.log(`proxying /api + /uploads -> ${API_URLS}`);
