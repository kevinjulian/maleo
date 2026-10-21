import { describe, expect, it } from "bun:test";
import { seedChapters } from "@maleo/shared";
import { agentTimelineDoc } from "../modules/agents/core/document.ts";
import {
	buildStoryAccentHits,
	buildStoryAudioOverlays,
	buildStoryMusicBed,
	buildStorySceneAccentHits,
	buildStoryScenes,
	buildStoryTitleOverlays,
	singleMusicSpan,
	STORY_ACCENT_VOLUME,
	STORY_SECTION_TRANSITIONS,
	STORY_SHOT_TRANSITION,
	storySectionTransition,
	estimateDurationFromWords,
	storyTotalDurationSec,
	STORY_MUSIC_FADE_SEC,
	STORY_TIMELINE_LANES,
	STORY_TITLE_MAX_SEC,
	STORY_TITLE_PRESET,
	invalidateEstimatedVoiceWindows,
	measureWavDurationSec,
	measureAudioDurationSec,
	narrationSegmentsForShots,
	buildStoryVisualSegments,
	storyPlanTableRows,
	placeSections,
	planNarrationSynthesis,
	splitStoryVoiceSegments,
	splitMeasuredNarration,
	splitNarrationForResynthesis,
	type StorySection,
} from "./story.ts";

const sec = (id: string, over: Partial<StorySection> = {}): StorySection => ({
	id,
	title: `Section ${id}`,
	narration: `Narration ${id} with several words here`,
	visualPrompt: `Visual ${id}`,
	estimatedDurationSec: 99, // deliberately wrong — must never be used as timing
	...over,
});

describe("placeSections — timing driven by measured audio", () => {
	it("keeps generation-unit ids separate from chapter identity", () => {
		const scenes = buildStoryScenes(
			[
				sec("beat-a", { sectionId: "section-a", semanticBeatId: "beat-a", audioDurationSec: 2 }),
				sec("beat-b", { sectionId: "section-a", semanticBeatId: "beat-b", audioDurationSec: 2 }),
			],
			0,
		);
		expect(scenes.map((scene) => [scene.sectionId, scene.storyBeatId])).toEqual([
			["section-a", "beat-a"],
			["section-a", "beat-b"],
		]);
	});

	it("starts each section at the previous section's audio end", () => {
		const placed = placeSections(
			[
				sec("a", { audioDurationSec: 3, audioUrl: "/a.wav", imageUrl: "/a.png" }),
				sec("b", { audioDurationSec: 5, audioUrl: "/b.wav", imageUrl: "/b.png" }),
				sec("c", { audioDurationSec: 4, audioUrl: "/c.wav", imageUrl: "/c.png" }),
			],
			0,
		);
		expect(placed.map((s) => s.startSec)).toEqual([0, 3, 8]);
	});

	it("ignores the word-count estimate entirely for timing", () => {
		const [a] = placeSections([sec("a", { audioDurationSec: 3 })], 0);
		expect(a.startSec).toBe(0);
		// estimatedDurationSec is 99 but real duration is 3.
		expect(storyTotalDurationSec([sec("a", { audioDurationSec: 3 })], 0)).toBe(3);
	});

	it("regenerated audio resyncs starts + image durations", () => {
		const base = [
			sec("a", { audioDurationSec: 3 }),
			sec("b", { audioDurationSec: 5 }),
			sec("c", { audioDurationSec: 4 }),
		];
		// Section b re-recorded → 10s. Everything after shifts.
		const resynced = base.map((s) => (s.id === "b" ? { ...s, audioDurationSec: 10 } : s));
		expect(placeSections(resynced, 0).map((s) => s.startSec)).toEqual([0, 3, 13]);
		const scenes = buildStoryScenes(resynced, 0);
		expect(scenes.map((s) => s.durationSec)).toEqual([3, 10, 4]);
		expect(storyTotalDurationSec(resynced, 0)).toBe(17);
	});
});

