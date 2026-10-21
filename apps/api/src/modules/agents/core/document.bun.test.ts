import { describe, expect, test } from "bun:test";
import {
	fromTimelineDoc,
	toTimelineDoc,
	agentSceneFromScene,
	seedChapters,
	sourceAudioBlockers,
} from "@maleo/shared";
import type { Clip } from "@maleo/shared";
import { agentEditorViews, agentTimelineDoc } from "./document.ts";
import { overlaysFromV2Clips } from "./persistence.ts";
import type { AgentJob } from "./model.ts";

const scene = (over: Partial<AgentJob["scenes"][number]> = {}): AgentJob["scenes"][number] => ({
	name: "Scene",
	durationSec: 3,
	shot: "wide",
	move: "static",
	transition: "fade",
	visual: "a room",
	voiceover: "hello",
	...over,
});

const job = (over: Partial<AgentJob> = {}): AgentJob => ({
	id: "job",
	projectId: "p1",
	contentType: "video",
	status: "running",
	events: [],
	scenes: [],
	textOverlays: [],
	infographicOverlays: [],
	videoOverlays: [],
	audioOverlays: [],
	characters: [],
	artifacts: [],
	aspect: "16:9",
	brief: "b",
	startedAt: 0,
	...over,
});

describe("agentTimelineDoc", () => {
	test.each([2, 7])(
		"retains four-second video source through document and reload for %ss placement",
		(durationSec) => {
			const doc = agentTimelineDoc(
				job({
					videoOverlays: [
						{
							url: "/api/media/video",
							thumb: "/api/media/poster",
							kind: "video",
							sourceDurationSec: 4,
							startSec: 0,
							durationSec,
						},
					],
				}),
			);
			const clip = doc.clips.find((item) => item.type === "video")!;
			expect(clip.durationSec).toBe(Math.min(durationSec, 4));
			expect(clip.video?.thumb).toBe("/api/media/poster");
			expect(clip.video?.sourceDurationSec).toBe(4);
			expect(overlaysFromV2Clips(doc.clips).videoOverlays[0]).toMatchObject({
				durationSec: Math.min(durationSec, 4),
				sourceDurationSec: 4,
				thumb: "/api/media/poster",
			});
		},
	);
	test("lays scenes out sequentially with a one-second floor", () => {
		const doc = agentTimelineDoc(
			job({
				scenes: [scene({ durationSec: 4 }), scene({ durationSec: 0.5 }), scene({ durationSec: 2 })],
			}),
		);

		expect(doc.clips.map((c) => [c.id, c.startSec, c.durationSec])).toEqual([
			["scene:1", 0, 4],
			["scene:2", 4, 1],
			["scene:3", 5, 2],
		]);
	});

	test("derives markers with the range every reader needs", () => {
		const doc = agentTimelineDoc(
			job({ scenes: [scene({ name: "Open", durationSec: 4, voiceover: "vo one", beat: "hook" })] }),
		);

		expect(doc.markers).toEqual([
			{
				id: 1,
				title: "Open",
				clipIds: ["scene:1"],
				startSec: 0,
				endSec: 4,
				beat: "hook",
				voiceoverText: "vo one",
			},
		]);
	});

	test("keeps a seeded clip's id and track, mints fresh ids above them for agent clips", () => {
		const doc = agentTimelineDoc(
			job({
				scenes: [scene()],
				videoOverlays: [
					{ id: 5, url: "seed.png", kind: "image", startSec: 0, durationSec: 2, track: 3 },
					{ url: "new.mp4", kind: "video", startSec: 2, durationSec: 2 },
				],
			}),
		);

		expect(doc.clips.filter((c) => c.video).map((c) => [c.id, c.track, c.type])).toEqual([
			["video:5", 3, "image"],
			["video:6", 0, "video"],
		]);
	});

	test("carries client-owned clips through verbatim, after the agent's own", () => {
		const keep: Clip[] = [
			{
				id: "effect:1",
				type: "effect",
				startSec: 0,
				durationSec: 1,
				track: 0,
				effect: { id: 1, effect: "flash", start: 0, dur: 1, track: 0, intensity: 1 },
			},
		];
		const doc = agentTimelineDoc(job({ scenes: [scene()] }), keep);

		expect(doc.clips.map((c) => c.id)).toEqual(["scene:1", "effect:1"]);
	});

	test("round-trips its own families back off the document", () => {
		const doc = agentTimelineDoc(
			job({
				scenes: [scene({ name: "One", image: "one.png", durationSec: 4, refIds: ["e1"] })],
				textOverlays: [
					{
						id: 9,
						content: "Title",
						startSec: 1,
						durationSec: 2,
						preset: "rve-lower-third",
						track: 2,
					},
				],
				audioOverlays: [
					{
						id: 1,
						kind: "voiceover",
						content: "vo",
						url: "vo.wav",
						startSec: 0,
						durationSec: 4,
						originalDur: 6,
						mediaStartSec: 1,
					},
				],
				infographicOverlays: [
					{
						id: 2,
						startSec: 1,
						durationSec: 3,
						payload: { type: "stat_reveal", title: "Users", value: "10k" },
					},
				],
			}),
		);
		const back = fromTimelineDoc(doc);

		expect(back.scenes[0]).toMatchObject({
			id: 1,
			name: "One",
			dur: 4,
			src: "one.png",
			img: true,
			vis: "a room",
			vo: "hello",
			refIds: ["e1"],
		});
		expect(back.textOverlays[0]).toMatchObject({
			id: 9,
			content: "Title",
			start: 1,
			dur: 2,
			preset: "rve-lower-third",
			track: 2,
		});
		expect(back.audioOverlays[0]).toMatchObject({
			id: 1,
			kind: "voiceover",
			start: 0,
			dur: 4,
			originalDur: 6,
			mediaStartSec: 1,
			volume: 1,
			fadeIn: 0,
			fadeOut: 0,
		});
		expect(back.infographicOverlays[0]).toMatchObject({
			id: 2,
			start: 1,
			dur: 3,
			payload: { type: "stat_reveal", title: "Users", value: "10k" },
		});
	});
});

