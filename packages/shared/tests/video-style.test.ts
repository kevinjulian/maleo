import { describe, expect, test } from "vite-plus/test";
import {
	EMOTIONS,
	cameraForEmotion,
	transitionForContext,
	emotionForBeat,
	contextForBeats,
	emotionEnergy,
	overlayMotionForEmotion,
	rhythmTransition,
	autoTransitionForScenes,
	varyCamera,
	styleKnobsSchema,
	type CameraMove,
	type TransitionKind,
	type MusicMood,
	type StoryBeat,
} from "../src/video-style.ts";
import { PRESET_FIXTURES, findPresetFixture } from "../src/content-preset-builtins.ts";

/* Styles live on the builtin presets now — there is no registry to enumerate. */
const SHIPPED = PRESET_FIXTURES.map((p) => p.bundle.style!);
const knobs = (styleId: string) => findPresetFixture(styleId)!.bundle.style!;

// Renderer vocab — must stay in sync with @maleo/video. These literal sets
// guard against drift: every resolver output must be a value the renderer
// already accepts.
const CAMERA_MOVES: CameraMove[] = [
	"Static",
	"Slow Pan Left",
	"Slow Pan Right",
	"Slow Zoom In",
	"Slow Zoom Out",
	"Slight Push In",
	"Slight Pull Out",
	"Tilt Up",
	"Tilt Down",
	"Follow / Tracking",
	"Orbit",
	"Handheld",
	"Glitch",
];
const TRANSITIONS: TransitionKind[] = ["cut", "fade", "slide", "zoom", "wipe"];
const MUSIC_MOODS: MusicMood[] = ["upbeat", "chill", "luxury", "energetic", "minimal"];
const BEATS: StoryBeat[] = ["hook", "setup", "conflict", "twist", "resolution", "cta"];

describe("cameraForEmotion", () => {
	test("every emotion maps to a valid renderer camera move", () => {
		for (const e of EMOTIONS) {
			expect(CAMERA_MOVES).toContain(cameraForEmotion(e));
		}
	});

	test("low camera intensity softens energetic moves", () => {
		// shock -> Glitch normally, but a calm preset must not jolt.
		const calmPreset = { cameraIntensity: 0.2 };
		expect(cameraForEmotion("shock")).toBe("Glitch");
		expect(cameraForEmotion("shock", calmPreset)).not.toBe("Glitch");
		expect(CAMERA_MOVES).toContain(cameraForEmotion("shock", calmPreset));
	});

	test("high camera intensity keeps the expressive base move", () => {
		expect(cameraForEmotion("victory", { cameraIntensity: 0.9 })).toBe("Orbit");
	});
});

describe("transitionForContext", () => {
	test("every context maps to a valid renderer transition", () => {
		const contexts = [
			"same_location",
			"continuation",
			"time_skip",
			"reveal",
			"conflict",
			"memory",
			"ending",
		] as const;
		for (const c of contexts) {
			expect(TRANSITIONS).toContain(transitionForContext(c));
		}
	});

	test("high transition intensity sharpens a fade into a cut", () => {
		expect(transitionForContext("same_location")).toBe("fade");
		expect(transitionForContext("same_location", { transitionIntensity: 0.9 })).toBe("cut");
	});

	test("low transition intensity softens a cut into a fade", () => {
		expect(transitionForContext("conflict")).toBe("cut");
		expect(transitionForContext("conflict", { transitionIntensity: 0.1 })).toBe("fade");
	});
});

describe("emotionForBeat", () => {
	test("every beat resolves to a valid emotion", () => {
		for (const b of BEATS) {
			expect(EMOTIONS).toContain(emotionForBeat(b));
		}
	});

	test("twist is the shock beat", () => {
		expect(emotionForBeat("twist")).toBe("shock");
	});
});

describe("contextForBeats", () => {
	test("first scene (no previous beat) is a continuation", () => {
		expect(contextForBeats(undefined, "hook")).toBe("continuation");
	});

	test("a repeated beat reads as staying in place", () => {
		expect(contextForBeats("conflict", "conflict")).toBe("same_location");
	});

	test("arriving at a twist is a reveal", () => {
		expect(contextForBeats("conflict", "twist")).toBe("reveal");
	});

	test("output is always a transition-resolvable context", () => {
		// Round-trip: every contextForBeats result must resolve to a valid transition.
		const valid: TransitionKind[] = ["cut", "fade", "slide", "zoom", "wipe"];
		for (const prev of [undefined, ...BEATS]) {
			for (const next of BEATS) {
				expect(valid).toContain(transitionForContext(contextForBeats(prev, next)));
			}
		}
	});
});