describe("scene-aligned voiceover pacing", () => {
	it("groups whole sentences across visual shots", () => {
		expect(
			narrationSegmentsForShots("One starts. Two continues. Three lands. Four closes.", 3),
		).toEqual(["One starts. Two continues.", "Three lands.", "Four closes."]);
	});

	it("plans semantic TTS files and never slices legacy audio by estimated timing", () => {
		const text =
			"Stop chasing everything you do not have. Notice your healthy body and people who care. Happiness does not mean life without problems.";
		const parts = splitMeasuredNarration(text, 16.3, 8);
		expect(parts.length).toBeGreaterThan(2);
		expect(parts.every((part) => part.durationSec <= 8)).toBe(true);
		expect(parts.reduce((sum, part) => sum + part.durationSec, 0)).toBeCloseTo(16.3, 2);
		expect(parts.map((part) => part.text).join(" ")).toBe(text);

		const planned = planNarrationSynthesis(text, 4);
		expect(planned.length).toBeGreaterThan(1);
		expect(planned.map((part) => part.text).join(" ")).toBe(text);
		const retries = splitNarrationForResynthesis(
			"First sentence ends. Second sentence lands.",
			8,
			4,
		);
		expect(retries.map((part) => part.text)).toEqual([
			"First sentence ends.",
			"Second sentence lands.",
		]);

		const voice = splitStoryVoiceSegments(
			[{ text, audioUrl: "/long.wav", audioDurationSec: 16.3 }],
			8,
		);
		expect(voice).toHaveLength(1);
		expect(voice[0]).toMatchObject({
			audioUrl: "/long.wav",
			audioDurationSec: 16.3,
			sourceDurationSec: 16.3,
			mediaStartSec: 0,
		});
	});

	it("invalidates legacy estimated windows but preserves reusable images", () => {
		const section = sec("legacy", {
			status: "ready",
			audioUrl: "/legacy.wav",
			audioDurationSec: 16,
			imageUrl: "/frame.png",
			imageUrls: ["/frame.png"],
			voiceSegments: [
				{
					text: "First",
					audioUrl: "/legacy.wav",
					audioDurationSec: 8,
					sourceDurationSec: 16,
					mediaStartSec: 0,
				},
				{
					text: "Second",
					audioUrl: "/legacy.wav",
					audioDurationSec: 8,
					sourceDurationSec: 16,
					mediaStartSec: 8,
				},
			],
		});
		expect(invalidateEstimatedVoiceWindows(section)).toBe(true);
		expect(section).toMatchObject({
			status: "pending",
			imageUrl: "/frame.png",
			imageUrls: ["/frame.png"],
		});
		expect(section.audioUrl).toBeUndefined();
		expect(section.audioDurationSec).toBeUndefined();
		expect(section.voiceSegments).toBeUndefined();
		expect(
			invalidateEstimatedVoiceWindows(
				sec("whole", {
					voiceSegments: [
						{
							text: "Whole",
							audioUrl: "/whole.wav",
							audioDurationSec: 4,
							sourceDurationSec: 4,
							mediaStartSec: 0,
						},
					],
				}),
			),
		).toBe(false);
	});

	it("adds breathing only at sentence and planned sub-section boundaries", () => {
		const sentence = splitStoryVoiceSegments(
			[
				{
					text: "One sentence ends.",
					audioUrl: "/sentence-1.wav",
					audioDurationSec: 4,
					pauseAfterSec: 0.15,
				},
				{ text: "Two sentence lands.", audioUrl: "/sentence-2.wav", audioDurationSec: 4 },
			],
			4,
			0.35,
			0.15,
		);
		expect(sentence).toHaveLength(2);
		expect(sentence.map((part) => part.pauseAfterSec)).toEqual([0.15, 0]);

		const technical = splitStoryVoiceSegments(
			[
				{
					text: "one two three four",
					audioUrl: "/technical-1.wav",
					audioDurationSec: 4,
					pauseAfterSec: 0,
				},
				{ text: "five six seven eight", audioUrl: "/technical-2.wav", audioDurationSec: 4 },
			],
			4,
			0.35,
			0.15,
		);
		expect(technical).toHaveLength(2);
		expect(technical.map((part) => part.pauseAfterSec)).toEqual([0, 0]);

		const subsection = splitStoryVoiceSegments(
			[
				{ text: "First planned beat.", audioUrl: "/one.wav", audioDurationSec: 2 },
				{ text: "Second planned beat.", audioUrl: "/two.wav", audioDurationSec: 2 },
			],
			4,
			0.35,
			0.15,
		);
		expect(subsection.map((part) => part.pauseAfterSec)).toEqual([0.35, 0]);
	});

	it("holds visuals, shifts captions, and keeps music through a sentence breath", () => {
		const voice = splitStoryVoiceSegments(
			[
				{
					text: "One sentence ends.",
					audioUrl: "/sentence-1.wav",
					audioDurationSec: 4,
					pauseAfterSec: 0.15,
					captionWords: [{ text: "One", startSec: 0, endSec: 0.4 }],
				},
				{
					text: "Two sentence lands.",
					audioUrl: "/sentence-2.wav",
					audioDurationSec: 4,
					captionWords: [{ text: "Two", startSec: 0, endSec: 0.4 }],
				},
			],
			4,
			0.35,
			0.15,
		);
		const visuals = buildStoryVisualSegments(voice, 10);
		const section = sec("sentence-gap", {
			narration: "One sentence ends. Two sentence lands.",
			audioUrl: "/sentence.wav",
			audioDurationSec: 8.15,
			voiceSegments: voice,
			visualSegments: visuals,
			imageUrls: ["/one.png", "/two.png"],
		});
		const scenes = buildStoryScenes([section], 0);
		const audio = buildStoryAudioOverlays([section], "Kore", 1000, 0);
		const [music] = buildStoryMusicBed([section], singleMusicSpan([section], "/bed.mp3"), {
			pauseSec: 0,
		});

		expect(scenes.map((scene) => scene.durationSec)).toEqual([4.15, 4]);
		expect(audio.map((clip) => [clip.startSec, clip.durationSec])).toEqual([
			[0, 4],
			[4.15, 4],
		]);
		expect(audio[0]?.words?.at(-1)?.endSec).toBeLessThanOrEqual(4);
		expect(audio[1]?.words?.[0]?.startSec).toBe(4.15);
		expect(music.durationSec).toBe(8.15);
	});

	it("splits visuals independently and keeps exact narration as timing metadata", () => {
		const voice = splitStoryVoiceSegments(
			[
				{
					text: "Stop chasing everything you do not have. Notice your healthy body and people who care.",
					audioUrl: "/long.wav",
					audioDurationSec: 10,
				},
			],
			12,
		);
		const visuals = buildStoryVisualSegments(voice, 4);
		expect(voice).toHaveLength(1);
		expect(visuals.length).toBeGreaterThan(voice.length);
		expect(visuals.every((part) => part.durationSec <= 4 && part.text.length > 0)).toBe(true);
		// Beats carry the narration they illustrate and nothing else — what they SHOW
		// is authored per beat afterwards, once this count is known.
		expect(visuals.every((part) => part.visualPrompt === "")).toBe(true);
		expect(visuals.reduce((sum, part) => sum + part.durationSec, 0)).toBeCloseTo(10, 2);
	});

	it("creates separate voiceover clips with configurable silence between scenes", () => {
		const section = sec("paced", {
			narration: "One starts. Two lands.",
			audioUrl: "/one.wav",
			audioDurationSec: 4.4,
			imageUrls: ["/one.png", "/two.png"],
			visualPrompts: ["One", "Two"],
			sceneVoiceoverPauseSec: 0.4,
			voiceSegments: [
				{ text: "One starts.", audioUrl: "/one.wav", audioDurationSec: 2 },
				{ text: "Two lands.", audioUrl: "/two.wav", audioDurationSec: 2 },
			],
		});
		const scenes = buildStoryScenes([section], 0);
		const audio = buildStoryAudioOverlays([section], "Kore", 1000, 0);
		expect(scenes.map((scene) => [scene.durationSec, scene.voiceover])).toEqual([
			[2.4, "One starts."],
			[2, "Two lands."],
		]);
		expect(audio.map((clip) => [clip.startSec, clip.durationSec, clip.content])).toEqual([
			[0, 2, "One starts."],
			[2.4, 2, "Two lands."],
		]);
		expect(audio.every((clip) => clip.track === STORY_TIMELINE_LANES.voiceover)).toBe(true);
	});
});

