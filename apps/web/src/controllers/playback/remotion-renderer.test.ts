/* The Remotion adapter, tested by the suite that ships rather than by a private test.
 *
 * The distinction matters: a private test asserts what this adapter happens to
 * do, and the suite asserts what the contract says. If the two ever disagree,
 * the consumer running the suite is the one who finds out.
 */
import { describe, expect, test } from "vite-plus/test";
import { rendererConformance } from "@controllers/playback/renderer-conformance.ts";
import { describeFailures } from "@maleo/shared/editor";
import { framesToProject } from "@models/timeline-view/tick.ts";
import { rational } from "@models/timeline-view/rational.ts";
import { timebase } from "@models/timeline-view/timebase.ts";
import {
	clampFrameTo,
	createRemotionRenderer,
	type RemotionPlayerLike,
} from "./remotion-renderer.ts";

const BASE = timebase(rational(30, 1));
const DURATION_IN_FRAMES = 300;

/** A player that behaves the way Remotion's does: clamped, and event-driven. */
function fakePlayer(): RemotionPlayerLike & {
	frame: number;
	commands: string[];
	listenerCount(): number;
} {
	const listeners = new Map<string, Set<(event: { detail: { frame: number } }) => void>>();
	const player = {
		frame: 0,
		commands: [] as string[],
		addEventListener(name: string, listener: (event: { detail: { frame: number } }) => void) {
			const set = listeners.get(name) ?? new Set();
			set.add(listener);
			listeners.set(name, set);
		},
		removeEventListener(name: string, listener: (event: { detail: { frame: number } }) => void) {
			listeners.get(name)?.delete(listener);
		},
		seekTo(frame: number) {
			player.frame = clampFrameTo(frame, DURATION_IN_FRAMES);
			player.commands.push(`seek:${player.frame}`);
			for (const listener of listeners.get("frameupdate") ?? [])
				listener({ detail: { frame: player.frame } });
		},
		play() {
			player.commands.push("play");
			for (const listener of listeners.get("play") ?? [])
				listener({ detail: { frame: player.frame } });
		},
		pause() {
			player.commands.push("pause");
			for (const listener of listeners.get("pause") ?? [])
				listener({ detail: { frame: player.frame } });
		},
		listenerCount: () => [...listeners.values()].reduce((total, set) => total + set.size, 0),
	};
	return player;
}

function adapterFor(player = fakePlayer()) {
	return createRemotionRenderer(player, {
		widthPx: 1920,
		heightPx: 1080,
		durationInFrames: DURATION_IN_FRAMES,
		timebase: BASE,
	});
}

describe("remotion renderer adapter", () => {
	test("passes the shipped renderer conformance suite", () => {
		const report = rendererConformance({
			create: () => adapterFor(),
			timebase: BASE,
			seekTo: framesToProject(45, BASE),
		});
		expect(describeFailures(report)).toBeUndefined();
		expect(report.checks.length).toBe(8);
	});

	test("times cross the boundary through the timebase, in whole frames", () => {
		const player = fakePlayer();
		const adapter = adapterFor(player);

		adapter.seek(framesToProject(45, BASE));
		expect(player.commands).toEqual(["seek:45"]);
		expect(adapter.getSnapshot().currentTime.ticks).toBe(framesToProject(45, BASE).ticks);

		/* Half a frame lands on a frame, because a player has no other position to
		 * be at, and the adapter reports where the player actually is. */
		adapter.seek({
			domain: "project",
			ticks: framesToProject(45, BASE).ticks + BASE.ticksPerFrame / 2,
		});
		expect(player.commands[1]).toBe("seek:46");
	});

	test("the composition's bounds are the renderer's, at both ends", () => {
		const player = fakePlayer();
		const adapter = adapterFor(player);
		adapter.seek(framesToProject(10_000, BASE));
		expect(adapter.getSnapshot().currentTime.ticks).toBe(
			framesToProject(DURATION_IN_FRAMES - 1, BASE).ticks,
		);
		adapter.seek(framesToProject(-50, BASE));
		expect(adapter.getSnapshot().currentTime.ticks).toBe(0);
	});

	test("readiness waits for the player to report a frame", () => {
		const adapter = adapterFor();
		expect(adapter.getSnapshot().ready).toBe(false);
		adapter.seek(framesToProject(1, BASE));
		expect(adapter.getSnapshot().ready).toBe(true);
	});

	test("disposal removes every player listener and stops accepting commands", () => {
		const player = fakePlayer();
		const adapter = adapterFor(player);
		expect(player.listenerCount()).toBe(4);

		adapter.dispose();
		expect(player.listenerCount()).toBe(0);
		const before = player.commands.length;
		adapter.seek(framesToProject(60, BASE));
		adapter.play();
		expect(player.commands.length).toBe(before);
	});
});
