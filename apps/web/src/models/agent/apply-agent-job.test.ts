/* Applying an agent run onto the editor document.
 *
 * This was 91 lines of closure inside a 1,114-line component: it read three refs
 * it never declared as inputs, called the clock four times with hand-picked
 * offsets to keep its sub-merges from colliding, and could only be reached by
 * mounting the editor and its player. Its coverage was nineteen `readFileSync`
 * assertions against the component's source text.
 *
 * The behaviour worth pinning is the carry-over: an agent re-run must not lose
 * what the operator edited, and must not duplicate what it already generated. */
import { afterEach, describe, expect, test } from "vite-plus/test";
import type {
	AgentAudioOverlayOut,
	AgentCharacterOut,
	AgentJobScene,
	AgentTextOverlayOut,
	AgentVideoOverlayOut,
} from "@models/agent/agent-wire.ts";
import type { AudioOverlay, RefImage, Scene, TextOverlay, VideoOverlay } from "@maleo/shared";
import { mediaUrl, mintMediaId } from "@maleo/shared";
import { clearPendingSources, trackPendingSource } from "@models/core/pending-media-sources.ts";

/** Minted identities this session tracks as still importing. */
const trackPending = (count: number): string[] =>
	Array.from({ length: count }, () => {
		const id = mintMediaId();
		trackPendingSource(id);
		return id;
	});
afterEach(() => {
	clearPendingSources();
});
import {
	mergeAgentAudioOverlays,
	mergeAgentCharacters,
	mergeAgentScenes,
	mergeAgentTextOverlays,
	mergeAgentVideoOverlays,
} from "./apply-agent-job.ts";
import { admitMediaAsset, type MediaAssetSeed } from "@models/timeline/media-admission.ts";
import { planMediaReconcile } from "@models/timeline/media-reconcile.ts";
import type { MediaAsset } from "@models/timeline/editor-media.ts";

const SEED = 1_000_000;

/* Admission as the editor performs it: `admitMediaAsset` over a list that
 * accumulates, which is what makes several admissions in one merge agree on the
 * identity of a shared URL. A stub returning a constant would hide exactly the
 * dedup this depends on. */
function library() {
	let assets: MediaAsset[] = [];
	return {
		admit: (seed: MediaAssetSeed) => {
			const r = admitMediaAsset(assets, seed);
			assets = r.assets;
			return r.id;
		},
		assets: () => assets,
	};
}
/** One library for the tests that only need admission to happen, not to be
 *  inspected. Shared rather than per-call so dedup on URL behaves as it does in
 *  the app — a fresh library per call would silently hand two clips on one URL
 *  two identities. */
const shared = library();
const admit = shared.admit;

test.each([2, 7])(
	"agent video merge preserves four-second admission for %ss placement",
	(durationSec) => {
		const lib = library();
		const overlays = mergeAgentVideoOverlays(
			[],
			[
				{
					url: "/api/media/video",
					thumb: "/api/media/poster",
					kind: "video",
					startSec: 0,
					durationSec,
					sourceDurationSec: 4,
				},
			],
			SEED,
			lib.admit,
		);
		expect(overlays[0]).toMatchObject({
			dur: Math.min(durationSec, 4),
			sourceDurationSec: 4,
			thumb: "/api/media/poster",
		});
		expect(lib.assets()[0]?.dur).toBe(4);
		expect(lib.assets()[0]?.thumb).toBe("/api/media/poster");
	},
);

const agentScene = (over: Partial<AgentJobScene> = {}): AgentJobScene => ({
	name: "Scene",
	durationSec: 3,
	shot: "Medium Shot",
	move: "Static",
	transition: "fade",
	visual: "a stickman",
	voiceover: "narration",
	...over,
});

const editorScene = (over: Partial<Scene> = {}): Scene =>
	({
		id: 1,
		dur: 3,
		name: "Scene",
		shot: "Medium Shot",
		move: "Static",
		vis: "",
		vo: "",
		img: false,
		...over,
	}) as Scene;

