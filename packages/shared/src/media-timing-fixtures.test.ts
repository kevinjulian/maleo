import { expect, test } from "vite-plus/test";
import { z } from "zod";
import fixtures from "../../../crates/media/tests/fixtures/timing.json";
import {
	heldVideoFrame,
	retimeSourceDuration,
	sceneVisualSourceDuration,
	sliceSourceInterval,
	sourceInterval,
	sourceTime,
} from "./source-interval.ts";
import { reversePlaybackSource, reverseMediaSchema } from "./reverse-media.ts";

const range = { start: z.number(), duration: z.number(), rate: z.number() };
const operation = z.discriminatedUnion("type", [
	z.object({ type: z.literal("interval"), ...range }),
	z.object({
		type: z.literal("slice"),
		...range,
		reverse: z.boolean(),
		from: z.number(),
		to: z.number(),
	}),
	z.object({ type: z.literal("time"), ...range, reverse: z.boolean(), elapsed: z.number() }),
	z.object({
		type: z.literal("retime"),
		start: z.number(),
		duration: z.number(),
		previous: z.number(),
		next: z.number(),
	}),
	z.object({
		type: z.literal("scene"),
		selected: z.number(),
		scene: z.number(),
		preserve: z.boolean(),
	}),
	z.object({
		type: z.literal("hold"),
		duration: z.number(),
		rate: z.number(),
		fps: z.number(),
		frame: z.number(),
	}),
	z.object({
		type: z.literal("reverse"),
		...range,
		url: z.string(),
		reverse: z.boolean(),
		derivative: z.unknown().optional(),
		revision: z.string().optional(),
	}),
]);
const cases = z
	.array(z.object({ name: z.string(), operation, expected: z.unknown() }))
	.parse(fixtures);
function evaluate(item: z.infer<typeof operation>) {
	switch (item.type) {
		case "interval":
			return sourceInterval(item.start, item.duration, item.rate);
		case "slice":
			return sliceSourceInterval(
				item.start,
				item.duration,
				item.rate,
				item.reverse,
				item.from,
				item.to,
			);
		case "time":
			return sourceTime(item.start, item.duration, item.rate, item.reverse, item.elapsed);
		case "retime":
			return retimeSourceDuration(item.start, item.duration, item.previous, item.next);
		case "scene":
			return sceneVisualSourceDuration(
				item.selected,
				item.scene,
				item.preserve ? { preservePitch: true } : undefined,
			);
		case "hold":
			return heldVideoFrame(item.duration, item.rate, item.fps, item.frame);
		case "reverse": {
			const derivative = reverseMediaSchema.safeParse(item.derivative);
			if (
				item.reverse &&
				(!derivative.success || (item.revision && derivative.data.sourceRevision !== item.revision))
			)
				throw new Error("Stale reverse source");
			const value = reversePlaybackSource(item.url, item.start, item.duration, {
				reverse: item.reverse,
				playbackRate: item.rate,
				reverseMedia: derivative.success ? derivative.data : undefined,
			});
			if (!value) throw new Error("Reverse source unavailable");
			return value;
		}
	}
}
function outcome(item: z.infer<typeof operation>) {
	try {
		return { ok: evaluate(item) };
	} catch {
		return { error: true };
	}
}
for (const fixture of cases)
	test(fixture.name, () => {
		expect(outcome(fixture.operation)).toEqual(fixture.expected);
	});
