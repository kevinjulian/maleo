import { z } from "zod";
import type { ClipLayout } from "./timeline-model.ts";
import { sourceInterval, sceneVisualSourceDuration } from "./source-interval.ts";

const managedUrl = z.string().regex(/^\/api\/media\/[0-9a-f-]{36}$/);
/** A finished immutable derivative, covering an interval in the original file. */
export const reverseMediaSchema = z
	.object({
		url: managedUrl,
		sourceUrl: managedUrl,
		sourceRevision: z.string().min(1).max(160),
		startSec: z.number().finite().min(0),
		durationSec: z.number().finite().positive().max(1800),
	})
	.strict();
export type ReverseMedia = z.infer<typeof reverseMediaSchema>;

/** Trimming inside a derivative reuses it; extending or replacing needs new work. */
export function reversePlaybackSource(
	url: string,
	start: number,
	duration: number,
	layout?: Partial<ClipLayout>,
) {
	if (!layout?.reverse) return { url, mediaStartSec: start };
	const result = reverseMediaSchema.safeParse(layout.reverseMedia);
	if (!result.success || result.data.sourceUrl !== url) return undefined;
	const derivative = result.data;
	let interval: { start: number; end: number };
	try {
		interval = sourceInterval(start, duration, layout.playbackRate ?? 1);
	} catch {
		return undefined;
	}
	const end = derivative.startSec + derivative.durationSec;
	if (interval.start < derivative.startSec - 0.000001 || interval.end > end + 0.000001)
		return undefined;
	return { url: derivative.url, mediaStartSec: Math.max(0, end - interval.end) };
}

/** Used by both export boundaries; never accepts a serialized reverse flag alone. */
export function reverseMediaBlockers(input: unknown): string[] {
	const blockers: string[] = [];
	const object = z.record(z.unknown());
	const layoutSchema = z.object({
		reverse: z.boolean().optional(),
		playbackRate: z.number().optional(),
		reverseMedia: reverseMediaSchema.optional(),
	});
	const visit = (value: unknown, inherited?: unknown, inheritedDuration?: number): void => {
		if (Array.isArray(value)) {
			value.forEach((item) => {
				const single = object.safeParse(item);
				const local = single.success ? object.safeParse(single.data.layout) : undefined,
					parent = object.safeParse(inherited);
				const layout = {
					...(parent.success ? parent.data : {}),
					...(local?.success ? local.data : {}),
				};
				visit(
					value.length === 1 &&
						inheritedDuration != null &&
						single.success &&
						!(typeof single.data.startSec === "number" && single.data.startSec > 0)
						? {
								...single.data,
								durationSec: sceneVisualSourceDuration(
									typeof single.data.durationSec === "number"
										? single.data.durationSec
										: inheritedDuration,
									inheritedDuration,
									layout,
								),
							}
						: item,
					inherited,
					inheritedDuration,
				);
			});
			return;
		}
		const record = object.safeParse(value);
		if (!record.success) return;
		const row = record.data;
		const parent = object.safeParse(inherited),
			local = object.safeParse(row.layout);
		const merged = { ...(parent.success ? parent.data : {}), ...(local.success ? local.data : {}) };
		const duration =
			typeof row.durationSec === "number"
				? row.durationSec
				: typeof row.dur === "number"
					? row.dur
					: inheritedDuration;
		if (typeof row.url === "string" && merged.reverse === true && row.kind !== "image") {
			const layout = layoutSchema.safeParse(merged);
			if (
				!layout.success ||
				duration == null ||
				!reversePlaybackSource(
					row.url,
					typeof row.mediaStartSec === "number" ? row.mediaStartSec : 0,
					duration,
					layout.data,
				)
			)
				blockers.push(
					`${typeof row.label === "string" ? row.label : "Video clip"}: reverse source is unavailable or changed. Process this source range again before export.`,
				);
		}
		for (const [key, child] of Object.entries(row)) {
			if (key === "layout") continue;
			visit(
				child,
				key === "visualClips" ? merged : undefined,
				key === "visualClips" ? duration : undefined,
			);
		}
	};
	visit(input);
	return [...new Set(blockers)];
}