describe("scenes carry over what the agent did not send", () => {
	test("a field the agent omits keeps the editor's value", () => {
		const prev = [editorScene({ id: 7, castId: "voice-a", noteIds: ["n1"], seed: 42 })];
		const next = mergeAgentScenes(prev, [agentScene()], { idSeed: SEED, admit });

		expect(next[0]!.id).toBe(7);
		expect(next[0]!.castId).toBe("voice-a");
		expect(next[0]!.noteIds).toEqual(["n1"]);
		expect(next[0]!.seed).toBe(42);
	});

	test("carry-over is positional, so two scenes sharing a name keep their own images", () => {
		// Name matching made both scenes resolve to the first match, so a scene with
		// no frame yet borrowed the other's while patches streamed in.
		const prev = [
			editorScene({ id: 1, name: "Beat", src: "/uploads/one.png", img: true }),
			editorScene({ id: 2, name: "Beat" }),
		];
		const next = mergeAgentScenes(
			prev,
			[agentScene({ name: "Beat" }), agentScene({ name: "Beat" })],
			{ idSeed: SEED, admit },
		);

		expect(next[0]!.src).toBe("/uploads/one.png");
		expect(next[1]!.src).toBeUndefined();
	});

	test("an image the agent returns wins, and one it omits is not erased", () => {
		const prev = [editorScene({ id: 1, src: "/uploads/old.png", img: true })];

		expect(
			mergeAgentScenes(prev, [agentScene({ image: "/uploads/new.png" })], {
				idSeed: SEED,
				admit,
			})[0]!.src,
		).toBe("/uploads/new.png");
		expect(mergeAgentScenes(prev, [agentScene()], { idSeed: SEED, admit })[0]!.src).toBe(
			"/uploads/old.png",
		);
	});

	test("a frame still uploading is kept, and the agent cannot name one", () => {
		const [k1, k2] = trackPending(2);
		const prev = [editorScene({ id: 1, src: mediaUrl(k1!), mediaAssetId: "k1", img: true })];
		const kept = mergeAgentScenes(prev, [agentScene({ image: "/uploads/new.png" })], {
			idSeed: SEED,
			admit,
		})[0]!;
		expect([kept.src, kept.mediaAssetId]).toEqual([mediaUrl(k1!), "k1"]);
		expect(
			mergeAgentScenes([], [agentScene({ image: mediaUrl(k2!) })], { idSeed: SEED, admit })[0]!.src,
		).toBeUndefined();
	});

	test("a new scene beyond the editor's list gets a seeded id, not a clock reading", () => {
		const next = mergeAgentScenes([], [agentScene(), agentScene()], { idSeed: SEED, admit });

		expect(next.map((s) => s.id)).toEqual([SEED, SEED + 1]);
	});

	test("the same seed and input produce the same scenes", () => {
		const job = [agentScene(), agentScene({ name: "Second" })];

		expect(mergeAgentScenes([], job, { idSeed: SEED, admit })).toEqual(
			mergeAgentScenes([], job, { idSeed: SEED, admit }),
		);
	});

	test("the default cast applies only where the editor has none", () => {
		const prev = [editorScene({ id: 1, castId: "chosen" }), editorScene({ id: 2 })];
		const next = mergeAgentScenes(prev, [agentScene(), agentScene()], {
			idSeed: SEED,
			defaultCastId: "fallback",
			admit,
		});

		expect(next[0]!.castId).toBe("chosen");
		expect(next[1]!.castId).toBe("fallback");
	});
});