test("a run seeded from its own snapshot reads its overlays back unchanged", () => {
	// The persist → seed loop: whatever `agentTimelineDoc` writes is what the next
	// run reads through `overlaysFromV2Clips`, so a drift between the two would
	// re-home clips or mint duplicate ids on every resumed run.
	const before = job({
		scenes: [scene()],
		textOverlays: [
			{ id: 4, content: "Title", startSec: 1, durationSec: 2, preset: "lower-third", track: 2 },
		],
		videoOverlays: [
			{
				id: 7,
				url: "b.mp4",
				kind: "video",
				startSec: 0,
				durationSec: 3,
				label: "B-roll",
				track: 1,
			},
		],
		audioOverlays: [
			{ id: 1, kind: "voiceover", content: "vo", url: "vo.wav", startSec: 0, durationSec: 4 },
		],
		infographicOverlays: [
			{
				id: 3,
				startSec: 1,
				durationSec: 2,
				payload: { type: "stat_reveal", title: "Users", value: "10k" },
			},
		],
	});

	const seeded = overlaysFromV2Clips(agentTimelineDoc(before).clips);

	expect(seeded.textOverlays).toEqual(before.textOverlays);
	expect(seeded.videoOverlays).toEqual(before.videoOverlays);
	// The reader defaults an untracked clip to row 0 rather than leaving it absent.
	expect(seeded.infographicOverlays[0]).toMatchObject({
		...before.infographicOverlays[0]!,
		track: 0,
	});
	expect(seeded.audioOverlays[0]).toMatchObject({
		id: 1,
		kind: "voiceover",
		startSec: 0,
		durationSec: 4,
	});
});

describe("agentEditorViews", () => {
	test("defaults a text preset the agent left off", () => {
		const views = agentEditorViews(
			job({ textOverlays: [{ content: "Hi", startSec: 0, durationSec: 2 }] }),
		);
		expect(views.textOverlays[0]).toMatchObject({ id: 1, preset: "title" });
	});

	test("keeps an opted-out scene's reference flag", () => {
		const views = agentEditorViews(
			job({ scenes: [scene({ useGlobalReferences: false, refIds: ["e1"] })] }),
		);
		expect(views.scenes[0]).toMatchObject({ useGlobalReferences: false, refIds: ["e1"] });
	});
});

/* The blueprint fields arrive as loose strings — `AgentScene` types them
 * `string` because a model fills them, which is right for the wire. What was
 * wrong was the next step: `asSceneUnions` CAST each into the editor's narrower
 * union under a comment claiming "the client narrows on read". It does not, so a
 * beat the model invented reached a renderer with no case for it.
 *
 * These fail against that code, which passed any string through unchanged. */
