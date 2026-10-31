import { describe, expect, test } from "vite-plus/test";
import {
	motionInputHash,
	frameIsStale,
	sceneFrameHash,
	sceneSpeechHash,
	speechIsStale,
	staleScenes,
	storyAssetStaleness,
	storyFrameInputHash,
	storySpeechInputHash,
	storyVisualInputHash,
	storyDirectionInputFingerprint,
} from "./asset-staleness.ts";

describe("the digest cannot be fooled", () => {
	test("story dependency matrix follows speech and visual inputs", () => {
		const speech = storySpeechInputHash({
			narration: "One",
			voice: "v1",
			provider: "p1",
			delivery: "calm",
		});
		const visualInput = {
			speechHash: speech,
			visualPrompt: "Bee",
			plannedShots: ["macro"],
			referenceIds: ["bee"],
			style: "ink",
		};
		const visual = storyVisualInputHash(visualInput);
		const frame = storyFrameInputHash({ ...visualInput, authoredVisual: "macro bee" });
		const recorded = { speechInputHash: speech, visualInputHash: visual, frameInputHash: frame };
		expect(
			storyAssetStaleness(recorded, { speechHash: speech, visualHash: visual, frameHash: frame }),
		).toEqual({ speech: false, captions: false, timing: false, visuals: false, frames: false });
		const narration = storySpeechInputHash({
			narration: "Two",
			voice: "v1",
			provider: "p1",
			delivery: "calm",
		});
		expect(
			storyAssetStaleness(recorded, {
				speechHash: narration,
				visualHash: visual,
				frameHash: frame,
			}),
		).toEqual({ speech: true, captions: true, timing: true, visuals: true, frames: true });
		const changedVisual = storyVisualInputHash({ ...visualInput, visualPrompt: "Hive" });
		expect(
			storyAssetStaleness(recorded, {
				speechHash: speech,
				visualHash: changedVisual,
				frameHash: frame,
			}),
		).toEqual({ speech: false, captions: false, timing: false, visuals: true, frames: true });
		const redirected = storyVisualInputHash({
			...visualInput,
			editorialDirection: '{"visualConcept":"cutaway"}',
		});
		expect(redirected).not.toBe(visual);
		expect(
			storyAssetStaleness(recorded, {
				speechHash: speech,
				visualHash: visual,
				frameHash: `${frame}-changed`,
			}),
		).toEqual({ speech: false, captions: false, timing: false, visuals: false, frames: true });
		expect(
			storyAssetStaleness({}, { speechHash: speech, visualHash: visual, frameHash: frame }),
		).toEqual({ speech: false, captions: false, timing: false, visuals: false, frames: false });
	});
	/* These are the properties two real bugs were caught by, so they outlive the
	 * raw-input layer they were first written against. */
	test("a field boundary cannot be forged by moving text across it", () => {
		// Without length prefixes, ("ab","c") and ("a","bc") concatenate identically
		// and two different generations read as the same one.
		expect(sceneSpeechHash({ vo: "ab", castId: "c" })).not.toBe(
			sceneSpeechHash({ vo: "a", castId: "bc" }),
		);
		expect(sceneFrameHash({ vis: "ab", refIds: ["c"] })).not.toBe(
			sceneFrameHash({ vis: "a", refIds: ["bc"] }),
		);
	});

	test("an absent field is not the same as an empty one", () => {
		// "no speaker chosen" must not read as "speaker set to empty".
		expect(sceneSpeechHash({ vo: "x" })).not.toBe(sceneSpeechHash({ vo: "x", castId: "" }));
	});

	test("reference order does not change the frame hash", () => {
		const refs = { vis: "a desk", refIds: ["ref-a", "ref-b"] };
		expect(sceneFrameHash({ ...refs, refIds: ["ref-b", "ref-a"] })).toBe(sceneFrameHash(refs));
	});

	test("speech and frame do not collide on the same text", () => {
		expect(sceneSpeechHash({ vo: "same" })).not.toBe(sceneFrameHash({ vis: "same" }));
	});

	test.each([
		["narration", { vo: "different" }],
		["speaker", { castId: "atlas" }],
		["voice", { voiceId: "v-2" }],
	] as const)("speech: %s changes the hash", (_f, change) => {
		const base = { vo: "Ships break.", castId: "nova", voiceId: "v-1" };
		expect(sceneSpeechHash({ ...base, ...change })).not.toBe(sceneSpeechHash(base));
	});

	test.each([
		["prompt", { vis: "elsewhere" }],
		["references", { refIds: ["ref-a"] }],
		["seed", { seed: 8 }],
	] as const)("frame: %s changes the hash", (_f, change) => {
		const base = { vis: "A dark desk.", refIds: ["ref-a", "ref-b"], seed: 7 };
		expect(sceneFrameHash({ ...base, ...change })).not.toBe(sceneFrameHash(base));
	});

	test("the provider and the style are part of their hashes", () => {
		expect(sceneSpeechHash({ vo: "x" }, { provider: "provider-a" })).not.toBe(
			sceneSpeechHash({ vo: "x" }, { provider: "provider-b" }),
		);
		expect(sceneFrameHash({ vis: "x" }, { stylePreset: "a" })).not.toBe(
			sceneFrameHash({ vis: "x" }, { stylePreset: "b" }),
		);
	});
});