describe("inter-section pause — a breath between sections", () => {
	const sections = [
		sec("a", { audioDurationSec: 3, audioUrl: "/a.wav", imageUrl: "/a.png" }),
		sec("b", { audioDurationSec: 5, audioUrl: "/b.wav", imageUrl: "/b.png" }),
		sec("c", { audioDurationSec: 4, audioUrl: "/c.wav", imageUrl: "/c.png" }),
	];
	it("shifts each section start by the cumulative pause (none after the last)", () => {
		// 0; 0+3+0.6=3.6; 3.6+5+0.6=9.2
		expect(placeSections(sections, 0.6).map((s) => s.startSec)).toEqual([0, 3.6, 9.2]);
	});
	it("holds each section's last visual through the pause, except the last section", () => {
		// Single image per section → that lone shot absorbs the pause hold.
		const scenes = buildStoryScenes(sections, 0.6);
		expect(scenes.map((s) => s.durationSec)).toEqual([3.6, 5.6, 4]);
	});
	it("keeps the voiceover overlay at its real duration (gap stays silent)", () => {
		const audio = buildStoryAudioOverlays(sections, "Kore", 1000, 0.6);
		expect(audio.map((a) => a.startSec)).toEqual([0, 3.6, 9.2]);
		expect(audio.map((a) => a.durationSec)).toEqual([3, 5, 4]); // unchanged — real audio
	});
	it("total duration includes the inter-section pauses but no trailing pause", () => {
		// 3 + 0.6 + 5 + 0.6 + 4 = 13.2
		expect(storyTotalDurationSec(sections, 0.6)).toBe(13.2);
	});
	it("scenes pack to the shifted audio starts (visual stays aligned)", () => {
		const scenes = buildStoryScenes(sections, 0.6);
		const audio = buildStoryAudioOverlays(sections, "Kore", 1000, 0.6);
		let cursor = 0;
		const sceneStarts = scenes.map((s) => {
			const at = cursor;
			cursor += s.durationSec;
			return at;
		});
		expect(sceneStarts).toEqual(audio.map((a) => a.startSec));
	});
	it("holds each section visual before narration during its lead-in", () => {
		const scenes = buildStoryScenes(sections, 0.6, 0.8);
		const audio = buildStoryAudioOverlays(sections, "Kore", 1000, 0.6, 0.8);
		expect(audio.map((a) => a.startSec)).toEqual([0.8, 5.2, 11.6]);
		expect(audio.every((a) => a.track === 0)).toBe(true);
		expect(scenes[0]?.durationSec).toBe(4.4);
		expect(scenes[1]?.durationSec).toBe(6.4);
		expect(storyTotalDurationSec(sections, 0.6, 0.8)).toBe(15.6);
	});
});

describe("buildStoryMusicBed — one bed spanning the placed timeline", () => {
	const sections = [
		sec("a", { audioDurationSec: 3, audioUrl: "/a.wav", imageUrl: "/a.png" }),
		sec("b", { audioDurationSec: 5, audioUrl: "/b.wav", imageUrl: "/b.png" }),
	];
	it("returns [] when no music url is available", () => {
		expect(buildStoryMusicBed(sections, singleMusicSpan(sections, undefined))).toEqual([]);
	});
	it("returns [] when nothing is placed yet", () => {
		const unplaced = [sec("x")];
		expect(buildStoryMusicBed(unplaced, singleMusicSpan(unplaced, "/bed.mp3"))).toEqual([]);
	});
	it("spans the full timeline including inter-section pauses", () => {
		// total with default pause = 3 + 0.6 + 5 = 8.6
		const [bed] = buildStoryMusicBed(sections, singleMusicSpan(sections, "/bed.mp3"));
		expect(bed.kind).toBe("music");
		expect(bed.url).toBe("/bed.mp3");
		expect(bed.startSec).toBe(0);
		expect(bed.durationSec).toBe(8.6);
		expect(bed.track).toBe(2);
		expect(bed.volume).toBe(1);
	});
	it("respects an explicit pauseSec for the span", () => {
		const [bed] = buildStoryMusicBed(sections, singleMusicSpan(sections, "/bed.mp3"), {
			pauseSec: 0,
		});
		expect(bed.durationSec).toBe(8); // 3 + 5, no pause
	});
	it("caps the fade to a quarter of very short videos", () => {
		const short = [sec("a", { audioDurationSec: 2, audioUrl: "/a.wav", imageUrl: "/a.png" })];
		const [bed] = buildStoryMusicBed(short, singleMusicSpan(short, "/bed.mp3"), { pauseSec: 0 });
		expect(bed.fadeIn).toBe(0.5); // min(1.5, 2/4)
		expect(bed.fadeOut).toBe(0.5);
	});
	it("uses the full fade on long videos", () => {
		const [bed] = buildStoryMusicBed(sections, singleMusicSpan(sections, "/bed.mp3"));
		expect(bed.fadeIn).toBe(STORY_MUSIC_FADE_SEC);
	});
});