describe("text overlays", () => {
	const overlay = (over: Partial<AgentTextOverlayOut> = {}): AgentTextOverlayOut =>
		({
			content: "Title",
			startSec: 0,
			durationSec: 2,
			preset: "title",
			...over,
		}) as AgentTextOverlayOut;

	test("an incoming overlay replaces the editor's copy of the same id", () => {
		const prev: TextOverlay[] = [{ id: 5, content: "Old", start: 0, dur: 2, preset: "title" }];
		const next = mergeAgentTextOverlays(prev, [overlay({ id: 5, content: "New" })], SEED);

		expect(next).toHaveLength(1);
		expect(next[0]!.content).toBe("New");
	});

	test("overlays without ids are seeded, not clock-stamped", () => {
		const next = mergeAgentTextOverlays([], [overlay(), overlay({ content: "Second" })], SEED);

		expect(next.map((o) => o.id)).toEqual([SEED + 2000, SEED + 2001]);
	});

	test("an incoming overlay lands on a free track rather than colliding", () => {
		const prev: TextOverlay[] = [
			{ id: 5, content: "Existing", start: 0, dur: 4, preset: "title", track: 0 },
		];
		const next = mergeAgentTextOverlays(
			prev,
			[overlay({ startSec: 1, durationSec: 2, track: 0 })],
			SEED,
		);

		const incoming = next.find((o) => o.content === "Title")!;
		expect(incoming.track).not.toBe(0);
	});

	test("the editor's unrelated overlays survive", () => {
		const prev: TextOverlay[] = [
			{ id: 9, content: "Operator's", start: 10, dur: 2, preset: "title" },
		];
		const next = mergeAgentTextOverlays(prev, [overlay()], SEED);

		expect(next.some((o) => o.content === "Operator's")).toBe(true);
	});
});