describe("agentEditorViews — blueprint fields the model fills", () => {
	test("a value outside the union falls back instead of reaching the editor", () => {
		const views = agentEditorViews(
			job({
				scenes: [
					scene({
						beat: "prologue", // not a StoryBeat
						emotion: "smug", // not an Emotion
						visualType: "interpretive", // not an ExplainerVisualType
						transition: "dissolve", // not a TransitionType
					}),
				],
			}),
		);

		const s = views.scenes[0]!;
		expect(s.beat).toBeUndefined();
		expect(s.emotion).toBeUndefined();
		expect(s.visualType).toBeUndefined();
		// `transition` is the one with a declared default rather than an absence.
		expect(s.transition).toBe("fade");
	});

	/* The fallback is the whole safety story, so it has to leave a trace. A field
	 * that quietly stops arriving is the symptom of prompt/union drift, and
	 * without this warning the only way to notice is to miss the field later. */
	test("a dropped value says so, naming the field and what arrived", () => {
		const warnings: string[] = [];
		const original = console.warn;
		console.warn = (...args: unknown[]) => {
			warnings.push(args.join(" "));
		};
		try {
			agentEditorViews(job({ scenes: [scene({ beat: "prologue" })] }));
		} finally {
			console.warn = original;
		}

		expect(warnings).toHaveLength(1);
		expect(warnings[0]).toContain("scene.beat");
		expect(warnings[0]).toContain("prologue");
		// The member list is in the message: the reader needs to know what WOULD
		// have been accepted, not only that something was not.
		expect(warnings[0]).toContain("twist");
	});

	test("a member and an absent field are both silent", () => {
		const warnings: string[] = [];
		const original = console.warn;
		console.warn = (...args: unknown[]) => {
			warnings.push(args.join(" "));
		};
		try {
			// A model declining to fill an optional field is not drift, so it must
			// not produce noise that trains the reader to ignore the warning.
			agentEditorViews(job({ scenes: [scene({ beat: "twist" }), scene()] }));
		} finally {
			console.warn = original;
		}

		expect(warnings).toEqual([]);
	});

	test("a value inside the union is carried through", () => {
		const views = agentEditorViews(
			job({
				scenes: [
					scene({ beat: "twist", emotion: "suspense", visualType: "diagram", transition: "wipe" }),
				],
			}),
		);

		const s = views.scenes[0]!;
		expect(s.beat).toBe("twist");
		expect(s.emotion).toBe("suspense");
		expect(s.visualType).toBe("diagram");
		expect(s.transition).toBe("wipe");
	});

	test("an absent field stays absent rather than becoming a default", () => {
		const views = agentEditorViews(job({ scenes: [scene()] }));

		const s = views.scenes[0]!;
		expect(s.beat).toBeUndefined();
		expect(s.emotion).toBeUndefined();
	});
});

describe("section provenance reaches the chapters derived from a document", () => {
	/* The seeding rules were never wrong — they were never fed. `sectionId` was
	 * declared on the wire, persisted, parsed and consumed by `seedChapters`, and
	 * no test asserted anything ever PRODUCED it. That is how a document generated
	 * from four sections came to render as one chapter. */
	const sectioned = (): AgentJob["scenes"] => [
		scene({ name: "Bangun di Lilin", sectionId: "sec-1", sceneKind: "section_intro" }),
		scene({ name: "Bangun di Lilin · shot 2", sectionId: "sec-1" }),
		scene({ name: "Belajar Menari", sectionId: "sec-2", sceneKind: "section_intro" }),
		scene({ name: "Belajar Menari · shot 2", sectionId: "sec-2" }),
		scene({ name: "Lapangan Bunga", sectionId: "sec-3", sceneKind: "section_intro" }),
	];

	test("the document's scenes carry the provenance the job gave them", () => {
		const doc = agentTimelineDoc(job({ scenes: sectioned() }));
		expect(doc.clips.flatMap((c) => (c.scene ? [c.scene.sectionId] : []))).toEqual([
			"sec-1",
			"sec-1",
			"sec-2",
			"sec-2",
			"sec-3",
		]);
	});

	test("one chapter is derived per section, titled from the section's opening scene", () => {
		const doc = agentTimelineDoc(job({ scenes: sectioned() }));
		const scenes = doc.clips.flatMap((c) => (c.scene ? [c.scene] : []));
		const seeded = seedChapters(scenes, null);

		expect(seeded.chapters.map((c) => c.id)).toEqual(["sec-1", "sec-2", "sec-3"]);
		expect(seeded.chapters.map((c) => c.title)).toEqual([
			"Bangun di Lilin",
			"Belajar Menari",
			"Lapangan Bunga",
		]);
	});

	test("without provenance the same five scenes collapse to one chapter", () => {
		// The shape project 5edc35d5 is in: 22 scenes, no sectionId, no beat, and
		// therefore one chapter named positionally.
		const doc = agentTimelineDoc(
			job({
				scenes: sectioned().map((s) => ({ ...s, sectionId: undefined, sceneKind: undefined })),
			}),
		);
		const seeded = seedChapters(
			doc.clips.flatMap((c) => (c.scene ? [c.scene] : [])),
			null,
		);

		expect(seeded.chapters).toHaveLength(1);
		expect(seeded.chapters[0]!.title).toBe("Chapter 1");
	});
});

