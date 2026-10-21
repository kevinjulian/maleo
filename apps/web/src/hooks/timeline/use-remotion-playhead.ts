import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RefObject, SyntheticEvent } from "react";
import type { PlayerRef } from "@remotion/player";
import { flushSync } from "react-dom";
import { createPlayheadHandle, type PlayheadHandle } from "@models/timeline/playhead-handle.ts";

const STALL_MS = 1500;
const STALL_CHECK_MS = 250;
const MAX_RECOVERIES = 2;

export interface RemotionPlayhead {
	/** The position, as a handle rather than a number — see `playhead-handle.ts`.
	 *  Consumers that display the time subscribe; everything else reads `get()`
	 *  when it runs, so the player's frame events cost no render. */
	playhead: PlayheadHandle;
	playing: boolean;
	stalled: boolean;
	seek: (sec: number, pause?: boolean) => void;
	togglePlay: (event?: SyntheticEvent) => void;
	/** Give this to the preview. It is the hook's, not the caller's, because the
	 *  hook has to know WHEN the player arrives — see the note on `player`. */
	playerRef: RefObject<PlayerRef | null>;
}

export function useRemotionPlayhead(
	fps: number,
	durationFrames: number,
	syncKey?: unknown,
): RemotionPlayhead {
	const playhead = useMemo(() => createPlayheadHandle(0), []);
	const [playing, setPlaying] = useState(false);
	const [stalled, setStalled] = useState(false);
	const stall = useRef<{ frame: number | null; changedAt: number; recoveries: number }>({
		frame: null,
		changedAt: 0,
		recoveries: 0,
	});
	const pendingRecovery = useRef<number | null>(null);
	const resetStall = useCallback(() => {
		if (pendingRecovery.current !== null) cancelAnimationFrame(pendingRecovery.current);
		pendingRecovery.current = null;
		stall.current.changedAt = performance.now();
		stall.current.recoveries = 0;
		setStalled(false);
	}, []);
	/* The player, as state rather than as a ref read.
	 *
	 * Both studios shipped a transport that did nothing visible: play started the
	 * player and the timecode sat at 0:00 while the button kept saying "Play".
	 * The listeners below were attached by an effect that began
	 * `const player = playerRef.current; if (!player) return;` — and at mount
	 * Remotion has not attached its imperative handle yet, so it returned early
	 * every time. Nothing re-ran it, because assigning `.current` is not a
	 * render: `playerRef` is a stable object, so it never changed identity.
	 * Motion Studio passed no `syncKey` at all, and Template Studio's is stable
	 * once its draft loads, so neither ever got a second chance. The preview was
	 * playing the whole time with nothing subscribed to it.
	 *
	 * So the arrival is made into a render. A ref whose setter reports is used
	 * rather than a callback ref, because `VuiRemotionPreview` types this prop as
	 * a `RefObject` and reads `.current` in its own effects — a callback ref
	 * would satisfy React and break the package.
	 *
	 * Adding `playerRef.current` to the dependency array is not an alternative:
	 * deps are read during render, and the assignment happens in commit. That is
	 * the same shape as the timing flag this hook already records losing a race
	 * to, below. */
	const [player, setPlayer] = useState<PlayerRef | null>(null);
	const playerRef = useMemo<RefObject<PlayerRef | null>>(() => {
		let current: PlayerRef | null = null;
		return {
			get current(): PlayerRef | null {
				return current;
			},
			set current(next: PlayerRef | null) {
				if (next === current) return;
				current = next;
				setPlayer(next);
			},
		};
	}, []);
	/* The last frame this hook asked the player for.
	 *
	 * There used to be an effect that seeked the player whenever `playheadSec`
	 * changed, guarded by a flag set during `frameupdate` and cleared in a
	 * microtask. It could not work: `frameupdate` arrives in an animation frame,
	 * the flag clears on a microtask, and the effect runs after the commit the
	 * flag's own setState scheduled — three different queues, and the flag was
	 * reliably false by the time the effect read it. So the player was seeked
	 * back to the frame it had just reported, which emitted another
	 * `frameupdate`, which was the fourth commit of every click.
	 *
	 * The effect is gone: `seek` is the only thing that moves the player, so
	 * there is nothing left to mirror. What remains of the guard is this — a
	 * record of the frame already asked for, compared by identity rather than by
	 * timing, which is the lesson `use-timeline-rows.ts` records for row
	 * compaction ("asked by identity rather than by a timing flag, which loses
	 * the race"). */
	const lastSeekFrame = useRef<number | null>(null);
	/* Play pressed before the player arrives. Under load the preview attaches
	 * after the transport is clickable; that press used to flip the button to
	 * "Pause" and never start anything, so it is kept as intent and handed to the
	 * player when it lands. */
	const playWhenReady = useRef(false);
	const maxFrame = Math.max(0, durationFrames - 1);
	const durationSec = Math.max(0, maxFrame / fps);

	const seek = useCallback(
		(sec: number, pause = true): void => {
			resetStall();
			const next = Math.max(0, Math.min(durationSec, sec));
			if (pause) {
				playWhenReady.current = false;
				player?.pause();
				setPlaying(false);
			}
			playhead.set(next);
			const frame = Math.max(0, Math.min(maxFrame, Math.round(next * fps)));
			if (frame === lastSeekFrame.current) return;
			lastSeekFrame.current = frame;
			player?.seekTo(frame);
		},
		[durationSec, fps, maxFrame, player, playhead, resetStall],
	);

	const togglePlay = useCallback(
		(event?: SyntheticEvent): void => {
			resetStall();
			if (!player) {
				playWhenReady.current = !playWhenReady.current;
				setPlaying(playWhenReady.current);
				return;
			}
			if (playhead.get() >= durationSec) seek(0, false);
			if (player.isPlaying()) player.pause();
			else player.play(event);
		},
		[durationSec, player, playhead, seek, resetStall],
	);

	useEffect(() => {
		if (!player) return;
		resetStall();
		stall.current.frame = null;
		const onFrame = (event: { detail: { frame: number } }): void => {
			if (event.detail.frame !== stall.current.frame) {
				stall.current.frame = event.detail.frame;
				stall.current.changedAt = performance.now();
				stall.current.recoveries = 0;
				setStalled(false);
			}
			// The player is the authority while it plays, so record the frame it
			// reports as the one already asked for. Without this, the next seek to
			// the same frame would be skipped as a duplicate.
			lastSeekFrame.current = event.detail.frame;
			playhead.set(Math.min(durationSec, event.detail.frame / fps));
		};
		const onPlay = (): void => {
			// Internal restarts preserve the attempt count for this stationary frame.
			if (pendingRecovery.current === null) resetStall();
			else stall.current.changedAt = performance.now();
			setPlaying(true);
		};
		const onPause = (): void => {
			stall.current.changedAt = performance.now();
			setPlaying(false);
		};
		const onEnded = (): void => setPlaying(false);
		player.addEventListener("frameupdate", onFrame);
		player.addEventListener("play", onPlay);
		player.addEventListener("pause", onPause);
		player.addEventListener("ended", onEnded);
		player.addEventListener("seeked", resetStall);
		const interval = setInterval(() => {
			const state = stall.current;
			if (
				!player.isPlaying() ||
				state.frame === null ||
				state.frame >= maxFrame ||
				performance.now() - state.changedAt < STALL_MS
			)
				return;
			if (state.recoveries >= MAX_RECOVERIES) {
				player.pause();
				setStalled(true);
				return;
			}
			state.recoveries += 1;
			// Commit Remotion's pause effects before the next frame resumes its audio context.
			flushSync(() => player.pause());
			pendingRecovery.current = requestAnimationFrame(() => {
				player.play();
				pendingRecovery.current = null;
			});
		}, STALL_CHECK_MS);
		if (playWhenReady.current) {
			playWhenReady.current = false;
			player.play();
		}
		return () => {
			clearInterval(interval);
			if (pendingRecovery.current !== null) cancelAnimationFrame(pendingRecovery.current);
			pendingRecovery.current = null;
			player.removeEventListener("frameupdate", onFrame);
			player.removeEventListener("play", onPlay);
			player.removeEventListener("pause", onPause);
			player.removeEventListener("ended", onEnded);
			player.removeEventListener("seeked", resetStall);
		};
		/* `player` is what makes this run when the player arrives. `syncKey` stays
		 * for what it was for — rebinding when the consumer's composition changes
		 * underneath the same player — and is deliberately not what fixes the
		 * attachment: Motion Studio passes none and still plays. */
	}, [durationSec, fps, maxFrame, player, playhead, syncKey, resetStall]);

	return { playhead, playing, stalled, seek, togglePlay, playerRef };
}