describe("video and audio overlays", () => {
	test("a clip on a pending upload is kept verbatim, and the agent cannot point a clip at one", () => {
		const [k1, k2, k3] = trackPending(3);
		const pending = {
			id: 5,
			kind: "video",
			url: mediaUrl(k1!),
			mediaAssetId: "k1",
			start: 1,
			dur: 2,
			track: 0,
			label: "Beach",
		} as VideoOverlay;
		const incoming = [
			{ id: 5, url: "/uploads/other.mp4", kind: "video", startSec: 4, durationSec: 1 },
			{ url: mediaUrl(k2!), kind: "video", startSec: 0, durationSec: 1 },
		] as AgentVideoOverlayOut[];
		expect(mergeAgentVideoOverlays([pending], incoming, SEED, admit)).toEqual([pending]);
		const audio = {
			id: 6,
			kind: "music",
			content: "bed",
			url: mediaUrl(k3!),
			start: 0,
			dur: 2,
			track: 0,
		} as AudioOverlay;
		expect(
			mergeAgentAudioOverlays(
				[audio],
				[
					{
						id: 6,
						kind: "music",
						content: "bed",
						url: "/uploads/b.wav",
						startSec: 0,
						durationSec: 5,
					},
				] as AgentAudioOverlayOut[],
				SEED,
				admit,
			),
		).toEqual([audio]);
	});

	test("a video overlay is seeded and marked generated", () => {
		const incoming = [
			{ url: "/uploads/a.mp4", kind: "video", startSec: 0, durationSec: 3 },
		] as AgentVideoOverlayOut[];
		const next = mergeAgentVideoOverlays([] as VideoOverlay[], incoming, SEED, admit);

		expect(next[0]!.id).toBe(SEED + 3000);
		expect(next[0]!.source).toBe("generated");
	});

	test("audio keeps the operator's mix when the agent re-sends a clip", () => {
		const prev = [
			{
				id: 5,
				kind: "voiceover",
				content: "VO",
				url: "/uploads/a.wav",
				start: 0,
				dur: 2,
				track: 1,
				volume: 0.3,
				fadeIn: 0.5,
			},
		] as AudioOverlay[];
		const incoming = [
			{
				id: 5,
				kind: "voiceover",
				content: "VO",
				url: "/uploads/a.wav",
				startSec: 0,
				durationSec: 2,
				volume: 1,
			},
		] as AgentAudioOverlayOut[];

		const next = mergeAgentAudioOverlays(prev, incoming, SEED, admit);
		expect(next[0]!.volume).toBe(0.3);
		expect(next[0]!.fadeIn).toBe(0.5);
	});

	/* The server sends a generated voiceover with `originalDur` set to its measured
	 * duration (services/assets.ts). This merge copies field by field, and the
	 * client's hand-written copy of the run contract did not declare originalDur or
	 * mediaStartSec — so both were dropped, and an agent-created audio clip showed
	 * no length-percent badge on resize while a dragged-in one did. The contract is
	 * now declared once, in @maleo/shared/agent-wire. */
	test("audio carries the source length and in-point the server sends", () => {
		const incoming = [
			{
				id: 5,
				kind: "voiceover",
				content: "VO",
				url: "/uploads/a.wav",
				startSec: 0,
				durationSec: 2,
				originalDur: 6,
				mediaStartSec: 1.5,
			},
		] as AgentAudioOverlayOut[];

		const next = mergeAgentAudioOverlays([] as AudioOverlay[], incoming, SEED, admit);
		expect(next[0]!.originalDur).toBe(6);
		expect(next[0]!.mediaStartSec).toBe(1.5);
	});

	test("audio keeps the editor's source length when the agent re-sends without one", () => {
		const prev = [
			{
				id: 5,
				kind: "voiceover",
				content: "VO",
				url: "/uploads/a.wav",
				start: 0,
				dur: 2,
				originalDur: 6,
			},
		] as AudioOverlay[];
		const incoming = [
			{
				id: 5,
				kind: "voiceover",
				content: "VO",
				url: "/uploads/a.wav",
				startSec: 0,
				durationSec: 2,
			},
		] as AgentAudioOverlayOut[];

		expect(mergeAgentAudioOverlays(prev, incoming, SEED, admit)[0]!.originalDur).toBe(6);
	});

	test("audio keeps its semantic lane: the agent's track, else the editor's, else zero", () => {
		const prev = [
			{ id: 5, kind: "voiceover", content: "VO", url: "/a.wav", start: 0, dur: 2, track: 3 },
		] as AudioOverlay[];

		// The agent names a lane.
		expect(
			mergeAgentAudioOverlays(
				prev,
				[
					{
						id: 5,
						kind: "voiceover",
						content: "VO",
						url: "/a.wav",
						startSec: 0,
						durationSec: 2,
						track: 1,
					},
				] as AgentAudioOverlayOut[],
				SEED,
				admit,
			)[0]!.track,
		).toBe(1);
		// It does not, so the editor's lane holds.
		expect(
			mergeAgentAudioOverlays(
				prev,
				[
					{ id: 5, kind: "voiceover", content: "VO", url: "/a.wav", startSec: 0, durationSec: 2 },
				] as AgentAudioOverlayOut[],
				SEED,
				admit,
			)[0]!.track,
		).toBe(3);
		// Neither has one.
		expect(
			mergeAgentAudioOverlays(
				[],
				[
					{ kind: "voiceover", content: "VO", url: "/a.wav", startSec: 0, durationSec: 2 },
				] as AgentAudioOverlayOut[],
				SEED,
				admit,
			)[0]!.track,
		).toBe(0);
	});

	test("audio takes new caption words but keeps existing ones when the agent sends none", () => {
		const prev = [
			{
				id: 5,
				kind: "voiceover",
				content: "VO",
				url: "/a.wav",
				start: 0,
				dur: 2,
				track: 1,
				words: [{ text: "hi", startSec: 0, endSec: 1 }],
			},
		] as AudioOverlay[];
		const incoming = [
			{ id: 5, kind: "voiceover", content: "VO", url: "/a.wav", startSec: 0, durationSec: 2 },
		] as AgentAudioOverlayOut[];

		expect(mergeAgentAudioOverlays(prev, incoming, SEED, admit)[0]!.words).toHaveLength(1);
	});
});