describe("storyPlanTableRows — emotion label", () => {
	it("labels a section that carries an emotion", () => {
		const [row] = storyPlanTableRows([sec("a", { audioDurationSec: 3, emotion: "tension" })]);
		expect(row!.content).toContain("[tension]");
	});

	it("leaves a section without an emotion exactly as before", () => {
		const [row] = storyPlanTableRows([sec("a", { audioDurationSec: 3 })]);
		expect(row!.content).toBe("Section a — Narration a with several words here");
	});

	it("keeps the status tag alongside the emotion", () => {
		const [row] = storyPlanTableRows([
			sec("a", { audioDurationSec: 3, status: "ready", emotion: "hope" }),
		]);
		expect(row!.content).toContain("[ready]");
		expect(row!.content).toContain("[hope]");
	});

	it("renders a mixed plan without disturbing timing", () => {
		const rows = storyPlanTableRows([
			sec("a", { audioDurationSec: 3, emotion: "calm" }),
			sec("b", { audioDurationSec: 5 }),
		]);
		expect(rows[0]!.content).toContain("[calm]");
		expect(rows[1]!.content).not.toContain("[");
		expect(rows[1]!.startSec).toBe(3);
	});
});

describe("storyPlanTableRows — the section's job in the arc", () => {
	it("shows the chapter function and its obligation", () => {
		const [row] = storyPlanTableRows([
			sec("a", {
				audioDurationSec: 3,
				chapterFunction: "midpoint_turn",
				chapterObligation: "Reframe what came before.",
			}),
		]);
		expect(row!.content).toContain("[midpoint_turn]");
		expect(row!.content).toContain("(Reframe what came before.)");
	});

	it("marks a slot that never drafted", () => {
		const [row] = storyPlanTableRows([
			sec("a", { audioDurationSec: 3, chapterFunction: "setup", needsDrafting: true }),
		]);
		expect(row!.content).toContain("[needs drafting]");
	});

	it("leaves a section with no arc fields exactly as before", () => {
		const [row] = storyPlanTableRows([sec("a", { audioDurationSec: 3 })]);
		expect(row!.content).toBe("Section a — Narration a with several words here");
	});
});

describe("buildStoryMusicBed — one bed per resolved span", () => {
	// Four sections, 3s + 5s + 4s + 6s, no pause: spans at 0, 3, 8, 12; total 18.
	const sections = [
		sec("a", { audioDurationSec: 3, audioUrl: "/a.wav", imageUrl: "/a.png" }),
		sec("b", { audioDurationSec: 5, audioUrl: "/b.wav", imageUrl: "/b.png" }),
		sec("c", { audioDurationSec: 4, audioUrl: "/c.wav", imageUrl: "/c.png" }),
		sec("d", { audioDurationSec: 6, audioUrl: "/d.wav", imageUrl: "/d.png" }),
	];

	it("places one overlay per span, covering the timeline without gaps", () => {
		const beds = buildStoryMusicBed(
			sections,
			[
				{ url: "/calm.mp3", fromIndex: 0, toIndex: 1 },
				{ url: "/tense.mp3", fromIndex: 2, toIndex: 3 },
			],
			{ pauseSec: 0 },
		);
		expect(beds).toHaveLength(2);
		expect(beds[0]!.url).toBe("/calm.mp3");
		expect(beds[0]!.startSec).toBe(0);
		expect(beds[0]!.durationSec).toBe(8); // 3 + 5
		expect(beds[1]!.url).toBe("/tense.mp3");
		expect(beds[1]!.startSec).toBe(8);
		expect(beds[1]!.durationSec).toBe(10); // 4 + 6
	});

	it("gives every bed a distinct overlay id", () => {
		const beds = buildStoryMusicBed(
			sections,
			[
				{ url: "/calm.mp3", fromIndex: 0, toIndex: 1 },
				{ url: "/tense.mp3", fromIndex: 2, toIndex: 3 },
			],
			{ pauseSec: 0 },
		);
		expect(new Set(beds.map((b) => b.id)).size).toBe(beds.length);
	});

	it("keeps every bed on the music lane", () => {
		const beds = buildStoryMusicBed(
			sections,
			[
				{ url: "/calm.mp3", fromIndex: 0, toIndex: 1 },
				{ url: "/tense.mp3", fromIndex: 2, toIndex: 3 },
			],
			{ pauseSec: 0 },
		);
		expect(beds.every((b) => b.track === STORY_TIMELINE_LANES.music)).toBe(true);
	});

	it("does not overlap adjacent beds", () => {
		const beds = buildStoryMusicBed(
			sections,
			[
				{ url: "/calm.mp3", fromIndex: 0, toIndex: 1 },
				{ url: "/tense.mp3", fromIndex: 2, toIndex: 3 },
			],
			{ pauseSec: 0 },
		);
		for (let i = 1; i < beds.length; i++) {
			const prevEnd = beds[i - 1]!.startSec + beds[i - 1]!.durationSec;
			expect(beds[i]!.startSec).toBeGreaterThanOrEqual(prevEnd);
		}
	});

	it("fades each bed at its own boundaries", () => {
		const beds = buildStoryMusicBed(
			sections,
			[
				{ url: "/calm.mp3", fromIndex: 0, toIndex: 1 },
				{ url: "/tense.mp3", fromIndex: 2, toIndex: 3 },
			],
			{ pauseSec: 0 },
		);
		expect(beds[0]!.fadeOut).toBeGreaterThan(0);
		expect(beds[1]!.fadeIn).toBeGreaterThan(0);
	});

	it("skips a span whose cue did not resolve", () => {
		const beds = buildStoryMusicBed(
			sections,
			[
				{ url: undefined, fromIndex: 0, toIndex: 1 },
				{ url: "/tense.mp3", fromIndex: 2, toIndex: 3 },
			],
			{ pauseSec: 0 },
		);
		expect(beds).toHaveLength(1);
		expect(beds[0]!.startSec).toBe(8);
	});

	it("applies the template music volume to every bed", () => {
		const beds = buildStoryMusicBed(
			sections,
			[
				{ url: "/calm.mp3", fromIndex: 0, toIndex: 1 },
				{ url: "/tense.mp3", fromIndex: 2, toIndex: 3 },
			],
			{ pauseSec: 0, volume: 0.5 },
		);
		expect(beds.every((b) => b.volume === 0.5)).toBe(true);
	});
});

