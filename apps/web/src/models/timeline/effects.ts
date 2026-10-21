/* Shared effect compositor — the same math drives the editor preview and the
 * Remotion render so an effect looks identical on play and on export. */
import type { EffectClip, EffectKind } from "@maleo/shared";

export interface EffectState {
	blackOpacity: number;
	whiteOpacity: number;
	scale: number;
	translateXPct: number;
}

const clamp01 = (n: number): number => Math.max(0, Math.min(1, n));

// Per-effect contribution at local progress p (0→1 across the effect's span).
function contribution(effect: EffectKind, p: number): EffectState {
	if (effect === "fade_in")
		return { blackOpacity: 1 - p, whiteOpacity: 0, scale: 1, translateXPct: 0 };
	if (effect === "fade_out")
		return { blackOpacity: p, whiteOpacity: 0, scale: 1, translateXPct: 0 };
	// flash: triangular white spike — fast attack (30%), decay (70%). Pattern interrupt.
	if (effect === "flash")
		return {
			blackOpacity: 0,
			whiteOpacity: p < 0.3 ? p / 0.3 : 1 - (p - 0.3) / 0.7,
			scale: 1,
			translateXPct: 0,
		};
	// zoom_punch: fast snap-in that eases back. Pattern interrupt.
	if (effect === "zoom_punch")
		return {
			blackOpacity: 0,
			whiteOpacity: 0,
			scale: 1 + (p < 0.25 ? p / 0.25 : 1 - (p - 0.25) / 0.75) * 0.16,
			translateXPct: 0,
		};
	// whip_pan: single fast lateral sine sweep. Pattern interrupt.
	if (effect === "whip_pan")
		return {
			blackOpacity: 0,
			whiteOpacity: 0,
			scale: 1,
			translateXPct: Math.sin(p * Math.PI * 2) * 10,
		};
	// zoom_out_from_black: starts black + zoomed in, resolves to clear + normal.
	return {
		blackOpacity: clamp01(1 - p * 1.6),
		whiteOpacity: 0,
		scale: 1 + (1 - p) * 0.6,
		translateXPct: 0,
	};
}

// Combine all effects active at absolute time t (seconds). Black/white overlays
// take the max; scale multiplies; whip offsets add. Returns the neutral state
// when nothing is active.
export function computeEffects(
	effects: ReadonlyArray<{ effect: EffectKind; start: number; dur: number; intensity?: number }>,
	t: number,
): EffectState {
	let black = 0;
	let white = 0;
	let scale = 1;
	let translateX = 0;
	for (const e of effects) {
		if (t < e.start || t >= e.start + e.dur) continue;
		const p = e.dur > 0 ? clamp01((t - e.start) / e.dur) : 1;
		const k = e.intensity == null ? 1 : clamp01(e.intensity);
		const c = contribution(e.effect, p);
		black = Math.max(black, c.blackOpacity * k);
		white = Math.max(white, c.whiteOpacity * k);
		scale *= 1 + (c.scale - 1) * k; // intensity scales the deviation from neutral
		translateX += c.translateXPct * k;
	}
	return { blackOpacity: black, whiteOpacity: white, scale, translateXPct: translateX };
}

// ── Pattern-interrupt auto-injection ──
// Alternate zoom_punch / flash / whip_pan every `intervalSec`, skipping spots
// that already have an interrupt within half an interval. Returns ONLY the new
// clips (caller appends); ids count up from `baseId`.
const INTERRUPT_CYCLE: ReadonlyArray<{ effect: EffectKind; dur: number }> = [
	{ effect: "zoom_punch", dur: 0.5 },
	{ effect: "flash", dur: 0.35 },
	{ effect: "whip_pan", dur: 0.45 },
];
const INTERRUPT_KINDS = new Set<EffectKind>(["flash", "zoom_punch", "whip_pan"]);

export function autoPatternInterrupts(
	totalSec: number,
	intervalSec: number,
	existing: ReadonlyArray<Pick<EffectClip, "effect" | "start">>,
	baseId: number,
): EffectClip[] {
	if (totalSec <= intervalSec || intervalSec <= 0) return [];
	const taken = existing.filter((e) => INTERRUPT_KINDS.has(e.effect)).map((e) => e.start);
	const out: EffectClip[] = [];
	let cycle = 0;
	// Skip t=0 (the hook IS the interrupt) and stop short of the outro second.
	for (let t = intervalSec; t < totalSec - 1; t += intervalSec) {
		if (taken.some((s) => Math.abs(s - t) < intervalSec / 2)) continue;
		const pick = INTERRUPT_CYCLE[cycle % INTERRUPT_CYCLE.length]!;
		out.push({
			id: baseId + out.length,
			effect: pick.effect,
			start: Math.round(t * 10) / 10,
			dur: pick.dur,
			intensity: 1,
		});
		cycle++;
	}
	return out;
}