describe("characters", () => {
	const character = (over: Partial<AgentCharacterOut> = {}): AgentCharacterOut =>
		({ name: "Anna", description: "a woman in a red coat", ...over }) as AgentCharacterOut;

	test("the server's entity id is used, so re-applying a job does not duplicate", () => {
		const first = mergeAgentCharacters([] as RefImage[], [character({ id: "ent-1" })]);
		const second = mergeAgentCharacters(first, [character({ id: "ent-1" })]);

		expect(second).toHaveLength(1);
		expect(second[0]!.id).toBe("ent-1");
	});

	test("a character without a server id falls back to its name, not the clock", () => {
		const next = mergeAgentCharacters([] as RefImage[], [character()]);
		expect(next[0]!.id).toBe("char-Anna");
	});

	test("agent-created characters join the project roster", () => {
		// Generation resolves ids through the roster, so an unattached entity would
		// render nothing.
		expect(mergeAgentCharacters([] as RefImage[], [character({ id: "ent-1" })])[0]!.inRoster).toBe(
			true,
		);
	});
});

/* The reconciler is a net, not the mechanism. If it finds something after a
 * writer has run, that writer is wrong — so the assertion is on the plan being
 * null, which names the writer rather than letting self-repair hide it.
 *
 * These fail against the pre-change merges: `mergeAgentVideoOverlays` and
 * `mergeAgentAudioOverlays` set `url` and no `mediaAssetId` at all, and
 * `mergeAgentScenes` did the same for `src`. */
describe("an agent job leaves nothing for the reconciler", () => {
	const clean = (input: {
		scenes?: Scene[];
		videoOverlays?: VideoOverlay[];
		audioOverlays?: AudioOverlay[];
		assets: MediaAsset[];
	}): void => {
		expect(
			planMediaReconcile({
				scenes: input.scenes ?? [],
				videoOverlays: input.videoOverlays ?? [],
				audioOverlays: input.audioOverlays ?? [],
				assets: input.assets,
			}),
		).toBeNull();
	};

	test("a scene frame the agent supplies is admitted and recorded", () => {
		const lib = library();
		const scenes = mergeAgentScenes([], [agentScene({ image: "/uploads/frame.png" })], {
			idSeed: SEED,
			admit: lib.admit,
		});
		expect(scenes[0]!.mediaAssetId).toBeTruthy();
		clean({ scenes, assets: lib.assets() });
	});

	test("an agent video overlay is admitted and recorded", () => {
		const lib = library();
		const incoming = [
			{ url: "/uploads/a.mp4", kind: "video", startSec: 0, durationSec: 3 },
		] as AgentVideoOverlayOut[];
		const videoOverlays = mergeAgentVideoOverlays([] as VideoOverlay[], incoming, SEED, lib.admit);
		clean({ videoOverlays, assets: lib.assets() });
	});

	test("thirty agent sound effects sharing one URL admit one asset", () => {
		const lib = library();
		const incoming = Array.from({ length: 30 }, (_, i) => ({
			kind: "sfx",
			content: "whoosh",
			url: "/uploads/whoosh.mp3",
			startSec: i,
			durationSec: 0.5,
		})) as AgentAudioOverlayOut[];
		const audioOverlays = mergeAgentAudioOverlays([] as AudioOverlay[], incoming, SEED, lib.admit);

		expect(audioOverlays).toHaveLength(30);
		expect(lib.assets()).toHaveLength(1);
		expect(new Set(audioOverlays.map((a) => a.mediaAssetId)).size).toBe(1);
		clean({ audioOverlays, assets: lib.assets() });
	});
});

