/* Single source of truth for the dashboard's own origin. Server-side helpers
 * build absolute urls (e.g. reference images handed to the image worker) from
 * relative paths; the worker validates fetches against the SAME origin via
 * MALEO_API_ORIGIN, so both sides must agree in container/remote
 * deployments — not just assume http://localhost:<PORT>. */

// Parse + validate an http(s) origin. Throws on anything else so a set-but-bad
// MALEO_API_ORIGIN fails loudly instead of silently diverging between the
// dashboard (which would build localhost urls) and the worker (which would reject
// them). Shared shape with the image worker's allowedRefOrigins().
export function normalizeHttpOrigin(raw: string): string {
	let u: URL;
	try {
		u = new URL(raw);
	} catch {
		throw new Error(`invalid origin (not a URL): ${raw}`);
	}
	if (u.protocol !== "http:" && u.protocol !== "https:")
		throw new Error(`origin must be http(s): ${raw}`);
	return u.origin;
}

// Normalized dashboard origin (scheme+host+port). Prefers MALEO_API_ORIGIN
// (trailing slash / path dropped; must be a valid http(s) origin); otherwise the
// local port.
export function dashboardOrigin(): string {
	const raw = process.env.MALEO_API_ORIGIN?.trim();
	if (raw) return normalizeHttpOrigin(raw); // fail-fast if set but invalid
	return `http://localhost:${process.env.MALEO_API_PORT ?? process.env.PORT ?? 3030}`;
}

// Prefix a relative path with the dashboard origin; absolute urls pass through.
export function absoluteDashboardUrl(u: string): string {
	return u.startsWith("http") ? u : `${dashboardOrigin()}${u}`;
}
