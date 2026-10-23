import { pendingSourceKey, resolveMediaUrl } from "./pending-media-sources.ts";

// Resolving a path against the api origin is not a request. It is string work
// that pure modules do too, so it lives outside the fetch client.
// The api is a separate deployable. By default the web server reverse-proxies
// /api + /uploads to it, so the client stays same-origin and API_BASE is empty
// (URLs stay relative). Set MALEO_API_URL to target the api directly instead
// (no proxy); it is inlined into the bundle at build time.
// `process` is undefined in the browser bundle. Guard it: in the default proxy
// setup this stays empty (relative URLs); Bun inlines process.env at build time
// only for direct cross-origin mode, so read it defensively.
const envApiUrl =
	typeof process !== "undefined" && process.env ? process.env.MALEO_API_URL : undefined;
export const API_BASE = (envApiUrl ?? "").replace(/\/+$/, "");

// Resolve an api endpoint or asset path against the api origin. Absolute URLs
// and data URIs pass through untouched.
export function apiUrl(path: string): string {
	// A file still importing loads from wherever the session holds it (see pending-media-sources.ts).
	if (pendingSourceKey(path)) {
		const resolved = resolveMediaUrl(path);
		if (resolved !== path) return resolved && apiUrl(resolved);
	}
	if (/^([a-z]+:)?\/\//i.test(path) || path.startsWith("data:") || path.startsWith("blob:")) {
		return path;
	}
	return `${API_BASE}${path.startsWith("/") ? "" : "/"}${path}`;
}

// Media/download/navigation URLs used outside the fetch helpers (img src,
// anchor href, window.open) resolve the same way as api calls.
export const assetUrl = apiUrl;
