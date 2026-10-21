import { describe, expect, test } from "vite-plus/test";
import { fromTimelineDoc, toTimelineDoc } from "./timeline-doc.ts";
import { buildRenderStoryboard } from "./render-storyboard.ts";
import { sceneSpeechHash } from "./asset-staleness.ts";
import {
	readStoryboardDocument,
	writeStoryboardDocument,
	SCENE_TEXT_CLIP_MIGRATION_VERSION,
} from "./storyboard-document.ts";
import { EMPTY_PROJECT_SELECTION } from "./project-selection.ts";
import { EMPTY_PROJECT_MATERIALS } from "./project-materials.ts";
import type {
	AudioOverlay,
	EffectClip,
	InfographicOverlay,
	Scene,
	TextOverlay,
	TransitionClip,
	VideoOverlay,
} from "./timeline-model.ts";

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

describe("toTimelineDoc / fromTimelineDoc", () => {
	test("marker provenance parses and survives derived-range merge", async () => {
		const { parseMarkers, mergeMarkerMetadata } = await import("./timeline-markers.ts");
		const persisted = parseMarkers([
			{
				id: 1,
				title: "Beat",
				clipIds: ["old"],
				startSec: 9,
				endSec: 10,
				storyBeatId: "beat-opaque",
				sourceRevisionId: "rev-opaque",
			},
		]);
		const derived = [{ id: 1, title: "Derived", clipIds: ["scene:1"], startSec: 0, endSec: 4 }];
		expect(mergeMarkerMetadata(derived, persisted)).toEqual([
			{
				...derived[0],
				title: "Beat",
				beat: undefined,
				voiceoverText: undefined,
				storyBeatId: "beat-opaque",
				sourceRevisionId: "rev-opaque",
			},
		]);
		const legacy = parseMarkers([{ id: 2, title: "Legacy", clipIds: [], startSec: 0, endSec: 1 }]);
		expect(legacy[0]).not.toHaveProperty("storyBeatId");
		expect(
			mergeMarkerMetadata(
				[
					{
						id: 2,
						title: "Derived",
						clipIds: ["scene:2"],
						startSec: 0,
						endSec: 1,
						storyBeatId: "beat-new",
						sourceRevisionId: "rev-new",
					},
				],
				legacy,
			)[0],
		).toMatchObject({ storyBeatId: "beat-new", sourceRevisionId: "rev-new" });
	});

	test("several clips from one semantic beat share one provenance marker", () => {
		const doc = toTimelineDoc([
			scene({ id: 1, dur: 2, storyBeatId: "beat-a", sourceRevisionId: "rev-a" }),
			scene({ id: 2, dur: 3, storyBeatId: "beat-a", sourceRevisionId: "rev-a" }),
		]);
		expect(doc.markers).toEqual([
			expect.objectContaining({
				id: 1,
				clipIds: ["scene:1", "scene:2"],
				startSec: 0,
				endSec: 5,
				storyBeatId: "beat-a",
				sourceRevisionId: "rev-a",
			}),
		]);
	});

	test("non-adjacent scenes with one beat id do not create a marker across the gap", () => {
		const doc = toTimelineDoc([
			scene({ id: 1, dur: 2, storyBeatId: "beat-a" }),
			scene({ id: 2, dur: 3, storyBeatId: "beat-b" }),
			scene({ id: 3, dur: 2, storyBeatId: "beat-a" }),
		]);
		expect(
			doc.markers.map((marker) => [marker.id, marker.clipIds, marker.startSec, marker.endSec]),
		).toEqual([
			[1, ["scene:1"], 0, 2],
			[2, ["scene:2"], 2, 5],
			[3, ["scene:3"], 5, 7],
		]);
	});
	test("projects every source array into one clip list + scene markers", () => {
		const doc = toTimelineDoc(
			[scene({ id: 1 }), scene({ id: 2 })],
			[{ id: 10, url: "b.mp4", kind: "video", start: 1, dur: 3, track: 1 } as VideoOverlay],
			[{ id: 20, content: "Hi", start: 0, dur: 2, preset: "title", track: 2 } as TextOverlay],
			[{ id: 30, kind: "voiceover", content: "vo", start: 0, dur: 5 } as AudioOverlay],
			[{ id: 40, effect: "fade_in", start: 0, dur: 1 } as EffectClip],
			[
				{
					id: 50,
					fromClipId: "scene:1",
					toClipId: "scene:2",
					type: "fade",
					dur: 0.8,
				} as TransitionClip,
			],
		);
		expect(doc.schemaVersion).toBe(2);
		expect(doc.clips.map((c) => c.type)).toEqual([
			"image",
			"image",
			"video",
			"text",
			"audio",
			"effect",
			"transition",
		]);
		expect(doc.clips.map((c) => c.id)).toEqual([
			"scene:1",
			"scene:2",
			"video:10",
			"text:20",
			"audio:30",
			"effect:40",
			"trans:50",
		]);
		expect(doc.markers).toEqual([
			{
				id: 1,
				title: "Scene 1",
				clipIds: ["scene:1"],
				startSec: 0,
				endSec: 4,
				voiceoverText: undefined,
			},
			{
				id: 2,
				title: "Scene 2",
				clipIds: ["scene:2"],
				startSec: 4,
				endSec: 8,
				voiceoverText: undefined,
			},
		]);
	});

	test("scene clips get sequential starts; clip type reflects end-frame video", () => {
		const doc = toTimelineDoc([
			scene({ id: 1, dur: 3 }),
			scene({ id: 2, dur: 2, img: true, endSrc: "end.png" }),
		]);
		expect(doc.clips[0]!.startSec).toBe(0);
		expect(doc.clips[1]!.startSec).toBe(3);
		expect(doc.clips[1]!.type).toBe("video");
	});

	test("round-trips losslessly, preserving a moved scene's start + track", () => {
		const scenes = [
			scene({ id: 1, dur: 3 }),
			scene({
				id: 2,
				dur: 2,
				start: 8,
				track: 1,
				vis: "keep me",
				refIds: ["ref-kitchen", "ref-mom"],
				useGlobalReferences: false,
			}),
		];
		const video: VideoOverlay[] = [
			{ id: 10, url: "b.mp4", kind: "video", start: 1, dur: 3, track: 2 } as VideoOverlay,
		];
		const trans: TransitionClip[] = [
			{ id: 50, fromClipId: "scene:1", toClipId: "scene:2", type: "fade", dur: 0.8 },
		];
		const projectReferences = { prompt: "keep kitchen warm", entityIds: ["global-kitchen"] };
		const doc = toTimelineDoc(scenes, video, [], [], [], trans, projectReferences);
		expect(doc.clips.find((c) => c.id === "scene:2")?.refIds).toEqual(["ref-kitchen", "ref-mom"]);
		expect(doc.clips.find((c) => c.id === "scene:2")?.useGlobalReferences).toBe(false);
		expect(doc.projectReferences).toEqual(projectReferences);
		const back = fromTimelineDoc(doc);
		expect(back.scenes).toHaveLength(2);
		expect(back.scenes[1]!.start).toBe(8);
		expect(back.scenes[1]!.track).toBe(1);
		expect(back.scenes[1]!.vis).toBe("keep me");
		expect(back.scenes[1]!.refIds).toEqual(["ref-kitchen", "ref-mom"]);
		expect(back.scenes[1]!.useGlobalReferences).toBe(false);
		expect(back.projectReferences).toEqual(projectReferences);
		expect(back.videoOverlays[0]!.start).toBe(1);
		expect(back.videoOverlays[0]!.track).toBe(2);
		expect(back.transitions[0]!.fromClipId).toBe("scene:1");
	});

	test("multi-image beat: extra visuals promote to top-level clips with markerId, round-trip", () => {
		const s = scene({
			id: 1,
			dur: 6,
			visualClips: [
				{
					id: "a",
					kind: "image",
					label: "A",
					url: "a.png",
					startSec: 0,
					durationSec: 3,
					primary: true,
					reveal: { type: "fade" },
				},
				{
					id: "b",
					kind: "image",
					label: "B",
					url: "b.png",
					startSec: 3,
					durationSec: 3,
					reveal: {
						type: "wipe",
						direction: "left",
						durationSec: 2,
						phase: "dark_pixels_first",
						texture: "paper",
						colorBuild: "muted_to_full",
					},
				},
			],
		});
		const doc = toTimelineDoc([s]);
		// primary stays scene:1; extra promotes to a top-level clip with markerId.
		const sceneClip = doc.clips.find((c) => c.id === "scene:1");
		const extra = doc.clips.find((c) => c.id === "vis:1:b");
		expect(sceneClip?.markerId).toBe(1);
		expect((sceneClip?.scene?.visualClips ?? []).length).toBe(1); // only the primary nested
		expect(extra?.markerId).toBe(1);
		expect(extra?.vis?.vclip.url).toBe("b.png");
		expect(extra?.vis?.vclip.reveal).toEqual({
			type: "wipe",
			direction: "left",
			durationSec: 2,
			phase: "dark_pixels_first",
			texture: "paper",
			colorBuild: "muted_to_full",
		});
		expect(extra?.startSec).toBe(3); // absolute = beat start (0) + in-beat 3
		expect(doc.markers[0]!.clipIds).toEqual(["scene:1", "vis:1:b"]);
		// round-trip rebuilds both visuals on the scene
		const back = fromTimelineDoc(doc);
		expect(back.scenes[0]!.visualClips?.map((v) => v.url)).toEqual(["a.png", "b.png"]);
		expect(back.scenes[0]!.visualClips?.map((v) => v.reveal)).toEqual([
			{ type: "fade" },
			{
				type: "wipe",
				direction: "left",
				durationSec: 2,
				phase: "dark_pixels_first",
				texture: "paper",
				colorBuild: "muted_to_full",
			},
		]);
	});

	test("a moved promoted visual rederives its in-beat timing from the doc (not stale)", () => {
		const s = scene({
			id: 1,
			dur: 6,
			start: 2,
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
				{ id: "b", kind: "image", label: "B", url: "b.png", startSec: 3, durationSec: 3 },
			],
		});
		const doc = toTimelineDoc([s]);
		// Simulate the promoted clip being moved later in the doc (abs start 7, beat starts at 2).
		const moved = {
			...doc,
			clips: doc.clips.map((c) => (c.id === "vis:1:b" ? { ...c, startSec: 7, durationSec: 1 } : c)),
		};
		const back = fromTimelineDoc(moved);
		const b = back.scenes[0]!.visualClips!.find((v) => v.url === "b.png")!;
		// in-beat start = abs 7 - beat start 2 = 5 (rederived, NOT the stored 3)
		expect(b.startSec).toBe(5);
		expect(b.durationSec).toBe(1);
	});

	test("editing a clip's start/track in the doc flows back to its source array", () => {
		const doc = toTimelineDoc(
			[scene({ id: 1, dur: 4 })],
			[
				{
					id: 10,
					url: "x.png",
					kind: "image",
					start: 0,
					dur: 2,
					track: 0,
					reveal: {
						type: "spotlight",
						direction: "center",
						phase: "dark_pixels_first",
						texture: "ink",
						colorBuild: "muted_to_full",
					},
				} as VideoOverlay,
			],
		);
		const moved = {
			...doc,
			clips: doc.clips.map((c) => (c.id === "video:10" ? { ...c, startSec: 5, track: 3 } : c)),
		};
		const back = fromTimelineDoc(moved);
		expect(back.videoOverlays[0]!.start).toBe(5);
		expect(back.videoOverlays[0]!.track).toBe(3);
		expect(back.videoOverlays[0]!.reveal).toEqual({
			type: "spotlight",
			direction: "center",
			phase: "dark_pixels_first",
			texture: "ink",
			colorBuild: "muted_to_full",
		});
	});

	test("render storyboard carries reveal metadata and leaves Auto duration derived", () => {
		const s = scene({
			id: 1,
			dur: 6,
			visualClips: [
				{
					id: "a",
					kind: "image",
					label: "A",
					url: "a.png",
					startSec: 0,
					durationSec: 6,
					primary: true,
					reveal: { type: "wipe", direction: "right" },
				},
				{
					id: "b",
					kind: "image",
					label: "B",
					url: "b.png",
					startSec: 3,
					durationSec: 2,
					reveal: {
						type: "sketch_draw",
						durationSec: 1.5,
						texture: "dust",
						colorBuild: "muted_to_full",
					},
				},
			],
		});
		const built = buildRenderStoryboard(
			{ format: "9:16", length: "6" },
			{ images: [], speakers: [], notes: [], style: { tone: "", palette: "", music: "chill" } },
			[s],
		);
		expect(built.storyboard.scenes[0]?.visualClips?.[0]?.reveal).toEqual({
			type: "wipe",
			direction: "right",
		});
		expect(built.storyboard.scenes[0]?.visualClips?.[0]?.reveal).not.toHaveProperty("durationSec");
		expect(built.storyboard.visualTimeline?.find((v) => v.url === "b.png")?.reveal).toEqual({
			type: "sketch_draw",
			durationSec: 1.5,
			texture: "dust",
			colorBuild: "muted_to_full",
		});
	});

	test("persists edited audio levels through the canonical clip document", () => {
		const audio: AudioOverlay = {
			id: 30,
			kind: "accent_hit",
			content: "whoosh",
			url: "https://audio.test/whoosh.mp3",
			start: 1,
			dur: 2,
			track: 1,
			volume: 0.27,
			fadeIn: 0.2,
			fadeOut: 0.4,
		};
		const doc = JSON.parse(
			JSON.stringify(toTimelineDoc([scene({ id: 1 })], [], [], [audio])),
		) as ReturnType<typeof toTimelineDoc>;
		const back = fromTimelineDoc(doc);
		expect(back.audioOverlays[0]).toMatchObject({
			id: 30,
			volume: 0.27,
			fadeIn: 0.2,
			fadeOut: 0.4,
		});
	});

	test("round-trips an infographic clip preserving payload, style, animation, and edited timing", () => {
		const infographic = {
			id: 70,
			start: 2,
			dur: 4,
			track: 3,
			revealAt: 2.5,
			animation: { in: "slide_up", main: "count", out: "fade" },
			payload: { kind: "stat", value: "42%", label: "growth" },
			style: { accent: "#ff0066" },
		} as unknown as InfographicOverlay;
		const doc = JSON.parse(
			JSON.stringify(
				toTimelineDoc([scene({ id: 1 })], [], [], [], [], [], undefined, [infographic]),
			),
		) as ReturnType<typeof toTimelineDoc>;
		expect(doc.clips.find((c) => c.id === "infographic:70")?.type).toBe("infographic");
		// Simulate the infographic being moved + resized in the doc.
		const moved = {
			...doc,
			clips: doc.clips.map((c) =>
				c.id === "infographic:70" ? { ...c, startSec: 9, durationSec: 6, track: 1 } : c,
			),
		};
		const back = fromTimelineDoc(moved);
		expect(back.infographicOverlays[0]).toMatchObject({
			id: 70,
			start: 9,
			dur: 6,
			track: 1,
			revealAt: 2.5,
			animation: { in: "slide_up", main: "count", out: "fade" },
			payload: { kind: "stat", value: "42%", label: "growth" },
			style: { accent: "#ff0066" },
		});
	});

	test("round-trips an effect clip preserving intensity + edited timing", () => {
		const effect: EffectClip = {
			id: 40,
			effect: "shake" as EffectClip["effect"],
			start: 1,
			dur: 2,
			track: 2,
			intensity: 0.6,
		};
		const doc = JSON.parse(
			JSON.stringify(toTimelineDoc([scene({ id: 1 })], [], [], [], [effect])),
		) as ReturnType<typeof toTimelineDoc>;
		const moved = {
			...doc,
			clips: doc.clips.map((c) =>
				c.id === "effect:40" ? { ...c, startSec: 4, durationSec: 3, track: 0 } : c,
			),
		};
		const back = fromTimelineDoc(moved);
		expect(back.effects[0]).toMatchObject({
			id: 40,
			effect: "shake",
			start: 4,
			dur: 3,
			track: 0,
			intensity: 0.6,
		});
	});

	test("round-trips a text clip preserving params, style, layout through a doc edit", () => {
		const text = {
			id: 20,
			content: "Hello",
			start: 0,
			dur: 2,
			preset: "title",
			track: 4,
			layout: { x: 0.1, y: 0.2, w: 0.5, h: 0.3 },
			style: { fontWeight: 700 },
			params: { title: "T", subtitle: "S" },
		} as unknown as TextOverlay;
		const doc = JSON.parse(
			JSON.stringify(toTimelineDoc([scene({ id: 1 })], [], [text])),
		) as ReturnType<typeof toTimelineDoc>;
		const moved = {
			...doc,
			clips: doc.clips.map((c) =>
				c.id === "text:20" ? { ...c, startSec: 3, durationSec: 5, track: 1 } : c,
			),
		};
		const back = fromTimelineDoc(moved);
		expect(back.textOverlays[0]).toMatchObject({
			id: 20,
			content: "Hello",
			preset: "title",
			start: 3,
			dur: 5,
			track: 1,
			layout: { x: 0.1, y: 0.2, w: 0.5, h: 0.3 },
			style: { fontWeight: 700 },
			params: { title: "T", subtitle: "S" },
		});
	});

	/* `endMediaAssetId` is the identity slot for `endSrc`. Without a slot an end
	 * frame can be admitted but never read as used, so it would sit in "Ready to
	 * place" forever while visibly on the timeline. It only earns that if it
	 * survives the persisted document, hence a JSON hop rather than a plain
	 * projection. */
	test("round-trips both frame identities on a scene through serialize + parse", () => {
		const s = scene({
			id: 1,
			img: true,
			src: "start.png",
			mediaAssetId: "asset-start",
			endSrc: "end.png",
			endMediaAssetId: "asset-end",
		});
		const wire = JSON.parse(
			JSON.stringify(
				writeStoryboardDocument({
					schemaVersion: 2,
					sceneTextClipMigrationVersion: SCENE_TEXT_CLIP_MIGRATION_VERSION,
					clips: toTimelineDoc([s]).clips,
					markers: [],
					chapters: null,
					bookmarks: null,
					projectReferences: EMPTY_PROJECT_SELECTION,
					materials: EMPTY_PROJECT_MATERIALS,
					captions: null,
					captionSet: null,
					pacingDevices: null,
					infographicStyle: null,
					trackFlags: null,
					presentation: null,
					unitLifecycle: null,
					artifacts: [],
				}),
			),
		) as unknown;
		const read = readStoryboardDocument(wire);
		expect(read.clipFirst).toBe(true);
		const back = fromTimelineDoc({ schemaVersion: 2, clips: read.doc.clips, markers: [] });
		expect(back.scenes[0]).toMatchObject({
			mediaAssetId: "asset-start",
			endMediaAssetId: "asset-end",
			endSrc: "end.png",
		});
	});
});