test("agent merge retains current video/audio playback when changing narration or position", () => {
	const layout = {
		xPct: 0,
		yPct: 0,
		widthPct: 100,
		fit: "contain" as const,
		playbackRate: 0.5,
		preservePitch: true,
		reverse: true,
	};
	const video: VideoOverlay = {
		id: 5,
		kind: "video",
		url: "/camera.mp4",
		start: 2,
		dur: 8,
		track: 3,
		volume: 0.6,
		mediaStartSec: 1,
		layout,
	};
	const changed = mergeAgentVideoOverlays(
		[video],
		[{ id: 5, kind: "video", url: video.url, startSec: 2, durationSec: 8, layout: { xPct: 10 } }],
		SEED,
		admit,
	)[0]!;
	expect(changed).toMatchObject({
		volume: 0.6,
		mediaStartSec: 1,
		track: 3,
		layout: { ...layout, xPct: 10 },
	});
	const audio: AudioOverlay = {
		id: 8,
		kind: "voiceover",
		content: "Before",
		url: "/speech.wav",
		start: 12,
		dur: 8,
		playbackRate: 0.5,
		preservePitch: true,
		reverse: true,
		fadeIn: 0.2,
		duckUnderVoice: 0.4,
	};
	const incoming = {
		id: 8,
		kind: "voiceover" as const,
		content: "After",
		url: audio.url!,
		startSec: 12,
		durationSec: 8,
		playbackRate: 1,
		preservePitch: false,
		reverse: false,
	};
	expect(mergeAgentAudioOverlays([audio], [incoming], SEED, admit)[0]).toMatchObject({
		playbackRate: 0.5,
		preservePitch: true,
		reverse: true,
		fadeIn: 0.2,
		duckUnderVoice: 0.4,
		content: "After",
	});
	expect(
		mergeAgentAudioOverlays(
			[],
			[{ ...incoming, playbackRate: 0.5, preservePitch: true }],
			SEED,
			admit,
		)[0],
	).toMatchObject({ playbackRate: 0.5, preservePitch: true });
});

test("audio agent merge admits new keys, preserves authored keys and respects operator removal", () => {
	const animation = {
		tracks: {
			volume: [
				{ t: 0, v: 0.2 },
				{ t: 2, v: 0.8 },
			],
		},
	};
	const incoming: AgentAudioOverlayOut = {
		id: 42,
		kind: "music",
		content: "Bed",
		url: "/api/media/bed",
		startSec: 0,
		durationSec: 2,
		animation,
	};
	const fresh = mergeAgentAudioOverlays([], [incoming], SEED, admit);
	expect(fresh[0]?.animation).toEqual(animation);
	const authored = { tracks: { volume: [{ t: 0, v: 0.5 }] } };
	expect(
		mergeAgentAudioOverlays([{ ...fresh[0]!, animation: authored }], [incoming], SEED, admit)[0]
			?.animation,
	).toEqual(authored);
	expect(
		mergeAgentAudioOverlays([{ ...fresh[0]!, animation: undefined }], [incoming], SEED, admit)[0]
			?.animation,
	).toBeUndefined();
});

test("narration and overlay updates retain authored compositing", () => {
	const layout = {
		xPct: 10,
		yPct: 20,
		widthPct: 60,
		fit: "cover" as const,
		mask: {
			shape: "ellipse" as const,
			xPct: 25,
			yPct: 25,
			widthPct: 50,
			heightPct: 50,
			rotationDeg: 20,
			featherPct: 12,
			inverted: true,
		},
		blendMode: "screen" as const,
		color: { brightness: 0.5, contrast: 1.2, saturation: 1.5 },
	};
	const scene = editorScene({
		src: "/frame.png",
		layout,
		visualClips: [
			{
				id: "primary",
				kind: "image",
				label: "Image",
				url: "/frame.png",
				startSec: 0,
				durationSec: 3,
				primary: true,
				layout,
			},
		],
	});
	const updated = mergeAgentScenes([scene], [agentScene({ voiceover: "New narration" })], {
		idSeed: SEED,
		admit,
	})[0]!;
	expect(updated.vo).toBe("New narration");
	expect(updated.layout).toMatchObject(layout);
	expect(updated.visualClips?.[0]?.layout).toMatchObject(layout);
	const video: VideoOverlay = { id: 5, kind: "image", url: "/frame.png", start: 0, dur: 3, layout };
	expect(
		mergeAgentVideoOverlays(
			[video],
			[{ id: 5, kind: "image", url: video.url, startSec: 0, durationSec: 3 }],
			SEED,
			admit,
		)[0]?.layout,
	).toMatchObject(layout);
});