describe("buildStoryScenes — section provenance survives the flattening", () => {
	/* A plan is written in sections; the scenes generated from it are a flat list.
	 * This is the last place the two exist together, so it is the only place the
	 * section's identity can be recorded without reconstructing it downstream from
	 * a display string. */
	const sections = [
		sec("sec-1", {
			title: "Bangun di Lilin",
			audioDurationSec: 6,
			audioUrl: "/1.wav",
			imageUrls: ["/a.png", "/b.png"],
			visualPrompts: ["va", "vb"],
			narration: "One sentence. Two sentence.",
		}),
		sec("sec-2", {
			title: "Belajar Menari",
			audioDurationSec: 4,
			audioUrl: "/2.wav",
			imageUrl: "/c.png",
		}),
		sec("sec-3", {
			title: "Lapangan Bunga",
			audioDurationSec: 5,
			audioUrl: "/3.wav",
			imageUrl: "/d.png",
		}),
	];

	it("every scene records the section it came from", () => {
		expect(buildStoryScenes(sections).map((s) => s.sectionId)).toEqual([
			"sec-1",
			"sec-1",
			"sec-2",
			"sec-3",
		]);
	});

	it("only the first shot of a section is marked as its introduction", () => {
		// The title of a derived chapter comes from this marker. Without it a
		// correctly grouped run is still named positionally.
		expect(buildStoryScenes(sections).map((s) => s.sceneKind)).toEqual([
			"section_intro",
			undefined,
			"section_intro",
			"section_intro",
		]);
	});

	it("provenance is the section's id, not its title", () => {
		// Grouping on a display string would let a rename re-chapter the video.
		const renamed = sections.map((s) => ({ ...s, title: `${s.title} (rewritten)` }));
		expect(buildStoryScenes(renamed).map((s) => s.sectionId)).toEqual([
			"sec-1",
			"sec-1",
			"sec-2",
			"sec-3",
		]);
	});

	it("leaves sectionStart alone — it is pacing-local and means something else", () => {
		expect(buildStoryScenes(sections).map((s) => s.sectionStart)).toEqual([
			true,
			false,
			true,
			true,
		]);
	});

	it("survives the whole path: plan → scenes → document → chapters", () => {
		/* The end-to-end assertion the gap survived without. Every layer below was
		 * already correct — the wire declared `sectionId`, the document carried it,
		 * `seedChapters` consumed it — and nothing asserted that anything PRODUCED
		 * it, so a video generated from four sections rendered as one chapter. */
		const doc = agentTimelineDoc({
			id: "job",
			projectId: "p1",
			contentType: "video",
			status: "running",
			events: [],
			scenes: buildStoryScenes(sections),
			textOverlays: [],
			infographicOverlays: [],
			videoOverlays: [],
			audioOverlays: [],
			characters: [],
			artifacts: [],
			aspect: "9:16",
			brief: "b",
			startedAt: 0,
		});
		const docScenes = doc.clips.flatMap((c) => (c.scene ? [c.scene] : []));
		const chapters = seedChapters(docScenes, null).chapters;

		expect(chapters.map((c) => c.id)).toEqual(["sec-1", "sec-2", "sec-3"]);
		expect(chapters.map((c) => c.title)).toEqual([
			"Bangun di Lilin",
			"Belajar Menari",
			"Lapangan Bunga",
		]);
		// 2 / 1 / 1 — the grouping the plan described, not one chapter for the lot.
		expect(docScenes.filter((s) => s.sectionId === "sec-1")).toHaveLength(2);
	});
});