describe("a render is built with its stale scenes reported, not blocked", () => {
	const refs = {
		images: [],
		speakers: [],
		notes: [],
		style: { tone: "", palette: "", music: "chill" },
	};

	test("an edited narration is listed, and the storyboard is still built", () => {
		/* Blocking would be safer and much more annoying. An operator who knows a
		 * frame is a little out of date and wants the cut anyway is not making a
		 * mistake, so the obligation is to SAY what is stale, then render. */
		const stamped = scene({
			id: 1,
			vo: "Ships break.",
			vis: "A dark desk.",
			src: "a.png",
			img: true,
		});
		const built = buildRenderStoryboard({ format: "9:16" }, refs, [
			{ ...stamped, speechInputHash: sceneSpeechHash(stamped), vo: "Rewritten entirely." },
		]);
		expect(built.stale).toEqual([{ id: 1, name: "Scene 1", speech: true, frame: false }]);
		expect(built.storyboard.scenes).toHaveLength(1);
	});

	test("a project with no recorded hashes reports nothing stale", () => {
		const built = buildRenderStoryboard({ format: "9:16" }, refs, [
			scene({ id: 1, src: "a.png", img: true }),
		]);
		expect(built.stale).toEqual([]);
		expect(built.storyboard.scenes).toHaveLength(1);
	});
});
