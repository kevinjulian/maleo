import type { MiddlewareHandler } from "hono";

/* Cloudflare replaces any 502 or 504 an origin sends with its own branded
 * error page, so a route's JSON reason ("TTS provider refused the request")
 * never reaches the editor. Provider and upstream failures therefore leave the
 * API as 503, body unchanged, with the status the route chose recorded in
 * `x-upstream-status`. Routes keep returning the semantically accurate code. */
const EDGE_REPLACED = new Set([502, 504]);

export function edgeSafeStatus(): MiddlewareHandler {
	return async (c, next) => {
		await next();
		if (!EDGE_REPLACED.has(c.res.status)) return;
		const headers = new Headers(c.res.headers);
		headers.set("x-upstream-status", String(c.res.status));
		c.res = new Response(c.res.body, { status: 503, statusText: "Service Unavailable", headers });
	};
}