describe("buildStoryScenes — section-boundary transitions", () => {
	const sections = [
		sec("a", { audioDurationSec: 4, audioUrl: "/a.wav", imageUrl: "/a.png" }),
		sec("b", {
			audioDurationSec: 6,
			audioUrl: "/b.wav",
			imageUrls: ["/b1.png", "/b2.png"],
			visualPrompts: ["vb1", "vb2"],
			narration: "First sentence here. Second sentence there.",
		}),
		sec("c", { audioDurationSec: 3, audioUrl: "/c.wav", imageUrl: "/c.png" }),
	];
	it("uses a rotating chapter transition at boundaries and the gentle one within a section", () => {
		const scenes = buildStoryScenes(sections);
		// a(1 shot)→boundary, b shot1→intra, b shot2→boundary, c(last)→unused/gentle
		expect(scenes.map((s) => s.transition)).toEqual([
			storySectionTransition(0),
			STORY_SHOT_TRANSITION,
			storySectionTransition(1),
			STORY_SHOT_TRANSITION,
		]);
		// Consecutive boundaries never repeat the same move.
		expect(storySectionTransition(0)).not.toBe(storySectionTransition(1));
	});
	it("rotates deterministically through the section-transition pool", () => {
		const n = STORY_SECTION_TRANSITIONS.length;
		expect(storySectionTransition(0)).toBe(STORY_SECTION_TRANSITIONS[0]!);
		expect(storySectionTransition(n)).toBe(STORY_SECTION_TRANSITIONS[0]!);
		expect(storySectionTransition(n + 1)).toBe(STORY_SECTION_TRANSITIONS[1]!);
	});
	it("can make every scene static and override every transition", () => {
		const scenes = buildStoryScenes(sections, 0.6, 0, {
			staticMovement: true,
			transition: "pixel",
		});
		expect(scenes.every((scene) => scene.move === "Static")).toBe(true);
		expect(scenes.every((scene) => scene.transition === "pixel")).toBe(true);
	});
});

describe("buildStorySceneAccentHits — internal scene entries only", () => {
	const sections = [
		sec("a", {
			audioDurationSec: 4,
			imageUrls: ["/a1.png", "/a2.png"],
			visualPrompts: ["a1", "a2"],
			narration: "First scene. Second scene.",
		}),
		sec("b", {
			audioDurationSec: 6,
			imageUrls: ["/b1.png", "/b2.png"],
			visualPrompts: ["b1", "b2"],
			narration: "Third scene. Fourth scene.",
		}),
	];
	it("skips opening and section boundaries", () => {
		const scenes = buildStoryScenes(sections, 0.6);
		const hits = buildStorySceneAccentHits(scenes, "/scene.wav", { volume: 0.4 });
		expect(hits.map((hit) => hit.startSec)).toEqual([2, 7.6]);
		expect(hits.every((hit) => hit.kind === "sfx" && hit.track === 1 && hit.volume === 0.4)).toBe(
			true,
		);
	});
	it("returns empty when scene cue is disabled", () => {
		expect(buildStorySceneAccentHits(buildStoryScenes(sections), undefined)).toEqual([]);
	});
});

describe("buildStoryAccentHits — stinger per boundary", () => {
	const sections = [
		sec("a", { audioDurationSec: 3, audioUrl: "/a.wav", imageUrl: "/a.png" }),
		sec("b", { audioDurationSec: 5, audioUrl: "/b.wav", imageUrl: "/b.png" }),
		sec("c", { audioDurationSec: 4, audioUrl: "/c.wav", imageUrl: "/c.png" }),
	];
	it("returns [] without an accent url", () => {
		expect(buildStoryAccentHits(sections, undefined)).toEqual([]);
	});
	it("returns [] with at most one placed section (no boundary)", () => {
		expect(buildStoryAccentHits([sections[0]], "/hit.wav")).toEqual([]);
	});
	it("emits one hit per boundary (sections 2..N), never before the first word", () => {
		const hits = buildStoryAccentHits(sections, "/hit.wav");
		expect(hits.length).toBe(2);
		// starts at section b and c boundaries (pause-shifted): 3.6, 9.2
		expect(hits.map((h) => h.startSec)).toEqual([3.6, 9.2]);
		expect(hits.every((h) => h.kind === "accent_hit" && h.url === "/hit.wav")).toBe(true);
		expect(hits.every((h) => h.volume === STORY_ACCENT_VOLUME)).toBe(true);
	});
	it("uses one template-resolved url for every boundary", () => {
		const hits = buildStoryAccentHits(sections, ["/whoosh.wav", "/riser.wav"]);
		expect(hits.map((h) => h.url)).toEqual(["/whoosh.wav", "/whoosh.wav"]);
	});
	it("places template SFX on every section with reserved lane and editable defaults", () => {
		const hits = buildStoryAccentHits(sections, ["/whoosh.wav", "/riser.wav"], {
			includeFirst: true,
			leadInSec: 0.8,
			offsetSec: 0.2,
			volume: 0.35,
		});
		expect(hits.map((h) => h.url)).toEqual(["/whoosh.wav", "/whoosh.wav", "/whoosh.wav"]);
		expect(hits.map((h) => h.startSec)).toEqual([0.2, 4.6, 11]);
		expect(hits.every((h) => h.track === 1 && h.volume === 0.35)).toBe(true);
	});
	it("returns [] for an empty pool", () => {
		expect(buildStoryAccentHits(sections, [])).toEqual([]);
	});
});

