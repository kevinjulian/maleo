import type { Context, MiddlewareHandler } from "hono";
import { activeCaller } from "../lib/active-workspace.ts";
import { INSTANCE_OWNER } from "@maleo/auth/config";

export function notInstanceOwnerRefusal(c: Context): Response | null {
	if (activeCaller(c).role === INSTANCE_OWNER) return null;
	return c.json(
		{ error: "not_instance_owner", message: "Only an instance owner can do this." },
		403,
	);
}

export function instanceOwnerOnly(): MiddlewareHandler {
	return async (c, next) => {
		const refusal = notInstanceOwnerRefusal(c);
		if (refusal) return refusal;
		await next();
	};
}
