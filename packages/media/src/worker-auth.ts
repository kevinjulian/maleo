import { timingSafeEqual } from "node:crypto";
import type { MiddlewareHandler } from "hono";

export const requireMediaService: MiddlewareHandler = async (c, next) => {
	const expected = process.env.MALEO_SERVICE_TOKEN?.trim();
	const presented = c.req.header("authorization")?.match(/^Bearer (.+)$/)?.[1];
	if (
		!expected ||
		!presented ||
		Buffer.byteLength(expected) !== Buffer.byteLength(presented) ||
		!timingSafeEqual(Buffer.from(expected), Buffer.from(presented))
	)
		return c.json({ error: "unauthorized" }, 401);
	return next();
};
