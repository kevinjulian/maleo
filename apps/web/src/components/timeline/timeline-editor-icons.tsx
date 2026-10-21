/* Maleo — timeline editor glyph helpers.
 *
 * The drawings live in the registry (design-system/icons, Lucide). What stays
 * here is the timeline's habit of choosing a glyph by a flag — redo is undo
 * with `flip`, the end-jump is the start-jump with `end`, a track toggle has an
 * on and an off look — so call sites keep reading `UndoIcon(15, true)` while
 * the art comes from one place. */
import type { JSX } from "react";
import { Ic } from "@design-system/icons/index.tsx";

export const UndoIcon = (s = 15, flip = false): JSX.Element => (flip ? Ic.redo(s) : Ic.undo(s));
export const JumpIcon = (s = 15, end = false): JSX.Element =>
	end ? Ic.skipForward(s) : Ic.skipBack(s);

const ASPECT_GLYPH: Record<string, (s?: number) => JSX.Element> = {
	desktop: Ic.monitor,
	square: Ic.square,
	portrait: Ic.rectVertical,
};
export const AspectIcon = ({ kind, s = 15 }: { kind: string; s?: number }): JSX.Element =>
	(ASPECT_GLYPH[kind] ?? Ic.smartphone)(s);

// Track-header toggles: the struck-through look is the "off" glyph.
export const HeadIc = {
	eye: (hidden: boolean, s = 14): JSX.Element => (hidden ? Ic.eyeOff(s) : Ic.eye(s)),
	lock: (locked: boolean, s = 14): JSX.Element => (locked ? Ic.lock(s) : Ic.lockOpen(s)),
	mute: (muted: boolean, s = 14): JSX.Element => (muted ? Ic.volumeOff(s) : Ic.volume(s)),
};