test("agent seed/document loop retains source audio controls, video gain and scene extraction", () => {
	const url = "/api/media/11111111-1111-4111-8111-111111111111",
		output = "/api/media/22222222-2222-4222-8222-222222222222";
	const audio = {
		id: 8,
		kind: "voiceover" as const,
		content: "Old narration",
		url,
		mediaAssetId: "voice",
		start: 12,
		dur: 8,
		track: 2,
		volume: 0.7,
		fadeIn: 0.2,
		fadeOut: 0.3,
		duckUnderVoice: 0.4,
		mediaStartSec: 1,
		playbackRate: 0.5,
		preservePitch: true,
		reverse: true,
		animation: {
			tracks: {
				volume: [
					{ t: 0, v: 0.2, easing: "in-out" as const },
					{ t: 8, v: 0.8 },
				],
			},
		},
		audioMedia: {
			url: output,
			sourceUrl: url,
			sourceRevision: "revision",
			startSec: 1,
			durationSec: 4,
			playbackRate: 0.5,
			preservePitch: true,
			reverse: true,
		},
	};
	const layout = {
		xPct: 0,
		yPct: 0,
		widthPct: 100,
		fit: "contain" as const,
		playbackRate: 0.5,
		preservePitch: true,
		reverse: true,
		animation: {
			tracks: {
				xPct: [
					{ t: 0, v: 0 },
					{ t: 8, v: 40 },
				],
			},
		},
		sourceAudioExtraction: {
			audioClipId: "audio:8",
			priorVolume: 0.6,
			source: {
				url,
				startSec: 1,
				durationSec: 4,
				playbackRate: 0.5,
				preservePitch: true,
				reverse: true,
			},
			audioSnapshot: audio,
		},
	};
	const original = toTimelineDoc(
		[
			{
				id: 1,
				name: "Imported",
				shot: "Wide",
				move: "Static",
				vis: "",
				vo: "Old narration",
				img: true,
				src: url,
				dur: 8,
				visualClips: [
					{
						id: "v",
						kind: "video",
						label: "Source",
						url,
						startSec: 0,
						durationSec: 8,
						mediaStartSec: 1,
						volume: 0,
						layout,
					},
				],
			},
		],
		[{ id: 3, kind: "video", url, start: 0, dur: 8, volume: 0.6, mediaStartSec: 1, layout }],
		[],
		[audio],
	);
	const seed = overlaysFromV2Clips(original.clips),
		sceneSeed = agentSceneFromScene(fromTimelineDoc(original).scenes[0]!);
	const next = agentTimelineDoc(
			job({ ...seed, scenes: [{ ...sceneSeed, durationSec: 10, voiceover: "Updated narration" }] }),
		),
		views = fromTimelineDoc(next);
	expect(views.audioOverlays[0]).toMatchObject(audio);
	expect(views.videoOverlays[0]).toMatchObject({ volume: 0.6, mediaStartSec: 1, layout });
	expect(views.scenes[0]?.visualClips?.[0]).toEqual(
		fromTimelineDoc(original).scenes[0]?.visualClips?.[0],
	);
	expect(views.scenes[0]?.vo).toBe("Updated narration");
	expect(views.scenes[0]?.dur).toBe(10);
	expect(sourceAudioBlockers(next)).toEqual([]);
});

test("agent write rejects malformed ordinary gain keys instead of persisting ignored controls", () => {
	expect(() =>
		agentEditorViews(
			job({
				audioOverlays: [
					{
						id: 1,
						kind: "music",
						content: "",
						url: "bed.wav",
						startSec: 0,
						durationSec: 4,
						animation: { tracks: { volume: [{ t: 0, v: 2 }] } },
					},
				],
			}),
		),
	).toThrow();
});
