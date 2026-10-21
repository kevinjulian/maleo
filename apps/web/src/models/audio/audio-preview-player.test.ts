import { afterEach, beforeEach, describe, expect, test } from "vite-plus/test";
import {
	audioPreviewState,
	resetAudioPreviewForTests,
	seekAudioPreview,
	stopAudioPreview,
	subscribeAudioPreview,
	toggleAudioPreview,
} from "./audio-preview-player.ts";

/* The element is stubbed rather than the module, because the guarantee under
 * test is a property of there being exactly ONE element: assigning `src` to a
 * playing element is what stops the previous clip. A mock per preview would
 * pass while the real thing overlapped. */
class FakeAudio {
	static live: FakeAudio[] = [];
	src = "";
	currentTime = 0;
	duration = NaN;
	preload = "";
	playing = false;
	private readonly handlers = new Map<string, Array<() => void>>();

	constructor() {
		FakeAudio.live.push(this);
	}
	addEventListener(type: string, fn: () => void): void {
		this.handlers.set(type, [...(this.handlers.get(type) ?? []), fn]);
	}
	emit(type: string): void {
		for (const fn of this.handlers.get(type) ?? []) fn();
	}
	play(): Promise<void> {
		this.playing = true;
		return Promise.resolve();
	}
	pause(): void {
		this.playing = false;
	}
	/** What the browser does when metadata arrives. */
	loadTo(seconds: number): void {
		this.duration = seconds;
		this.emit("durationchange");
	}
	advanceTo(seconds: number): void {
		this.currentTime = seconds;
		this.emit("timeupdate");
	}
}

const BED = "https://cdn.example/bed.mp3";
const SFX = "https://cdn.example/whoosh.mp3";
const el = (): FakeAudio => FakeAudio.live[0]!;

beforeEach(() => {
	resetAudioPreviewForTests();
	FakeAudio.live = [];
	(globalThis as Record<string, unknown>).document = {};
	(globalThis as Record<string, unknown>).Audio = FakeAudio;
});
afterEach(() => {
	resetAudioPreviewForTests();
	delete (globalThis as Record<string, unknown>).document;
	delete (globalThis as Record<string, unknown>).Audio;
});

describe("only one preview plays at a time", () => {
	test("starting a second preview stops the first", () => {
		toggleAudioPreview(BED);
		expect(audioPreviewState()).toMatchObject({ url: BED, playing: true });

		toggleAudioPreview(SFX);
		expect(audioPreviewState()).toMatchObject({ url: SFX, playing: true });
		// One element: the second clip's src assignment is what stopped the first.
		expect(FakeAudio.live).toHaveLength(1);
		expect(el().src).toBe(SFX);
	});

	test("every surface shares one element, however many previews are on screen", () => {
		toggleAudioPreview(BED);
		toggleAudioPreview(SFX);
		toggleAudioPreview(BED);
		expect(FakeAudio.live).toHaveLength(1);
	});

	test("pressing the sounding clip pauses it where it is", () => {
		toggleAudioPreview(BED);
		el().advanceTo(12);
		toggleAudioPreview(BED);
		expect(audioPreviewState()).toMatchObject({ url: BED, playing: false, positionSec: 12 });
	});

	test("pressing it again resumes rather than restarting", () => {
		toggleAudioPreview(BED);
		el().advanceTo(12);
		toggleAudioPreview(BED);
		toggleAudioPreview(BED);
		expect(audioPreviewState()).toMatchObject({ playing: true, positionSec: 12 });
		expect(el().currentTime).toBe(12);
	});

	test("a clip that ends releases the playing state", () => {
		toggleAudioPreview(BED);
		el().emit("ended");
		expect(audioPreviewState()).toMatchObject({ playing: false, positionSec: 0 });
	});

	test("a failed load does not leave a control stuck as playing", () => {
		toggleAudioPreview(BED);
		el().emit("error");
		expect(audioPreviewState()).toMatchObject({ url: null, playing: false });
	});
});

describe("seeking moves playback, and the elapsed reading follows", () => {
	test("seeking sets the position on the element and in the state", () => {
		toggleAudioPreview(BED);
		el().loadTo(60);
		seekAudioPreview(BED, 25);
		expect(el().currentTime).toBe(25);
		expect(audioPreviewState().positionSec).toBe(25);
	});

	test("playback advancing updates the reading", () => {
		toggleAudioPreview(BED);
		el().advanceTo(7.5);
		expect(audioPreviewState().positionSec).toBe(7.5);
	});

	test("a seek past the end is clamped to the duration", () => {
		toggleAudioPreview(BED);
		el().loadTo(30);
		seekAudioPreview(BED, 999);
		expect(audioPreviewState().positionSec).toBe(30);
	});

	test("a negative seek is clamped to zero", () => {
		toggleAudioPreview(BED);
		el().loadTo(30);
		seekAudioPreview(BED, -5);
		expect(audioPreviewState().positionSec).toBe(0);
	});

	test("seeking a clip that is not loaded loads it, paused", () => {
		toggleAudioPreview(BED);
		seekAudioPreview(SFX, 3);
		expect(el().src).toBe(SFX);
		expect(audioPreviewState()).toMatchObject({ url: SFX, playing: false, positionSec: 3 });
	});

	test("a stream of unknown length reports no duration rather than Infinity", () => {
		toggleAudioPreview(BED);
		el().loadTo(Number.POSITIVE_INFINITY);
		expect(audioPreviewState().durationSec).toBe(0);
	});
});

describe("subscribers", () => {
	test("a subscriber is given the current state immediately", () => {
		toggleAudioPreview(BED);
		let seen: string | null | undefined;
		subscribeAudioPreview((s) => {
			seen = s.url;
		});
		expect(seen).toBe(BED);
	});

	test("unsubscribing stops delivery", () => {
		let calls = 0;
		const off = subscribeAudioPreview(() => {
			calls += 1;
		});
		const afterSubscribe = calls;
		off();
		toggleAudioPreview(BED);
		expect(calls).toBe(afterSubscribe);
	});

	test("stopping publishes to every subscriber", () => {
		const seen: boolean[] = [];
		subscribeAudioPreview((s) => seen.push(s.playing));
		toggleAudioPreview(BED);
		stopAudioPreview();
		expect(seen.at(-1)).toBe(false);
	});
});
