import type { Context, MiddlewareHandler } from "hono";

export function getToken(): string {
	const t = process.env.MALEO_VIDEO_TOKEN;
	if (!t) throw new Error("MALEO_VIDEO_TOKEN env var not set");
	return t;
}

export const bearerAuth: MiddlewareHandler = async (c: Context, next) => {
	if (c.req.path === "/health") return next();
	const header = c.req.header("authorization") ?? "";
	const expected = `Bearer ${getToken()}`;
	if (header !== expected) {
		return c.json({ error: "unauthorized" }, 401);
	}
	return next();
};