describe("admission and the check derive from the same scene fields", () => {
	/* The rule that matters is not "one call site" — a frame is admitted by the
	 * editor's own generate AND by an agent run — but ONE DERIVATION. Both stamp
	 * with these functions and the check reads them back, so the two cannot drift.
	 * Hashing a composed prompt at admission and a raw field at check would make
	 * every asset read as stale forever, which is the failure this shape prevents. */
	const scene = {
		vo: "Ships break.",
		castId: "nova",
		vis: "A dark desk.",
		refIds: ["ref-a"],
		seed: 7,
	};

	test("a scene stamped at admission reads as fresh", () => {
		const stamped = {
			...scene,
			speechInputHash: sceneSpeechHash(scene),
			frameInputHash: sceneFrameHash(scene),
		};
		expect(speechIsStale(stamped)).toBe(false);
		expect(frameIsStale(stamped)).toBe(false);
	});

	test("editing narration makes the speech stale and leaves the frame alone", () => {
		const stamped = {
			...scene,
			speechInputHash: sceneSpeechHash(scene),
			frameInputHash: sceneFrameHash(scene),
		};
		const edited = { ...stamped, vo: "Rewritten entirely." };
		expect(speechIsStale(edited)).toBe(true);
		expect(frameIsStale(edited)).toBe(false);
	});

	test("editing the visual prompt makes the frame stale and leaves the speech alone", () => {
		const stamped = {
			...scene,
			speechInputHash: sceneSpeechHash(scene),
			frameInputHash: sceneFrameHash(scene),
		};
		const edited = { ...stamped, vis: "A hand on the scroll." };
		expect(frameIsStale(edited)).toBe(true);
		expect(speechIsStale(edited)).toBe(false);
	});

	test("editing a field outside the hash changes nothing", () => {
		const stamped = {
			...scene,
			speechInputHash: sceneSpeechHash(scene),
			frameInputHash: sceneFrameHash(scene),
		};
		expect(speechIsStale({ ...stamped, vo: scene.vo })).toBe(false);
		expect(frameIsStale({ ...stamped, seed: 7 })).toBe(false);
	});

	test("a scene with no stamped hash is fresh on both counts", () => {
		expect(speechIsStale(scene)).toBe(false);
		expect(frameIsStale(scene)).toBe(false);
	});

	test("a changed style direction makes the frame stale", () => {
		const stamped = {
			...scene,
			frameInputHash: sceneFrameHash(scene, { stylePreset: "Dark documentary" }),
		};
		expect(frameIsStale(stamped, { stylePreset: "Dark documentary" })).toBe(false);
		expect(frameIsStale(stamped, { stylePreset: "Bright Systems Animation" })).toBe(true);
	});
});

describe("a render reports stale scenes without blocking", () => {
	const fresh = (id: number) => {
		const s = { id, name: `Scene ${id}`, vo: "Ships break.", vis: "A dark desk." };
		return { ...s, speechInputHash: sceneSpeechHash(s), frameInputHash: sceneFrameHash(s) };
	};

	test("nothing stale is an empty list, not an absence", () => {
		expect(staleScenes([fresh(1), fresh(2)])).toEqual([]);
	});

	test("a scene reports which of its assets went stale", () => {
		const edited = { ...fresh(1), vo: "Rewritten." };
		expect(staleScenes([edited])).toEqual([{ id: 1, name: "Scene 1", speech: true, frame: false }]);
	});

	test("both assets can be stale at once", () => {
		const edited = { ...fresh(2), vo: "Rewritten.", vis: "Somewhere else." };
		expect(staleScenes([edited])).toEqual([{ id: 2, name: "Scene 2", speech: true, frame: true }]);
	});

	test("only the stale scenes are listed, in order", () => {
		const scenes = [
			fresh(1),
			{ ...fresh(2), vo: "Rewritten." },
			fresh(3),
			{ ...fresh(4), vis: "New." },
		];
		expect(staleScenes(scenes).map((s) => s.id)).toEqual([2, 4]);
	});

	test("a project that never recorded a hash reports nothing", () => {
		// The whole back catalogue, which must not be marked for regeneration.
		expect(staleScenes([{ id: 1, vo: "Ships break.", vis: "A dark desk." }])).toEqual([]);
	});

	test("a scene with no name is still identifiable in the report", () => {
		const edited = { id: 9, vo: "a", speechInputHash: sceneSpeechHash({ vo: "b" }) };
		expect(staleScenes([edited])[0]).toMatchObject({ id: 9, name: "Scene 9" });
	});
});

