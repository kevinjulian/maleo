import { expect, test } from "vite-plus/test";
import {
	activeClipPropertyGroup,
	clipGroupOptions,
	clipPropertyGroups,
	resolveClipSubject,
} from "./clip-property-groups.tsx";
import { Ic } from "@design-system/icons/index.tsx";
import type { JSX } from "react";

const labels = (...args: Parameters<typeof clipPropertyGroups>) =>
	clipPropertyGroups(...args).map((g) => g.label);

test("each kind lists its groups in the OpenCut order, content first", () => {
	expect(labels("text")).toEqual(["Text", "Transform", "Animation", "Blending", "Timing"]);
	expect(labels("broll", { videoHasAudio: true, brollKind: "video" })).toEqual([
		"Source",
		"Transform",
		"Animation",
		"Blending",
		"Audio",
		"Timing",
		"Masks",
		"Adjust",
		"Reveal",
	]);
	expect(labels("broll", { brollKind: "image" })).toEqual([
		"Source",
		"Transform",
		"Animation",
		"Blending",
		"Timing",
		"Masks",
		"Adjust",
		"Reveal",
	]);
	expect(labels("scene", { sceneHasVideo: true })).toEqual([
		"Source",
		"Shot",
		"Transform",
		"Animation",
		"Blending",
		"Timing",
		"Masks",
		"Adjust",
		"Background",
	]);
	expect(labels("scene")).toEqual([
		"Source",
		"Shot",
		"Transform",
		"Animation",
		"Blending",
		"Masks",
		"Adjust",
		"Background",
	]);
	expect(labels("audio")).toEqual(["Audio", "Animation", "Timing", "Source"]);
	expect(labels(null)).toEqual([]);
});

test("no icon stands for two groups within a kind, and shared groups keep one icon everywhere", () => {
	const kinds = [
		["text"],
		["broll", { videoHasAudio: true, brollKind: "video" }],
		["scene", { sceneHasVideo: true }],
		["audio"],
	] as const;
	const iconOf = new Map<string, (s?: number) => JSX.Element>();
	for (const [kind, opts] of kinds) {
		const groups = clipPropertyGroups(kind, opts);
		expect(new Set(groups.map((g) => g.icon)).size).toBe(groups.length);
		for (const g of groups)
			if (
				["Transform", "Animation", "Blending", "Timing", "Masks", "Adjust", "Background"].includes(
					g.label,
				)
			) {
				{
					const seen = iconOf.get(g.label);
					if (seen) expect(g.icon).toBe(seen);
				}
				iconOf.set(g.label, g.icon);
			}
	}
	expect(clipPropertyGroups("broll", { brollKind: "image" })[0]?.icon).toBe(Ic.image);
	expect(clipPropertyGroups("broll", { brollKind: "video" })[0]?.icon).toBe(Ic.video);
});

test("the default group is the clip's content, and a remembered group is kept when the kind has it", () => {
	expect(activeClipPropertyGroup(clipPropertyGroups("text"), "masks")).toBe("content");
	expect(activeClipPropertyGroup(clipPropertyGroups("text"), "blending")).toBe("blending");
	expect(activeClipPropertyGroup(clipPropertyGroups("audio"), "transform")).toBe("levels");
});

test("group options come from the selection", () => {
	expect(clipGroupOptions({ videoOverlay: { kind: "video" } })).toEqual({
		videoHasAudio: true,
		brollKind: "video",
		sceneHasVideo: false,
	});
	expect(clipGroupOptions({ videoOverlay: { kind: "image" } })).toMatchObject({
		videoHasAudio: false,
		brollKind: "image",
	});
	expect(
		clipGroupOptions({ scene: { visualClips: [{ kind: "image" }, { kind: "video" }] } })
			.sceneHasVideo,
	).toBe(true);
});

test("shape presets resolve to shape controls in both inspector housings", () => {
	expect(resolveClipSubject({ text: { preset: "shape-circle" } })).toEqual({
		kind: "shape",
		title: "Circle",
	});
	expect(resolveClipSubject({ text: { preset: "shape-rect" } })).toEqual({
		kind: "shape",
		title: "Rectangle",
	});
	expect(resolveClipSubject({ text: { preset: "plain" } })).toEqual({
		kind: "text",
		title: "Text",
	});
	expect(labels("shape")).toEqual(["Shape", "Transform", "Animation", "Blending", "Timing"]);
});
