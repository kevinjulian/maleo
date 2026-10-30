// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import type { PlayerRef } from "@remotion/player";
import { TransportControls } from "@design-system/patterns/transport.tsx";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
const { act, createElement } = await import("react");
const { createRoot } = await import("react-dom/client");
const { useRemotionPlayhead } = await import("@hooks/timeline/use-remotion-playhead.ts");
type Playhead = ReturnType<typeof useRemotionPlayhead>;

/* A player that only does what the hook asks of it, and says so through the
 * same events Remotion fires. */
function fakePlayer(): PlayerRef & { calls: string[]; frame: (frame: number) => void } {
	const target = new EventTarget();
	let playing = false;
	const calls: string[] = [];
	const emit = (type: string): void => {
		target.dispatchEvent(new Event(type));
	};
	return {
		calls,
		frame: (frame: number) =>
			target.dispatchEvent(new CustomEvent("frameupdate", { detail: { frame } })),
		isPlaying: () => playing,
		play: () => {
			calls.push("play");
			playing = true;
			emit("play");
		},
		pause: () => {
			calls.push("pause");
			playing = false;
			emit("pause");
		},
		seekTo: () => {},
		addEventListener: (type: string, listener: EventListener) =>
			target.addEventListener(type, listener),
		removeEventListener: (type: string, listener: EventListener) =>
			target.removeEventListener(type, listener),
	} as unknown as PlayerRef & { calls: string[]; frame: (frame: number) => void };
}

let latest: Playhead;
function Harness({ ready = true }: { ready?: boolean }) {
	latest = useRemotionPlayhead(30, 900, undefined, ready);
	return null;
}
let root: ReturnType<typeof createRoot>;
let container: HTMLDivElement;
beforeEach(async () => {
	container = document.createElement("div");
	root = createRoot(container);
	await act(async () => root.render(createElement(Harness)));
});
afterEach(async () => {
	await act(async () => root.unmount());
	vi.useRealTimers();
	vi.restoreAllMocks();
});

/* Under load the preview's player attaches after the transport is clickable.
 * Play pressed in that window used to flip the button to "Pause" and never
 * start the player, leaving a transport that claimed to play at 0:00. */
test("play pressed before the player arrives starts it when it does", async () => {
	await act(async () => latest.togglePlay());
	const player = fakePlayer();
	await act(async () => {
		latest.playerRef.current = player;
	});
	expect(player.calls).toEqual(["play"]);
	expect(latest.playing).toBe(true);
});

test("play then pause before the player arrives leaves it stopped", async () => {
	await act(async () => latest.togglePlay());
	await act(async () => latest.togglePlay());
	const player = fakePlayer();
	await act(async () => {
		latest.playerRef.current = player;
	});
	expect(player.calls).toEqual([]);
	expect(latest.playing).toBe(false);
});

test("a seek before the player arrives cancels a pending play", async () => {
	await act(async () => latest.togglePlay());
	await act(async () => latest.seek(2));
	const player = fakePlayer();
	await act(async () => {
		latest.playerRef.current = player;
	});
	expect(player.calls).not.toContain("play");
	expect(latest.playing).toBe(false);
});

test("unready Play never queues autoplay, including before player attachment", async () => {
	await act(async () => root.render(createElement(Harness, { ready: false })));
	await act(async () => latest.togglePlay());
	const player = fakePlayer();
	await act(async () => {
		latest.playerRef.current = player;
	});
	await act(async () => latest.playerRef.current?.play());
	expect(player.calls).not.toContain("play");
	expect(latest.playhead.get()).toBe(0);
	await act(async () => root.render(createElement(Harness, { ready: true })));
	expect(player.calls).not.toContain("play");
	expect(latest.playing).toBe(false);
	await act(async () => latest.togglePlay());
	expect(player.calls.at(-1)).toBe("play");
});

test("the gated Player retains inherited event methods", async () => {
	const player = fakePlayer();
	Object.setPrototypeOf(player, {
		addEventListener: player.addEventListener,
		removeEventListener: player.removeEventListener,
	});
	Reflect.deleteProperty(player, "addEventListener");
	Reflect.deleteProperty(player, "removeEventListener");
	await act(async () => {
		latest.playerRef.current = player;
	});
	await act(async () => latest.togglePlay());
	expect(latest.playing).toBe(true);
	await act(async () => latest.togglePlay());
	expect(latest.playing).toBe(false);
});

test("media invalidation pauses, rejects programmatic starts and preserves paused seeking", async () => {
	const player = fakePlayer();
	await act(async () => {
		latest.playerRef.current = player;
	});
	await act(async () => latest.togglePlay());
	await act(async () => root.render(createElement(Harness, { ready: false })));
	expect(player.isPlaying()).toBe(false);
	const playCount = player.calls.filter((call) => call === "play").length;
	await act(async () => {
		latest.playerRef.current?.play();
		latest.togglePlay();
	});
	expect(player.calls.filter((call) => call === "play")).toHaveLength(playCount);
	await act(async () => latest.seek(4));
	expect(latest.playhead.get()).toBe(4);
	await act(async () => root.render(createElement(Harness, { ready: true })));
	expect(player.isPlaying()).toBe(false);
	await act(async () => latest.playerRef.current?.play());
	expect(player.isPlaying()).toBe(true);
});

