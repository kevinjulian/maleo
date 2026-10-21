import { describe, expect, it } from "vite-plus/test";
import { normalizeSceneClips, resequenceScenes } from "./index.ts";
import type { Scene } from "./index.ts";

const scene = (over: Partial<Scene> & { id: number }): Scene => ({
	dur: 4,
	name: `Scene ${over.id}`,
	shot: "Medium",
	move: "Static",
	vis: "",
	vo: "",
	img: false,
	...over,
});

describe("normalizeSceneClips", () => {
	it("keeps short source windows, transforms and keys across normalization and resequencing", () => {
		const visual = {
			id: "v",
			kind: "video" as const,
			label: "Source",
			url: "/api/media/source",
			startSec: 0,
			durationSec: 0.25,
			primary: true,
			volume: 0.3,
			mediaStartSec: 2,
			layout: {
				xPct: 20,
				yPct: 10,
				widthPct: 60,
				fit: "contain" as const,
				playbackRate: 2,
				preservePitch: true,
				animation: {
					tracks: {
						opacity: [
							{ t: 0, v: 1 },
							{ t: 0.25, v: 0.5 },
						],
					},
				},
			},
		};
		const original = scene({ id: 1, dur: 0.25, visualClips: [visual], vo: "Keep narration" });
		const loaded = resequenceScenes(JSON.parse(JSON.stringify([original])))[0]!;
		expect(loaded.dur).toBe(0.25);
		expect(loaded.visualClips?.[0]).toMatchObject(visual);
		expect(loaded.vo).toBe("Keep narration");
		expect(normalizeSceneClips(loaded)).toEqual(loaded);
	});
	it("seeds default visual/audio clip times local to the scene", () => {
		const scenes = resequenceScenes([
			scene({ id: 1, dur: 3, img: true, src: "a.png", vo: "first" }),
			scene({ id: 2, dur: 5, img: true, src: "b.png", vo: "second" }),
		]);

		expect(scenes[1]!.start).toBeUndefined();
		expect(scenes[1]!.visualClips?.[0]?.startSec).toBe(0);
		expect(scenes[1]!.audioClips?.[0]?.startSec).toBe(0);
	});

	it("repairs persisted absolute primary scene clip starts on reload", () => {
		const repaired = normalizeSceneClips(
			scene({
				id: 2,
				dur: 5,
				img: true,
				src: "b.png",
				visualClips: [
					{
						id: "scene-2-visual-1",
						kind: "image",
						label: "Scene 2",
						url: "b.png",
						startSec: 12.991,
						durationSec: 5,
						primary: true,
					},
				],
				audioClips: [
					{
						id: "scene-2-audio-voiceover",
						kind: "voiceover",
						label: "Voiceover",
						content: "second",
						startSec: 12.991,
						durationSec: 5,
					},
				],
			}),
			12.991,
		);

		expect(repaired.visualClips?.[0]?.startSec).toBe(0);
		expect(repaired.audioClips?.[0]?.startSec).toBe(0);
	});
});
