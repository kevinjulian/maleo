import { describe, expect, test } from "vite-plus/test";
import {
	normalizeSceneClips,
	buildRenderStoryboard,
	buildRenderStoryboardFromDoc,
	fromTimelineDoc,
	toTimelineDoc,
} from "@maleo/shared";
import { storyboardJson } from "@models/storyboard/document-wire.ts";
// The render projection lives in @maleo/shared; the HTTP client used to
// re-export it for import compatibility.

describe("create-content multi-track storyboard contract", () => {
	const twoScenes = () => [
		normalizeSceneClips({
			id: 1,
			dur: 3,
			name: "A",
			shot: "",
			move: "",
			vis: "",
			vo: "",
			img: false,
			visualClips: [
				{
					id: "v1",
					kind: "image",
					label: "",
					url: "a.png",
					startSec: 0,
					durationSec: 3,
					primary: true,
				},
			],
		}),
		normalizeSceneClips({
			id: 2,
			dur: 3,
			name: "B",
			shot: "",
			move: "",
			vis: "",
			vo: "",
			img: false,
			visualClips: [
				{
					id: "v2",
					kind: "image",
					label: "",
					url: "b.png",
					startSec: 0,
					durationSec: 3,
					primary: true,
				},
			],
		}),
	];
	const cfg = { format: "9:16", length: "6" } as const;
	const refs = {
		images: [],
		speakers: [],
		notes: [],
		style: { tone: "", palette: "", music: "chill" },
	};
	const trans = [
		{
			id: 1,
			fromClipId: "scene:1",
			toClipId: "scene:2",
			type: "slide" as const,
			dur: 0.5,
			colorPhase: 0,
		},
	];

	test("packed mode (no moved scene): omits startSec, outgoing transition on source scene", () => {
		const built = buildRenderStoryboard(cfg, refs, twoScenes(), { transitions: trans });
		const s = built.storyboard.scenes;
		expect(s[0]?.startSec).toBeUndefined();
		expect(s[1]?.startSec).toBeUndefined();
		// Outgoing edge sits on the scene it leaves (scene 1 -> 2).
		expect(s[0]?.transition).toBe("slide");
		expect(s[1]?.transition).toBe("cut");
	});

	test("pixel transition maps through scene edge", () => {
		const built = buildRenderStoryboard(cfg, refs, twoScenes(), {
			transitions: [{ id: 2, fromClipId: "scene:1", toClipId: "scene:2", type: "pixel", dur: 0.6 }],
		});
		expect(built.storyboard.scenes[0]?.transition).toBe("pixel");
	});

	test("render decoupling: a beat's extra visual renders as a top-level overlay at absolute, unclamped timing", () => {
		// Beat dur 4; primary A 0-4; extra B at in-beat 3 for 5s (extends past the beat to 8s).
		const beat = normalizeSceneClips({
			id: 1,
			dur: 4,
			name: "A",
			shot: "",
			move: "",
			vis: "",
			vo: "",
			img: true,
			src: "a.png",
			visualClips: [
				{
					id: "a",
					kind: "image",
					label: "A",
					url: "a.png",
					startSec: 0,
					durationSec: 4,
					primary: true,
				},
				{ id: "b", kind: "image", label: "B", url: "b.png", startSec: 3, durationSec: 5 },
			],
		});
		const built = buildRenderStoryboard(cfg, refs, [beat], {
			transitions: [{ id: 9, fromClipId: "scene:1", toClipId: "vis:1:b", type: "slide", dur: 0.5 }],
		});
		// Multi-visual beat -> ALL visuals render top-level in visualTimeline (pure clip render).
		const vt = built.storyboard.visualTimeline!;
		expect(vt.map((v) => v.url)).toEqual(["a.png", "b.png"]);
		// Primary A: absolute start 0. Extra B: absolute start 3 (beat 0 + in-beat 3), dur 5 -> 8s, unclamped.
		expect(vt.find((v) => v.url === "a.png")?.startSec).toBe(0);
		const b = vt.find((v) => v.url === "b.png");
		expect(b?.startSec).toBe(3);
		expect(b?.durationSec).toBe(5);
		// Overlapping same-lane clips have no shared boundary, so stale pair is ignored.
		expect(b?.transition).toBeUndefined();
		const touching = {
			...beat,
			visualClips: beat.visualClips!.map((v) => (v.id === "b" ? { ...v, startSec: 4 } : v)),
		};
		const joined = buildRenderStoryboard(cfg, refs, [touching], {
			transitions: [{ id: 9, fromClipId: "scene:1", toClipId: "vis:1:b", type: "slide", dur: 0.5 }],
		});
		expect(joined.storyboard.visualTimeline?.find((v) => v.url === "b.png")?.transition).toBe(
			"slide",
		);
	});

	test("visualTimeline: a scene-to-scene transition is the ENTRANCE of the target scene's primary, not the source", () => {
		const scenes = [
			normalizeSceneClips({
				id: 1,
				dur: 3,
				name: "S1",
				shot: "",
				move: "",
				vis: "",
				vo: "",
				img: true,
				src: "a.png",
				visualClips: [
					{
						id: "a",
						kind: "image",
						label: "A",
						url: "a.png",
						startSec: 0,
						durationSec: 3,
						primary: true,
					},
					{ id: "a2", kind: "image", label: "A2", url: "a2.png", startSec: 1, durationSec: 2 },
				],
			}),
			normalizeSceneClips({
				id: 2,
				dur: 3,
				name: "S2",
				shot: "",
				move: "",
				vis: "",
				vo: "",
				img: true,
				src: "c.png",
				visualClips: [
					{
						id: "c",
						kind: "image",
						label: "C",
						url: "c.png",
						startSec: 0,
						durationSec: 3,
						primary: true,
					},
				],
			}),
		];
		const built = buildRenderStoryboard(cfg, refs, scenes, {
			transitions: [{ id: 7, fromClipId: "scene:1", toClipId: "scene:2", type: "slide", dur: 0.5 }],
		});
		const vt = built.storyboard.visualTimeline!;
		// scene 1's primary (a.png) has NO transition — the edge is not its outgoing one.
		expect(vt.find((v) => v.url === "a.png")?.transition).toBeUndefined();
		// scene 2's primary (c.png) carries the incoming slide as its entrance.
		expect(vt.find((v) => v.url === "c.png")?.transition).toBe("slide");
	});

	test("moved mode: broken pair loses transition and mirrored scene fallback", () => {
		const scenes = twoScenes();
		const moved = [
			{ ...scenes[0]!, transition: "slide" as const },
			{ ...scenes[1]!, start: 5 },
		];
		const built = buildRenderStoryboard(cfg, refs, moved, { transitions: trans });
		const s = built.storyboard.scenes;
		expect(s[0]?.startSec).toBe(0);
		expect(s[1]?.startSec).toBe(5);
		// Gap breaks the shared boundary; the stale outgoing fallback must not reappear.
		expect(s[0]?.transition).toBe("cut");
		expect(s[1]?.transition).toBe("cut");
	});

	test("moved mode packs scenes without explicit start using a running cursor", () => {
		const scenes = twoScenes();
		// scene 1 has no start (packed at cursor 0..3), scene 2 moved to 8.
		const moved = [scenes[0]!, { ...scenes[1]!, start: 8 }];
		const built = buildRenderStoryboard(cfg, refs, moved, { transitions: trans });
		expect(built.storyboard.scenes[0]?.startSec).toBe(0);
		expect(built.storyboard.scenes[1]?.startSec).toBe(8);
	});

	test("doc projection preserves Remotion render storyboard input", () => {
		const scenes = twoScenes().map((s, index) => ({ ...s, start: index * 3 }));
		const overlays = [
			{ id: 21, content: "Visible title", start: 1, dur: 2, preset: "title" as const, track: 2 },
		];
		const audioOverlays = [
			{
				id: 31,
				kind: "music" as const,
				content: "bed",
				url: "bed.mp3",
				start: 0,
				dur: 6,
				track: 3,
			},
		];
		const effects = [{ id: 41, effect: "fade_in" as const, start: 0, dur: 1, track: 4 }];
		const doc = toTimelineDoc(scenes, [], overlays, audioOverlays, effects, trans);
		const projected = fromTimelineDoc(doc);

		const direct = buildRenderStoryboard(cfg, refs, scenes, {
			overlays,
			audioOverlays,
			effects,
			transitions: trans,
		});
		const viaDoc = buildRenderStoryboard(cfg, refs, projected.scenes, {
			overlays: projected.textOverlays,
			audioOverlays: projected.audioOverlays,
			effects: projected.effects,
			transitions: projected.transitions,
		});

		expect(viaDoc.storyboard).toEqual(direct.storyboard);
	});

	test("buildRenderStoryboardFromDoc clip-native render path equals the array path", () => {
		const scenes = twoScenes().map((s, index) => ({ ...s, start: index * 3 }));
		const overlays = [
			{ id: 21, content: "Visible title", start: 1, dur: 2, preset: "title" as const, track: 2 },
		];
		const audioOverlays = [
			{
				id: 31,
				kind: "music" as const,
				content: "bed",
				url: "bed.mp3",
				start: 0,
				dur: 6,
				track: 3,
			},
		];
		const effects = [{ id: 41, effect: "fade_in" as const, start: 0, dur: 1, track: 4 }];
		const doc = toTimelineDoc(scenes, [], overlays, audioOverlays, effects, trans);

		// Group 3: the render path builds from the store's document. With no track
		// flags active it must byte-match the legacy array-fed build.
		const direct = buildRenderStoryboard(cfg, refs, scenes, {
			overlays,
			audioOverlays,
			effects,
			transitions: trans,
		});
		const viaDoc = buildRenderStoryboardFromDoc(cfg, refs, doc, {});
		expect(viaDoc.storyboard).toEqual(direct.storyboard);
		expect(viaDoc.preset).toBe(direct.preset);
	});

	/* The claim that justifies letting voiceover, music, SFX and ambient share one
	 * audio lane: every audio behaviour in the renderer keys off the clip's own
	 * `kind` and never off its track. `StoryboardReel` computes the ducking
	 * envelope from clips whose kind is voiceover; the projection below does not
	 * even carry a track for audio. Asserted rather than argued, because "a group
	 * says what a lane accepts, not how many lanes of it exist" rests on it. */
	test("audio renders identically on one lane and on two", () => {
		const scenes = twoScenes().map((s, index) => ({ ...s, start: index * 3 }));
		const vo = {
			id: 31,
			kind: "voiceover" as const,
			content: "narration",
			url: "vo.mp3",
			start: 0,
			dur: 4,
		};
		const music = {
			id: 32,
			kind: "music" as const,
			content: "bed",
			url: "bed.mp3",
			start: 0,
			dur: 6,
		};

		const shared = buildRenderStoryboardFromDoc(
			cfg,
			refs,
			toTimelineDoc(
				scenes,
				[],
				[],
				[
					{ ...vo, track: 1 },
					{ ...music, track: 1 },
				],
				[],
				trans,
			),
			{},
		);
		const split = buildRenderStoryboardFromDoc(
			cfg,
			refs,
			toTimelineDoc(
				scenes,
				[],
				[],
				[
					{ ...vo, track: 1 },
					{ ...music, track: 2 },
				],
				[],
				trans,
			),
			{},
		);

		expect(shared.storyboard).toEqual(split.storyboard);
	});

	test("buildRenderStoryboardFromDoc honors track flags (hidden visuals, muted audio, base flags)", () => {
		const scenes = twoScenes().map((s, index) => ({ ...s, start: index * 3 }));
		const overlays = [
			{ id: 21, content: "Hidden title", start: 1, dur: 2, preset: "title" as const, track: 2 },
		];
		const audioOverlays = [
			{
				id: 31,
				kind: "music" as const,
				content: "bed",
				url: "bed.mp3",
				start: 0,
				dur: 6,
				track: 3,
			},
		];
		const doc = toTimelineDoc(scenes, [], overlays, audioOverlays, [], trans);

		const built = buildRenderStoryboardFromDoc(cfg, refs, doc, {
			trackFlags: { 2: { hidden: true }, 3: { muted: true }, [-1]: { hidden: true, muted: true } },
		});
		// Hidden text track dropped; muted audio track dropped.
		expect(built.storyboard.textOverlays).toEqual([]);
		expect(built.storyboard.audioOverlays).toEqual([]);
		// Base scene track flags stamped.
		expect(built.storyboard.hideBase).toBe(true);
		expect(built.storyboard.muteBase).toBe(true);
	});

	test("storyboardJson clips-direct persist path equals the array-projection path", () => {
		const scenes = twoScenes().map((s, index) => ({ ...s, start: index * 3 }));
		const overlays = [
			{ id: 21, content: "Visible title", start: 1, dur: 2, preset: "title" as const, track: 2 },
		];
		const audioOverlays = [
			{
				id: 31,
				kind: "music" as const,
				content: "bed",
				url: "bed.mp3",
				start: 0,
				dur: 6,
				track: 3,
			},
		];
		const effects = [{ id: 41, effect: "fade_in" as const, start: 0, dur: 1, track: 4 }];
		const doc = toTimelineDoc(scenes, [], overlays, audioOverlays, effects, trans);

		// Group 2: persistence passes the store's clips directly; must byte-match the
		// legacy array-projection payload for the same document.
		const viaArrays = storyboardJson(
			"video",
			{ scenes },
			{ overlays, audioOverlays, effects, transitions: trans, markers: doc.markers },
		);
		const viaClips = storyboardJson("video", {}, { clips: doc.clips, markers: doc.markers });

		expect(viaClips).toEqual(viaArrays);
	});
});