test("readiness loss cancels pending stall recovery without later autoplay", async () => {
	const player = await playingPlayer();
	await advance(1500);
	expect(player.calls).toEqual(["pause"]);
	await act(async () => root.render(createElement(Harness, { ready: false })));
	await advance(5000);
	await act(async () => root.render(createElement(Harness, { ready: true })));
	await advance(100);
	expect(player.calls).not.toContain("play");
	expect(latest.playing).toBe(false);
});

function TransportHarness() {
	const transport = useRemotionPlayhead(30, 900);
	latest = transport;
	return createElement(TransportControls, {
		playing: transport.playing,
		onTogglePlay: transport.togglePlay,
		currentSec: 0,
		durationSec: 30,
	});
}

test("Play forwards its click event during capture, and a second click pauses once", async () => {
	await act(async () => root.render(createElement(TransportHarness)));
	const player = fakePlayer();
	const play = vi.spyOn(player, "play");
	await act(async () => {
		latest.playerRef.current = player;
	});
	const button = container.querySelector<HTMLButtonElement>('[data-transport="play"]')!;
	const click = new MouseEvent("click", { bubbles: true });
	await act(async () => {
		button.dispatchEvent(click);
	});
	const event = play.mock.calls[0]?.[0];
	expect(event?.nativeEvent).toBe(click);
	expect(event?.eventPhase).toBe(Event.CAPTURING_PHASE);
	expect(player.calls).toEqual(["play"]);
	await act(async () => {
		button.click();
	});
	expect(player.calls).toEqual(["play", "pause"]);
});

async function playingPlayer(frame: number | null = 30) {
	vi.useFakeTimers();
	vi.setSystemTime(0);
	vi.spyOn(performance, "now").mockImplementation(() => Date.now());
	const player = fakePlayer();
	await act(async () => {
		latest.playerRef.current = player;
	});
	await act(async () => {
		latest.togglePlay();
		if (frame !== null) player.frame(frame);
	});
	player.calls.length = 0;
	return player;
}

async function advance(ms: number) {
	await act(async () => {
		await vi.advanceTimersByTimeAsync(ms);
	});
}

test("a stationary playing frame triggers pause then play after 1500 ms", async () => {
	const player = await playingPlayer();
	await advance(1499);
	expect(player.calls).toEqual([]);
	await advance(1);
	expect(player.calls).toEqual(["pause"]);
	await advance(100);
	expect(player.calls).toEqual(["pause", "play"]);
	expect(latest.stalled).toBe(false);
});

test("two unsuccessful recoveries stop playback and report a stall", async () => {
	const player = await playingPlayer();
	await advance(5000);
	expect(player.calls).toEqual(["pause", "play", "pause", "play", "pause"]);
	expect(latest.stalled).toBe(true);
	expect(latest.playing).toBe(false);
});

test("frame progress clears the recovery count", async () => {
	const player = await playingPlayer();
	await advance(1600);
	await act(async () => player.frame(31));
	player.calls.length = 0;
	await advance(3500);
	expect(player.calls).toEqual(["pause", "play", "pause", "play"]);
	expect(latest.stalled).toBe(false);
});

test("a paused player never triggers recovery", async () => {
	const player = await playingPlayer();
	await act(async () => latest.togglePlay());
	player.calls.length = 0;
	await advance(5000);
	expect(player.calls).toEqual([]);
	expect(latest.stalled).toBe(false);
});

test("a seek during playback resets the stall timer", async () => {
	const player = await playingPlayer();
	await advance(1000);
	await act(async () => latest.seek(2, false));
	await advance(1000);
	expect(player.calls).toEqual([]);
	expect(latest.stalled).toBe(false);
});

test("playback without a first frame event never triggers recovery", async () => {
	const player = await playingPlayer(null);
	await advance(5000);
	expect(player.calls).toEqual([]);
	expect(latest.stalled).toBe(false);
});

test("the last frame never triggers recovery", async () => {
	const player = await playingPlayer(899);
	await advance(5000);
	expect(player.calls).toEqual([]);
	expect(latest.stalled).toBe(false);
});

test.each(["play", "seek", "frame"])("%s clears a reported stall", async (action) => {
	const player = await playingPlayer();
	await advance(5000);
	expect(latest.stalled).toBe(true);
	await act(async () => {
		if (action === "play") latest.togglePlay();
		else if (action === "seek") latest.seek(2);
		else player.frame(31);
	});
	expect(latest.stalled).toBe(false);
});