describe("directed bindings reach the digest through editorial direction", () => {
	test("a changed binding stales the visual, a materialized key does not", () => {
		const speech = storySpeechInputHash({
			narration: "One",
			voice: "v1",
			provider: "p1",
			delivery: "calm",
		});
		const shots = (binding: Record<string, string>) =>
			JSON.stringify({ visualConcept: "hive", shots: [{ index: 0, bindings: [binding] }] });
		const input = {
			speechHash: speech,
			visualPrompt: "Bee",
			plannedShots: ["macro"],
			style: "ink",
			editorialDirection: shots({ plannedKey: "hive" }),
		};
		const base = storyVisualInputHash(input);
		expect(
			storyVisualInputHash({ ...input, editorialDirection: shots({ entityId: "e-bee" }) }),
		).not.toBe(base);
		// Materialization resolves the key to an entity elsewhere; the binding is unchanged.
		expect(storyVisualInputHash({ ...input })).toBe(base);
	});

	/* The digest is persisted per generated asset, so a field added to the input
	 * must not move it: every story image ever generated would read as stale and be
	 * regenerated at provider cost. These are the digests HEAD produces. */
	test("an input without direction digests exactly as it did before", () => {
		const legacy = {
			speechHash: "s",
			visualPrompt: "v",
			plannedShots: ["a"],
			referenceIds: ["r"],
			style: "ink",
		};
		expect(storyVisualInputHash(legacy)).toBe("ujitfhjrsk");
		expect(storyFrameInputHash({ ...legacy, authoredVisual: "x" })).toBe("oap4c40fbi");
	});
});

describe("the direction fingerprint sees every direction input", () => {
	const base = {
		narrations: ["one"],
		plannedShots: [["wide"]],
		rosterIds: ["e-a"],
		materials: "visual+rules",
		templateConstraints: "9:16",
	};
	test("the same inputs fingerprint identically, in any roster order", () => {
		expect(storyDirectionInputFingerprint(base)).toBe(storyDirectionInputFingerprint({ ...base }));
		expect(storyDirectionInputFingerprint({ ...base, rosterIds: ["e-a", "e-b"] })).toBe(
			storyDirectionInputFingerprint({ ...base, rosterIds: ["e-b", "e-a"] }),
		);
	});
	test("each input changes it", () => {
		const fingerprint = storyDirectionInputFingerprint(base);
		expect(storyDirectionInputFingerprint({ ...base, narrations: ["two"] })).not.toBe(fingerprint);
		expect(storyDirectionInputFingerprint({ ...base, plannedShots: [["wide", "close"]] })).not.toBe(
			fingerprint,
		);
		expect(storyDirectionInputFingerprint({ ...base, rosterIds: ["e-a", "e-b"] })).not.toBe(
			fingerprint,
		);
		expect(storyDirectionInputFingerprint({ ...base, materials: "visual" })).not.toBe(fingerprint);
		expect(storyDirectionInputFingerprint({ ...base, templateConstraints: "16:9" })).not.toBe(
			fingerprint,
		);
	});
	/* The same draft content must fingerprint the same way whoever computed it: the
	 * caller may hold a persisted generation state or a freshly canonicalized one. */
	test("no identity of the draft container leaks in", () => {
		const fingerprint = storyDirectionInputFingerprint(base);
		expect(storyDirectionInputFingerprint({ ...base })).toBe(fingerprint);
		expect(Object.keys(base)).not.toContain("draftRevisionId");
	});

	test("a shot boundary cannot be forged by moving text across it", () => {
		expect(storyDirectionInputFingerprint({ ...base, plannedShots: [["ab", "c"]] })).not.toBe(
			storyDirectionInputFingerprint({ ...base, plannedShots: [["a", "bc"]] }),
		);
	});
});

describe("motionInputHash", () => {
	const base = {
		sourceText: "Ship faster",
		presentation: "headline",
		startSec: 1.25,
		durationSec: 2.4,
		aspect: "16:9",
		visualStyle: "flat editorial",
	};

	test("changes when any authored input changes", () => {
		const hash = motionInputHash(base);
		for (const patch of [
			{ sourceText: "Ship slower" },
			{ presentation: "explainer" },
			{ startSec: 1.3 },
			{ durationSec: 2.5 },
			{ aspect: "9:16" },
			{ visualStyle: "dark luxury" },
			{ visualStyle: undefined },
		])
			expect(motionInputHash({ ...base, ...patch })).not.toBe(hash);
	});

	test("ignores sub-millisecond timing noise and is stable", () => {
		expect(motionInputHash({ ...base, startSec: 1.2500001 })).toBe(motionInputHash(base));
		expect(motionInputHash(base)).toBe(motionInputHash({ ...base }));
	});
});
