import type { Context } from "hono";

export interface PageParams {
	limit: number;
	offset: number;
}

export function parsePage(c: Context, defaults: { limit?: number; max?: number } = {}): PageParams {
	const def = defaults.limit ?? 30;
	const max = defaults.max ?? 500;
	const limit = Math.max(
		1,
		Math.min(max, parseInt(c.req.query("limit") ?? String(def), 10) || def),
	);
	const offset = Math.max(0, parseInt(c.req.query("offset") ?? "0", 10) || 0);
	return { limit, offset };
}

export interface PageEnvelope<T> {
	items: T[];
	total: number;
	limit: number;
	offset: number;
	has_more: boolean;
	next_offset: number | null;
}

export function envelope<T>(items: T[], total: number, page: PageParams): PageEnvelope<T> {
	const consumed = page.offset + items.length;
	return {
		items,
		total,
		limit: page.limit,
		offset: page.offset,
		has_more: consumed < total,
		next_offset: consumed < total ? consumed : null,
	};
}
