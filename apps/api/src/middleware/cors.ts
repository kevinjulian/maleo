/* The web client runs on a separate origin, so CORS is always wired. The
 * allowlist (MALEO_API_CORS_ORIGINS) decides which origins are granted access;
 * an unlisted origin is rejected (origin callback returns null). */
import type { MiddlewareHandler } from "hono";
import { cors } from "hono/cors";

export function corsAllowlist(origins: readonly string[]): MiddlewareHandler {
	return cors({
		origin: (o) => (origins.includes(o) ? o : null),
		credentials: true,
	});
}

export function configuredCorsOrigins(): string[] {
	return (process.env.MALEO_API_CORS_ORIGINS ?? "")
		.split(",")
		.map((s) => s.trim())
		.filter(Boolean);
}
