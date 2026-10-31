import { describe, expect, test } from "vite-plus/test";
import {
	compileMotion,
	compositionParams,
	MOTION_EXAMPLES,
	textClipOf,
	type TextOverlay,
} from "@maleo/shared";
import type { EditScope } from "@maleo/shared/editor";
import { expandMotionCommand, motionExpandRefusal } from "./motion-expand.ts";

const example = MOTION_EXAMPLES.find((e) => e.presentation === "headline")!;
const config = compileMotion(example.intent, { spanSec: example.spanSec });
const FULL = { xPct: 0, yPct: 0, widthPct: 100, heightPct: 100, fit: "contain" as const };

function scope(motion: Partial<TextOverlay> = {}, others: TextOverlay[] = []): EditScope {
	const clip: TextOverlay = {
		id: 7,
		content: "Ship faster",
		start: 2,
		dur: example.spanSec * 2,
		track: 1,
		preset: "motion-comp",
		params: compositionParams(config),
		layout: FULL,
		...motion,
	};
	// SAFETY: a test scope with only the clips this command reads.
	return {
		doc: { clips: [clip, ...others].map(textClipOf) },
		slides: [],
		posts: [],
		mediaAssets: [],
	} as unknown as EditScope;
}

describe("expandMotionCommand", () => {
	test("replaces the motion clip with one clip per layer, as one batch", () => {
		const command = expandMotionCommand(scope(), "text:7");
		expect(command.type).toBe("batch");
		if (command.type !== "batch") return;
		expect(command.commands[0]).toEqual({ type: "clip.remove", id: "text:7" });
		const inserted = command.commands.slice(1);
		expect(inserted.map((c) => c.type)).toEqual(["clip.insert", "clip.insert", "clip.insert"]);
		const clips = inserted.flatMap((c) => (c.type === "clip.insert" ? [c.clip] : []));
		expect(clips.map((c) => c.text?.preset)).toEqual(["shape-rect", "plain", "shape-circle"]);
		expect(new Set(clips.map((c) => c.track)).size).toBe(3);
		expect(new Set(clips.map((c) => c.id)).size).toBe(3);
		expect(clips.every((c) => c.id !== "text:7")).toBe(true);
		const title = clips.find((c) => c.text?.preset === "plain")!;
		// The clip plays the composition stretched to twice its span.
		expect(title.startSec).toBeCloseTo(2 + config.overlays[1]!.relStart * 2, 6);
		expect(title.text?.layout?.animation?.tracks.yPct?.length).toBeGreaterThan(1);
	});

	test("takes lanes no other clip uses over that span", () => {
		const blocker: TextOverlay = {
			id: 9,
			content: "busy",
			start: 0,
			dur: 20,
			track: 2,
			preset: "plain",
		};
		const command = expandMotionCommand(scope({}, [blocker]), "text:7");
		const tracks =
			command.type === "batch"
				? command.commands.flatMap((c) => (c.type === "clip.insert" ? [c.clip.track] : []))
				: [];
		expect(tracks).not.toContain(2);
	});

	test("refuses what it would change silently", () => {
		expect(motionExpandRefusal(scope().doc, "text:7")).toBeNull();
		expect(motionExpandRefusal(scope({ preset: "plain" }).doc, "text:7")).toMatch(/motion clip/);
		expect(motionExpandRefusal(scope({ layout: { ...FULL, widthPct: 50 } }).doc, "text:7")).toMatch(
			/full frame/,
		);
		expect(
			motionExpandRefusal(
				scope({
					layout: { ...FULL, animation: { tracks: { opacity: [{ t: 0, v: 0.5 }] } } },
				}).doc,
				"text:7",
			),
		).toMatch(/clip animation/);
	});
});
