import { describe, expect, it } from "vite-plus/test";
import {
	ANIMATED_SYSTEMS_EXPLAINER_TEMPLATE,
	ANIMATED_SYSTEMS_EXPLAINER_TEMPLATE_ID,
	ANIMATED_SYSTEMS_EXPLAINER_TEMPLATE_SLUG,
	DEFAULT_MUSIC_EMOTION_CUES,
	DEFAULT_TIMELINE_TEMPLATE,
	TIMELINE_TEMPLATE_FIXTURES,
	timelineTemplateInputSchema,
} from "../src/timeline-template.ts";
import { EMOTIONS } from "../src/video-style.ts";

describe("timeline template scene controls", () => {
	it("keeps additive scene controls backward compatible", () => {
		const parsed = timelineTemplateInputSchema.parse({ name: "Legacy template" });
		expect(parsed.maxVisualBeatSec).toBe(6);
		expect(parsed.maxVoiceoverSegmentSec).toBe(8);
		expect(parsed.sceneEntrySfx).toBe("");
		expect(parsed.introEntrySfxUrl).toBe("");
		expect(parsed.sceneEntrySfxUrl).toBe("");
		expect(parsed.sentenceVoiceoverPauseSec).toBe(0.15);
		expect(parsed.sceneVoiceoverPauseSec).toBe(0.35);
		expect(parsed.staticSceneMovement).toBe(false);
		expect(parsed.overrideSceneTransition).toBe(false);
		expect(parsed.sceneTransition).toBe("fade");
	});

	it("validates independently editable pacing limits", () => {
		const parsed = timelineTemplateInputSchema.parse({
			name: "Fast",
			maxVisualBeatSec: 3.5,
			maxVoiceoverSegmentSec: 6,
		});
		expect(parsed.maxVisualBeatSec).toBe(3.5);
		expect(parsed.maxVoiceoverSegmentSec).toBe(6);
		expect(() =>
			timelineTemplateInputSchema.parse({ name: "Too fast", maxVisualBeatSec: 1 }),
		).toThrow();
	});

	it("accepts renderer transition vocabulary", () => {
		const parsed = timelineTemplateInputSchema.parse({
			name: "Override",
			overrideSceneTransition: true,
			sceneTransition: "clock_wipe",
		});
		expect(parsed.sceneTransition).toBe("clock_wipe");
	});

	it("rejects unsafe persisted SFX asset URLs", () => {
		expect(() =>
			timelineTemplateInputSchema.parse({ name: "Unsafe", introEntrySfxUrl: "file:///etc/passwd" }),
		).toThrow();
	});
});

