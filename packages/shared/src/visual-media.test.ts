import { expect, test } from "vite-plus/test";
import { FULL_SOURCE_CROP, sourceCropGeometry, sourceCropSchema } from "./visual-media.ts";
import { buildRenderStoryboard } from "./render-storyboard.ts";

test("source crop rejects invalid windows and fits retained intrinsic aspect before transforms", () => {
	for (const crop of [
		{ ...FULL_SOURCE_CROP, widthPct: 0 },
		{ ...FULL_SOURCE_CROP, xPct: 50 },
		{ ...FULL_SOURCE_CROP, yPct: -1 },
		{ ...FULL_SOURCE_CROP, heightPct: Infinity },
	])
		expect(sourceCropSchema.safeParse(crop).success).toBe(false);
	const crop = { xPct: 50, yPct: 0, widthPct: 50, heightPct: 100 };
	const contain = sourceCropGeometry(
		{ width: 400, height: 100 },
		{ width: 100, height: 100 },
		crop,
		"contain",
	);
	expect(contain).toEqual({
		width: 100,
		height: 50,
		left: 0,
		top: 25,
		sourceWidth: 200,
		sourceHeight: 50,
		sourceLeft: -100,
		sourceTop: -0,
	});
	expect(
		sourceCropGeometry({ width: 400, height: 100 }, { width: 100, height: 100 }, crop, "cover"),
	).toMatchObject({ width: 200, height: 100, left: -50, top: 0 });
	expect(
		sourceCropGeometry({ width: 400, height: 100 }, { width: 100, height: 100 }, crop, "stretch"),
	).toMatchObject({ width: 100, height: 100 });
});

test("multi-visual projection retains scene crop and flips alongside per-source playback rate", () => {
	const crop = { xPct: 0, yPct: 0, widthPct: 50, heightPct: 100 };
	const layout = { xPct: 0, yPct: 0, widthPct: 100, fit: "stretch" as const };
	const { storyboard } = buildRenderStoryboard(
		{ format: "16:9" },
		{ images: [], speakers: [], notes: [], style: { tone: "", palette: "", music: "" } },
		[
			{
				id: 1,
				name: "Crop",
				shot: "Wide",
				move: "Static",
				vis: "",
				vo: "",
				img: true,
				src: "",
				dur: 2,
				layout: { ...layout, crop, flipX: true },
				visualClips: [
					{
						id: "first",
						kind: "video",
						url: "/api/media/video",
						label: "First",
						startSec: 0,
						durationSec: 1,
						primary: true,
						layout: { ...layout, playbackRate: 0.5 },
					},
					{
						id: "second",
						kind: "image",
						url: "/api/media/image",
						label: "Second",
						startSec: 1,
						durationSec: 1,
					},
				],
			},
		],
	);
	expect(storyboard.visualTimeline?.[0]?.layout).toMatchObject({
		crop,
		flipX: true,
		playbackRate: 0.5,
	});
	expect(storyboard.visualTimeline?.[1]?.layout).toMatchObject({ crop, flipX: true });
});