describe("buildStoryTitleOverlays — chapter beat per section", () => {
	const sections = [
		sec("a", { audioDurationSec: 10, audioUrl: "/a.wav", imageUrl: "/a.png" }),
		sec("b", { audioDurationSec: 5, audioUrl: "/b.wav", imageUrl: "/b.png" }),
		sec("c", { audioDurationSec: 2, audioUrl: "/c.wav", imageUrl: "/c.png" }),
	];
	it("emits one card per placed section at its shifted start", () => {
		const cards = buildStoryTitleOverlays(sections);
		expect(cards.map((c) => c.content)).toEqual(["Section a", "Section b", "Section c"]);
		// starts shift by the inter-section pause: 0, 10.6, 16.2
		expect(cards.map((c) => c.startSec)).toEqual([0, 10.6, 16.2]);
	});
	it("uses stable ids, reserved lane, lead-in, and section policy", () => {
		const cards = buildStoryTitleOverlays(sections, {
			leadInSec: 0.8,
			policy: "first_only",
			durationSec: 2.5,
			introPreset: "section-card",
		});
		expect(cards).toHaveLength(1);
		expect(cards[0]).toMatchObject({
			id: 51_000_000,
			startSec: 0,
			durationSec: 2.5,
			preset: "section-card",
			track: 3,
		});
	});
	it("starts every section title at that section's silent lead-in", () => {
		const cards = buildStoryTitleOverlays(sections, { leadInSec: 0.8 });
		expect(cards.map((card) => card.startSec)).toEqual([0, 11.4, 17.8]);
	});

	it("honors an explicit uncapped template title duration", () => {
		const cards = buildStoryTitleOverlays(sections, { durationSec: 30 });
		expect(cards.every((card) => card.durationSec === 30)).toBe(true);
	});
	it("uses the strong chapter preset", () => {
		expect(buildStoryTitleOverlays(sections).every((c) => c.preset === STORY_TITLE_PRESET)).toBe(
			true,
		);
	});
	it("caps the dwell, but never exceeds a short section's own audio", () => {
		const cards = buildStoryTitleOverlays(sections);
		expect(cards[0].durationSec).toBe(STORY_TITLE_MAX_SEC); // 10s section → capped at 4
		expect(cards[2].durationSec).toBe(2); // 2s section → clamped to its audio
	});
});

describe("pending sections (failed TTS) don't corrupt the timeline", () => {
	const sections = [
		sec("a", { audioDurationSec: 3, audioUrl: "/a.wav", imageUrl: "/a.png" }),
		sec("b"), // TTS failed — no audioDurationSec
		sec("c", { audioDurationSec: 4, audioUrl: "/c.wav", imageUrl: "/c.png" }),
	];
	it("excludes the pending section but keeps the rest contiguous", () => {
		const placed = placeSections(sections, 0);
		expect(placed[1].startSec).toBeUndefined();
		expect(placed[0].startSec).toBe(0);
		expect(placed[2].startSec).toBe(3); // cursor only advanced by section a
	});
	it("builds scenes only for placed sections", () => {
		const scenes = buildStoryScenes(sections, 0);
		expect(scenes).toHaveLength(2);
		expect(scenes.map((s) => s.name)).toEqual(["Section a", "Section c"]);
	});
	it("total duration ignores the pending section", () => {
		expect(storyTotalDurationSec(sections, 0)).toBe(7);
	});
});

describe("buildStoryScenes — schemaVersion 2 alignment", () => {
	const sections = [
		sec("a", { audioDurationSec: 3.5, audioUrl: "/a.wav", imageUrl: "/a.png" }),
		sec("b", { audioDurationSec: 6, audioUrl: "/b.wav", imageUrl: "/b.png" }),
	];
	it("image clip duration equals its audio duration, voiceover overlay aligned", () => {
		const scenes = buildStoryScenes(sections, 0);
		const audio = buildStoryAudioOverlays(sections, "Kore", 1000, 0);
		// Scene durations = measured audio; scenes pack to the audio cursor.
		expect(scenes.map((s) => s.durationSec)).toEqual([3.5, 6]);
		expect(scenes.map((s) => s.image)).toEqual(["/a.png", "/b.png"]);
		expect(placeSections(sections, 0).map((s) => s.startSec)).toEqual([0, 3.5]);
		// Voiceover overlays carry absolute matching timing + the chosen voice.
		expect(audio.map((a) => a.startSec)).toEqual([0, 3.5]);
		expect(audio.map((a) => a.durationSec)).toEqual([3.5, 6]);
		expect(audio.every((a) => a.voice === "Kore" && a.kind === "voiceover")).toBe(true);
		expect(audio.map((a) => a.url)).toEqual(["/a.wav", "/b.wav"]);
	});
	it("offsets section-local caption words onto the absolute voiceover overlay", () => {
		const audio = buildStoryAudioOverlays(
			[
				sec("a", {
					audioDurationSec: 3.5,
					audioUrl: "/a.wav",
					imageUrl: "/a.png",
					captionWords: [{ text: "hello", startSec: 0.2, endSec: 0.7 }],
				}),
				sec("b", {
					audioDurationSec: 6,
					audioUrl: "/b.wav",
					imageUrl: "/b.png",
					captionWords: [{ text: "world", startSec: 0.1, endSec: 0.4 }],
				}),
			],
			undefined,
			1000,
			0,
		);
		expect(audio[0]?.words).toEqual([{ text: "hello", startSec: 0.2, endSec: 0.7 }]);
		expect(audio[1]?.startSec).toBe(3.5);
		expect(audio[1]?.words).toEqual([{ text: "world", startSec: 3.6, endSec: 3.9 }]);
	});
	it("clips section caption words to the measured audio window", () => {
		const audio = buildStoryAudioOverlays([
			sec("a", {
				audioDurationSec: 2,
				audioUrl: "/a.wav",
				imageUrl: "/a.png",
				captionWords: [
					{ text: "ok", startSec: 0.2, endSec: 0.7 },
					{ text: "overflow", startSec: 1.8, endSec: 9 },
				],
			}),
		]);
		expect(audio[0]?.words).toEqual([
			{ text: "ok", startSec: 0.2, endSec: 0.7 },
			{ text: "overflow", startSec: 1.8, endSec: 2 },
		]);
	});
	it("total video duration equals the final audio end", () => {
		const total = storyTotalDurationSec(sections, 0);
		const lastEnd = 3.5 + 6;
		expect(total).toBe(lastEnd);
	});
});

