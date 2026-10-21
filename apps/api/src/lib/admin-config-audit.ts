import type { MiddlewareHandler } from "hono";
import { recordAdminAudit } from "@maleo/db/admin-audit";
import { activeCaller } from "./active-workspace.ts";

const READS = new Set(["GET", "HEAD", "OPTIONS"]);

/* Setting names a request body touches, never their values. Config bodies are
 * one level deep (`{ updates: { KEY: value } }`, `{ values: { key: value } }`),
 * so nested objects contribute `parent.key`. */
export function settingNames(body: unknown): string[] {
	if (!body || typeof body !== "object" || Array.isArray(body)) return [];
	return Object.entries(body).flatMap(([key, value]: [string, unknown]) =>
		value && typeof value === "object" && !Array.isArray(value)
			? Object.keys(value).map((inner) => `${key}.${inner}`)
			: [key],
	);
}

export function auditConfigMutation(): MiddlewareHandler {
	return async (c, next) => {
		if (READS.has(c.req.method)) return next();
		const json = c.req.header("content-type")?.includes("application/json") ?? false;
		const names = json
			? settingNames(
					await c.req.raw
						.clone()
						.json()
						.catch(() => null),
				)
			: [];
		await next();
		const path = new URL(c.req.url).pathname;
		const ok = c.res.status >= 200 && c.res.status < 300;
		try {
			await recordAdminAudit({
				actor_id: activeCaller(c).userId,
				action: `config.${c.req.method.toLowerCase()}`,
				target_type: "setting",
				target_id: names.length ? `${path}:${names.join(",")}` : path,
				outcome: ok ? "success" : "refused",
				reason: ok ? null : String(c.res.status),
			});
		} catch (error) {
			/* The change already happened (some settings are file-backed, outside any
			 * transaction). Report the real outcome and flag the missing record
			 * rather than turning a completed write into a 500. */
			console.error(
				`[admin-audit] failed to record ${c.req.method} ${path}: ${error instanceof Error ? error.message : String(error)}`,
			);
			c.res.headers.set("x-maleo-audit", "failed");
		}
	};
}
