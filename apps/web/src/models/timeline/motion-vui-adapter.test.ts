import { describe, expect, test } from "vite-plus/test";
import type { CompositionLayer } from "@maleo/shared";
import {
	buildMotionRendererProps,
	buildMotionSaveInput,
	buildMotionVuiLanes,
	motionAnimatedTracks,
	motionLayerIdFromRow,
	motionTrackMarkers,
	parseMotionTrackRow,
	persistMotionSave,
	shiftMotionKeyframe,
} from "./motion-vui-adapter.ts";
import { StoryboardReel } from "@maleo/video/composition";

const layer = (): CompositionLayer => ({
	id: 7,
	content: "Title",
	preset: "plain",
	start: 1,
	dur: 4,
	anim: {
		tracks: {
			x: [
				{ t: 0, v: 0 },
				{ t: 0.5, v: 10 },
				{ t: 1, v: 20 },
			],
			y: [{ t: 0, v: 0 }],
			scale: [{ t: 0, v: 1 }],
			rotate: [{ t: 0, v: 0 }],
			opacity: [{ t: 0, v: 1 }],
			width: [{ t: 0, v: 100 }],
			height: [{ t: 0, v: 100 }],
			blur: [{ t: 0, v: 0 }],
			bgOpacity: [{ t: 0, v: 0 }],
			fontSize: [{ t: 0, v: 64 }],
			letterSpacing: [{ t: 0, v: 0 }],
			lineHeight: [{ t: 0, v: 1.1 }],
		},
		colorTracks: {
			fill: [
				{ t: 0, v: "#fff" },
				{ t: 1, v: "#000" },
			],
			bodyFill: [{ t: 0, v: "#fff" }],
			accent: [{ t: 0, v: "#f00" }],
			background: [{ t: 0, v: "#000" }],
		},
	},
});

describe("Motion Studio VUI adapter", () => {
	test("keeps final Storyboard renderer contract stable at representative frames", () => {
		const source = layer();
		const props = buildMotionRendererProps([source], 4.25, 16 / 9, {
			accentColor: "#f0f",
			bgColor: "#010203",
			fgColor: "#fafafa",
		});
		expect(props).toMatchObject({
			component: StoryboardReel,
			durationInFrames: 128,
			compositionWidth: 1280,
			compositionHeight: 720,
			fps: 30,
		});
		expect(props.inputProps.textOverlays).toEqual([
			{
				content: "Title",
				startSec: 1,
				durationSec: 4,
				preset: "plain",
				track: 0,
				layout: undefined,
				style: undefined,
				params: undefined,
				anim: source.anim,
			},
		]);
		expect(props.inputProps.scenes[0]).toMatchObject({
			durationSec: 4.25,
			movement: "Static",
			transition: "cut",
		});
		expect(props.inputProps).toMatchObject({
			accentColor: "#f0f",
			bgColor: "#010203",
			fgColor: "#fafafa",
			hideBase: true,
			muteBase: true,
		});
		const portrait = buildMotionRendererProps([source], 2, 9 / 16, {
			accentColor: "a",
			bgColor: "b",
			fgColor: "c",
		});
		expect(portrait).toMatchObject({
			durationInFrames: 60,
			compositionWidth: 720,
			compositionHeight: 1280,
			fps: 30,
		});
	});

	test("projects layer row plus every nested value/color property family", () => {
		const source = layer();
		const [lane] = buildMotionVuiLanes([source]);
		const range = lane!.ranges[0]!;
		expect(range).toMatchObject({ id: "layer-7", label: "Title", startSec: 1, durationSec: 4 });
		expect(range.children?.map((child) => child.label)).toEqual([
			"X %",
			"Y %",
			"Scale",
			"Rotate",
			"Opacity",
			"Width",
			"Height",
			"Blur",
			"BG opacity",
			"Font size",
			"Tracking",
			"Line height",
			"Text",
			"Body",
			"Accent",
			"Background",
		]);
		expect(range.children?.every((child) => child.readOnly)).toBe(true);
		expect(motionAnimatedTracks(source)).toHaveLength(16);
	});

	test("parses public nested row identities and rejects layer/unknown rows", () => {
		expect(parseMotionTrackRow("layer-7:value-scale")).toEqual({ kind: "value", prop: "scale" });
		expect(parseMotionTrackRow("layer-7:color-accent")).toEqual({ kind: "color", prop: "accent" });
		expect(parseMotionTrackRow("layer-7")).toBeNull();
		expect(parseMotionTrackRow("layer-7:value-nope")).toBeNull();
		expect(motionLayerIdFromRow("layer-7")).toBe(7);
		expect(motionLayerIdFromRow("layer-7:value-scale")).toBe(7);
		expect(motionLayerIdFromRow("unknown")).toBeNull();
	});

	test("maps normalized keyframes to layer-relative seconds and selection", () => {
		const source = layer();
		const markers = motionTrackMarkers(
			source,
			{ kind: "value", prop: "x" },
			{ layerId: 7, kind: "value", prop: "x", index: 1 },
		);
		expect(markers.map(({ timeSec, selected }) => ({ timeSec, selected }))).toEqual([
			{ timeSec: 0, selected: false },
			{ timeSec: 2, selected: true },
			{ timeSec: 4, selected: false },
		]);
		expect(
			motionTrackMarkers(source, { kind: "color", prop: "fill" }, null).map(
				(marker) => marker.label,
			),
		).toEqual(["Text keyframe 1", "Text keyframe 2"]);
	});

	test("retimes value and color keys immutably while clamping between neighbours", () => {
		const values = layer().anim!.tracks.x!;
		const moved = shiftMotionKeyframe(values, 1, 9)!;
		expect(moved[1]!.t).toBe(0.999);
		expect(values[1]!.t).toBe(0.5);
		const colors = layer().anim!.colorTracks!.fill!;
		expect(shiftMotionKeyframe(colors, 0, -2)?.[0]?.t).toBe(0);
		expect(shiftMotionKeyframe(colors, 9, 0.5)).toBeNull();
	});

	test("validates and persists exact web-owned composition payload", async () => {
		const layers = [layer()];
		expect(buildMotionSaveInput("   ", layers, "existing")).toBeNull();
		expect(buildMotionSaveInput("Motion", [], "existing")).toBeNull();
		const input = buildMotionSaveInput("  Motion title  ", layers, "existing")!;
		expect(input).toEqual({ name: "Motion title", layers, templateId: "existing" });
		const calls: unknown[][] = [];
		await persistMotionSave(input, async (...args) => {
			calls.push(args);
		});
		expect(calls).toEqual([["Motion title", layers, "existing", undefined]]);
	});
});