describe("timeline template background music", () => {
	it("gives a template stored before the music fields existed the new defaults", () => {
		const parsed = timelineTemplateInputSchema.parse({ name: "Legacy template" });
		expect(parsed.musicCue).toBe("calm ambient background");
		expect(parsed.musicUrl).toBe("");
		expect(parsed.musicVolume).toBe(1);
		expect(parsed.musicPolicy).toBe("single");
	});

	it("gives a row stored before the palette existed the shipped cues, with no backfill", () => {
		// The key is absent from that row's persisted JSON, so the schema default
		// applies on read — which is the whole reason the default is the palette
		// rather than an empty object.
		const parsed = timelineTemplateInputSchema.parse({ name: "Legacy template" });
		expect(parsed.musicEmotionCues).toEqual(DEFAULT_MUSIC_EMOTION_CUES);
	});

	it("preserves a map the operator deliberately emptied", () => {
		// Saved by current code, so the key IS present and must not be re-seeded.
		const parsed = timelineTemplateInputSchema.parse({ name: "Deliberate", musicEmotionCues: {} });
		expect(parsed.musicEmotionCues).toEqual({});
	});

	it("does not let one template's map mutate the shipped palette", () => {
		const parsed = timelineTemplateInputSchema.parse({ name: "Legacy template" });
		parsed.musicEmotionCues.calm!.cue = "something else";
		expect(timelineTemplateInputSchema.parse({ name: "Another" }).musicEmotionCues.calm).toEqual(
			DEFAULT_MUSIC_EMOTION_CUES.calm,
		);
	});

	it("ships a cue for every emotion on the default template", () => {
		for (const emotion of EMOTIONS) {
			expect(DEFAULT_TIMELINE_TEMPLATE.musicEmotionCues[emotion]?.cue.trim()).toBeTruthy();
		}
	});

	it("keeps the default template on the single-bed policy so output is unchanged", () => {
		// The shipped palette must not alter anything until an operator opts in:
		// these two defaults are deliberately independent.
		expect(DEFAULT_TIMELINE_TEMPLATE.musicPolicy).toBe("single");
		expect(Object.keys(DEFAULT_TIMELINE_TEMPLATE.musicEmotionCues)).toHaveLength(EMOTIONS.length);
	});

	it("round-trips the default template through the schema unchanged", () => {
		expect(timelineTemplateInputSchema.parse(DEFAULT_TIMELINE_TEMPLATE)).toEqual(
			DEFAULT_TIMELINE_TEMPLATE,
		);
	});

	it("ships an animated systems explainer template identity", () => {
		const shipped = TIMELINE_TEMPLATE_FIXTURES.find(
			(fixture) => fixture.slug === ANIMATED_SYSTEMS_EXPLAINER_TEMPLATE_SLUG,
		);
		expect(shipped?.template).toEqual(ANIMATED_SYSTEMS_EXPLAINER_TEMPLATE);
		// The legacy id is what an existing row was seeded with, and what the migration
		// recognises so it can adopt that row instead of inserting a second one.
		expect(shipped?.legacyId).toBe(ANIMATED_SYSTEMS_EXPLAINER_TEMPLATE_ID);
		expect(timelineTemplateInputSchema.parse(ANIMATED_SYSTEMS_EXPLAINER_TEMPLATE)).toEqual(
			ANIMATED_SYSTEMS_EXPLAINER_TEMPLATE,
		);
		expect(ANIMATED_SYSTEMS_EXPLAINER_TEMPLATE.imageGuidancePrompt).toContain(
			"flat editorial animation",
		);
	});

	it("accepts a sparse emotion map and leaves unset emotions absent", () => {
		const parsed = timelineTemplateInputSchema.parse({
			name: "Sparse",
			musicEmotionCues: { tension: { cue: "dark driving pulse", url: "" } },
		});
		expect(parsed.musicEmotionCues.tension).toEqual({ cue: "dark driving pulse", url: "" });
		expect(parsed.musicEmotionCues.calm).toBeUndefined();
	});

	it("reads an entry stored as a bare cue string as a cue with no pinned asset", () => {
		const parsed = timelineTemplateInputSchema.parse({
			name: "Legacy entry",
			musicEmotionCues: { tension: "dark driving pulse" },
		});
		expect(parsed.musicEmotionCues.tension).toEqual({ cue: "dark driving pulse", url: "" });
	});

	it("keeps an auditioned track pinned to its emotion", () => {
		const parsed = timelineTemplateInputSchema.parse({
			name: "Pinned",
			musicEmotionCues: { hope: { cue: "hopeful ambient", url: "https://audio.test/hope.mp3" } },
		});
		expect(parsed.musicEmotionCues.hope!.url).toBe("https://audio.test/hope.mp3");
	});

	it("rejects an unsafe pinned url on an emotion entry", () => {
		expect(() =>
			timelineTemplateInputSchema.parse({
				name: "Unsafe",
				musicEmotionCues: { hope: { cue: "x", url: "file:///etc/passwd" } },
			}),
		).toThrow();
	});

	it("rejects an unknown emotion key", () => {
		expect(() =>
			timelineTemplateInputSchema.parse({ name: "Bad", musicEmotionCues: { euphoria: "bright" } }),
		).toThrow();
	});

	it("rejects an unknown music policy", () => {
		expect(() =>
			timelineTemplateInputSchema.parse({ name: "Bad", musicPolicy: "per_scene" }),
		).toThrow();
	});

	it("rejects an unsafe pinned music URL", () => {
		expect(() =>
			timelineTemplateInputSchema.parse({ name: "Unsafe", musicUrl: "file:///etc/passwd" }),
		).toThrow();
	});

	it("rejects a music volume outside the gain range", () => {
		expect(() => timelineTemplateInputSchema.parse({ name: "Loud", musicVolume: 1.5 })).toThrow();
	});
});