describe("measureWavDurationSec", () => {
	/* Minimal valid WAV: byteRate + dataSize → duration = dataSize/byteRate.
	 *
	 * The data bytes are really allocated. They were not, which made this fixture
	 * declare audio it did not carry — the one shape a streaming encoder also
	 * produces, and the reason a five-second Kokoro clip once measured as
	 * twenty-four hours. The measurement now believes the bytes over the header,
	 * so a header-only stub is no longer a duration. The assertions below are
	 * unchanged; only the fixture became a file that could exist. */
	const makeWav = (byteRate: number, dataSize: number): Uint8Array => {
		const buf = new Uint8Array(44 + dataSize);
		const dv = new DataView(buf.buffer);
		const put = (off: number, s: string): void => {
			for (let i = 0; i < s.length; i++) buf[off + i] = s.charCodeAt(i);
		};
		put(0, "RIFF");
		dv.setUint32(4, 36 + dataSize, true);
		put(8, "WAVE");
		put(12, "fmt ");
		dv.setUint32(16, 16, true);
		dv.setUint16(20, 1, true);
		dv.setUint16(22, 1, true);
		dv.setUint32(24, 8000, true);
		dv.setUint32(28, byteRate, true);
		dv.setUint16(32, 1, true);
		dv.setUint16(34, 8, true);
		put(36, "data");
		dv.setUint32(40, dataSize, true);
		return buf;
	};
	it("computes duration from byte-rate and data size", () => {
		expect(measureWavDurationSec(makeWav(8000, 16000))).toBe(2);
		expect(measureWavDurationSec(makeWav(16000, 24000))).toBe(1.5);
	});
	it("returns null for non-WAV / junk", () => {
		expect(measureWavDurationSec(new Uint8Array(10))).toBeNull();
		expect(measureAudioDurationSec(new Uint8Array([1, 2, 3]), "mp3")).toBeNull();
	});
});

describe("estimateDurationFromWords (planning hint only)", () => {
	it("derives a positive estimate from word count", () => {
		expect(estimateDurationFromWords("one two three four five six")).toBeGreaterThan(0);
		expect(estimateDurationFromWords("")).toBe(1);
	});
});

describe("a section's citations reach its scene", () => {
	const EVIDENCE = [
		{
			url: "https://en.wikipedia.org/wiki/Heat_pump",
			quote: "takes in thermal energy at a low temperature",
		},
		{
			url: "https://engineering.purdue.edu/heat",
			quote: "must be smaller than the temperature of the cold reservoir",
		},
	];

	/* Without this the script view can never show a story plan's citations: the
	 * plan section holds validated {url, quote} pairs and the scene was dropping
	 * them, so `scene.sourceEvidence` was always empty on the narrated path even
	 * for a plan with 6/6 sections citation-verified. */
	it("carries validated evidence onto the section's scene", () => {
		const scenes = buildStoryScenes(
			[
				sec("a", {
					audioDurationSec: 4,
					audioUrl: "/a.wav",
					imageUrl: "/a.png",
					sourceEvidence: EVIDENCE,
				}),
			],
			0,
		);
		expect(scenes[0]?.sourceEvidence).toEqual(EVIDENCE);
	});

	/* A quote justifies NARRATION, and the narration rides shot 1 — the same rule
	 * `voiceover` follows. A later shot of the same section carries no words, so a
	 * citation there would be attached to nothing it supports. */
	it("puts the citation on the shot that carries the words, not on every shot", () => {
		const scenes = buildStoryScenes(
			[
				sec("a", {
					audioDurationSec: 12,
					audioUrl: "/a.wav",
					narration: "One sentence lands. Another follows it. A third closes the section.",
					visualPrompts: ["Shot one", "Shot two", "Shot three"],
					imageUrls: ["/1.png", "/2.png", "/3.png"],
					sourceEvidence: EVIDENCE,
				}),
			],
			0,
		);
		expect(scenes.length).toBeGreaterThan(1);
		expect(scenes[0]?.sourceEvidence).toEqual(EVIDENCE);
		for (const scene of scenes.slice(1)) expect(scene.sourceEvidence).toBeUndefined();
	});

	it("a section with no evidence leaves the field absent rather than empty", () => {
		const scenes = buildStoryScenes([sec("a", { audioDurationSec: 4, audioUrl: "/a.wav" })], 0);
		expect(scenes[0]?.sourceEvidence).toBeUndefined();
	});
});
