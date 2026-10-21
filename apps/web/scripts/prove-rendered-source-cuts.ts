#!/usr/bin/env bun
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	buildRenderStoryboardFromDoc,
	DEFAULT_CAPTIONS,
	retainClipWindow,
	sourceTime,
	type Clip,
	type TimelineDoc,
} from "@maleo/shared";

const cases = [];
for (const rate of [0.25, 1, 4])
	for (const family of ["overlay", "scene", "multi-scene"]) {
		const layout = {
			xPct: 0,
			yPct: 0,
			widthPct: 100,
			heightPct: 100,
			fit: "stretch" as const,
			playbackRate: rate,
		};
		const video = {
			id: "plate",
			kind: "video" as const,
			label: "Numbered source",
			url: "synthetic-numbered.mkv",
			startSec: 0,
			durationSec: 1,
			primary: true,
			mediaStartSec: 1,
			layout,
		};
		const scene = {
			id: 1,
			name: "Source proof",
			shot: "Wide",
			move: "Static",
			vis: "",
			vo: "",
			img: true,
			src: "",
			dur: 1,
			layout,
			visualClips: family === "overlay" ? [] : [video],
		};
		const clip: Clip =
			family === "overlay"
				? {
						id: "video:1",
						type: "video",
						startSec: 0,
						durationSec: 1,
						track: 0,
						video: {
							id: 1,
							kind: "video",
							url: video.url,
							start: 0,
							dur: 1,
							mediaStartSec: 1,
							layout,
						},
					}
				: { id: "scene:1", type: "video", startSec: 0, durationSec: 1, track: -1, scene };
		const retained = retainClipWindow(clip, 8 / 30, 24 / 30);
		// Align retained window to zero without changing its original source interval.
		retained.startSec = 0;
		if (family === "multi-scene")
			retained.scene!.visualClips!.push({
				id: "late",
				kind: "image",
				label: "Late image",
				url: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'/%3E",
				startSec: 0.4,
				durationSec: 0.1,
			});
		const clips =
			family === "overlay"
				? [
						{
							id: "scene:1",
							type: "image" as const,
							startSec: 0,
							durationSec: 0.5,
							track: -1,
							scene: { ...scene, dur: 0.5 },
						},
						retained,
					]
				: [retained];
		const storyboard = buildRenderStoryboardFromDoc(
			{ format: "16:9" },
			{ images: [], speakers: [], notes: [], style: { tone: "", palette: "", music: "" } },
			{ schemaVersion: 2, clips, markers: [] },
			{ captions: DEFAULT_CAPTIONS },
		).storyboard;
		const originalDoc: TimelineDoc = {
			schemaVersion: 2 as const,
			clips:
				family === "overlay"
					? [
							{
								id: "scene:1",
								type: "image" as const,
								startSec: 0,
								durationSec: 1,
								track: -1,
								scene: { ...scene, dur: 1 },
							},
							clip,
						]
					: [clip],
			markers: [],
		};
		if (family === "multi-scene")
			originalDoc.clips[0]!.scene!.visualClips!.push({
				id: "late-original",
				kind: "image",
				label: "Late image",
				url: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'/%3E",
				startSec: 0.9,
				durationSec: 0.1,
			});
		const original = buildRenderStoryboardFromDoc(
			{ format: "16:9" },
			{ images: [], speakers: [], notes: [], style: { tone: "", palette: "", music: "" } },
			originalDoc,
			{ captions: DEFAULT_CAPTIONS },
		).storyboard;
		cases.push({
			original: { ...original, showLabels: false },
			label: `${family} ${rate}x`,
			storyboard: { ...storyboard, showLabels: false },
			sourceTime: sourceTime(1, 1, rate, false, 16 / 30),
		});
	}
const dir = await mkdtemp(join(tmpdir(), "maleo-rendered-source-cuts-"));
try {
	const path = join(dir, "cases.json");
	await Bun.write(path, JSON.stringify(cases));
	const child = Bun.spawn(
		[
			process.execPath,
			new URL("../../../packages/video/scripts/prove-source-cuts.ts", import.meta.url).pathname,
			path,
		],
		{ stdout: "inherit", stderr: "inherit" },
	);
	assert.equal(await child.exited, 0, "Production source cut sampling failed");
} finally {
	await rm(dir, { recursive: true, force: true });
}