describe("editing rhythm", () => {
	test("emotionEnergy ranks intense above calm", () => {
		expect(emotionEnergy("shock")).toBeGreaterThan(emotionEnergy("curiosity"));
		expect(emotionEnergy("curiosity")).toBeGreaterThan(emotionEnergy("calm"));
		for (const e of EMOTIONS) {
			expect(emotionEnergy(e)).toBeGreaterThanOrEqual(0);
			expect(emotionEnergy(e)).toBeLessThanOrEqual(1);
		}
	});

	test("rhythmTransition snaps into intensity and dissolves into calm", () => {
		expect(rhythmTransition("fade", "shock")).toBe("cut"); // snap into a high-energy beat
		expect(rhythmTransition("cut", "calm")).toBe("fade"); // ease into a calm beat
		expect(rhythmTransition("slide", "curiosity")).toBe("slide"); // mid energy unchanged
	});

	test("varyCamera breaks a repeated move, leaves distinct moves alone", () => {
		expect(varyCamera("Slow Zoom In", "Slow Zoom In")).not.toBe("Slow Zoom In");
		expect(CAMERA_MOVES).toContain(varyCamera("Slow Zoom In", "Slow Zoom In"));
		expect(varyCamera("Orbit", "Slow Zoom In")).toBe("Orbit");
		expect(varyCamera("Slow Zoom In")).toBe("Slow Zoom In");
	});
});

describe("style knobs", () => {
	test("every shipped style parses against the schema", () => {
		for (const fixture of PRESET_FIXTURES) {
			const parsed = styleKnobsSchema.safeParse(fixture.bundle.style);
			expect(
				parsed.success,
				`${fixture.slug} failed: ${parsed.success ? "" : parsed.error.message}`,
			).toBe(true);
		}
	});

	test("every shipped style is internally valid", () => {
		for (const k of SHIPPED) {
			expect(MUSIC_MOODS).toContain(k.musicMood);
			for (const n of [k.cameraIntensity, k.transitionIntensity, k.textDensity, k.sfxDensity]) {
				expect(n).toBeGreaterThanOrEqual(0);
				expect(n).toBeLessThanOrEqual(1);
			}
			expect(k.avgSceneDurationSec).toBeGreaterThan(0);
			expect(k.voiceSpeed).toBeGreaterThan(0);
		}
	});

	test("the schema rejects an out-of-range value by field name", () => {
		const bad = styleKnobsSchema.safeParse({
			...knobs("high-energy-challenge"),
			cameraIntensity: 1.4,
		});
		expect(bad.success).toBe(false);
		if (!bad.success) expect(bad.error.issues[0]?.path).toEqual(["cameraIntensity"]);
	});

	test("the schema rejects an unknown music mood by field name", () => {
		const bad = styleKnobsSchema.safeParse({
			...knobs("high-energy-challenge"),
			musicMood: "chaotic",
		});
		expect(bad.success).toBe(false);
		if (!bad.success) expect(bad.error.issues[0]?.path).toEqual(["musicMood"]);
	});

	test("the schema rejects a voiceSpeed outside its bounds", () => {
		expect(
			styleKnobsSchema.safeParse({ ...knobs("high-energy-challenge"), voiceSpeed: 3 }).success,
		).toBe(false);
	});

	test("only the explainer styles ship a transition system", () => {
		// A motif used to be reachable only by an id comparison in video-blueprint.ts.
		// It is data now, so any style may adopt one — both explainer styles have.
		const withSystem = PRESET_FIXTURES.filter((p) => p.bundle.style?.transitionSystem).map(
			(p) => p.slug,
		);
		expect(withSystem).toEqual(["animated-explainer-essay", "animated-systems-explainer"]);
	});
});

describe("overlayMotionForEmotion", () => {
	test("maps emotional energy to an overlay entrance preset", () => {
		expect(overlayMotionForEmotion("calm")).toBe("fade");
		expect(overlayMotionForEmotion("curiosity")).toBe("slide_up");
		expect(overlayMotionForEmotion("shock")).toBe("scale");
		expect(overlayMotionForEmotion("tension")).toBe("scale");
		expect(overlayMotionForEmotion(undefined)).toBe("slide_up");
	});
});

describe("autoTransitionForScenes", () => {
	test("last scene has no outgoing transition", () => {
		const out = autoTransitionForScenes([{ beat: "hook" }, { beat: "cta" }]);
		expect(out).toHaveLength(2);
		expect(out[1]).toBeUndefined();
	});

	test("varies transitions across a beat arc instead of a static default", () => {
		const scenes = [
			{ beat: "hook", emotion: "curiosity" },
			{ beat: "conflict", emotion: "tension" },
			{ beat: "twist", emotion: "shock" },
			{ beat: "resolution", emotion: "relief" },
			{ beat: "cta", emotion: "hope" },
		];
		const out = autoTransitionForScenes(scenes);
		expect(out[out.length - 1]).toBeUndefined();
		const kinds = new Set(out.slice(0, -1));
		expect(kinds.size).toBeGreaterThan(1);
	});

	test("falls back to positional beats when unset", () => {
		const out = autoTransitionForScenes([{}, {}, {}]);
		expect(out).toHaveLength(3);
		expect(out[2]).toBeUndefined();
		expect(out[0]).toBeDefined();
	});

	test("single scene yields no transitions", () => {
		expect(autoTransitionForScenes([{ beat: "hook" }])).toEqual([undefined]);
	});
});
