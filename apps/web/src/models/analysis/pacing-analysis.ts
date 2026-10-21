/* Pacing analysis — pure functions shared by the timeline insights strip
 * (density lane, retention heatmap, lint badges) and the chat critique agent.
 *
 * "Density" is stimulation-per-second: how much is changing on screen/in audio
 * at each second. Flat density = dead zone = predicted drop-off. All functions
 * are deterministic and side-effect free so they can be unit-tested and reused
 * server-side.
 */

export interface PacingSpan {
	start: number;
	dur: number;
}

export interface PacingScene extends PacingSpan {
	/** Camera movement label ("Static", "Slow Zoom In", ...). */
	move?: string;
}

export interface PacingInputs {
	totalSec: number;
	scenes: PacingScene[];
	/** Caption word windows (absolute seconds). */
	captionWords: Array<{ startSec: number; endSec: number }>;
	/** Visual/text/infographic overlay windows. */
	overlays: PacingSpan[];
	/** Non-voiceover audio hits (sfx / accent_hit) — stimulation spikes. */
	audioHits: PacingSpan[];
	/** Timeline effects (flash, zoom punch, fades...). */
	effects: PacingSpan[];
}

export type PacingSeverity = "high" | "warn" | "info";

export interface PacingFinding {
	code:
		| "weak_hook"
		| "static_scene"
		| "long_scene"
		| "dead_zone"
		| "caption_gap"
		| "viewer_overload";
	severity: PacingSeverity;
	startSec: number;
	endSec: number;
	message: string;
}

const STATIC_MOVES = new Set(["", "static", "none", "hold"]);

function overlaps(span: PacingSpan, sec: number): boolean {
	return sec >= span.start && sec < span.start + span.dur;
}

/** Stimulation score for each whole second [0..totalSec). Unbounded scale;
 *  ~0 = nothing happening, 3+ = busy. */
export function densityPerSecond(inputs: PacingInputs): number[] {
	const total = Math.max(1, Math.ceil(inputs.totalSec));
	const out: number[] = [];
	for (let sec = 0; sec < total; sec++) {
		let score = 0;
		for (const s of inputs.scenes) {
			// A cut landing inside this second is a strong stimulus.
			if (s.start >= sec && s.start < sec + 1 && s.start > 0) score += 1.4;
			// Camera motion keeps the frame alive at a low simmer.
			if (overlaps(s, sec) && !STATIC_MOVES.has((s.move ?? "").toLowerCase())) score += 0.5;
		}
		for (const o of inputs.overlays) {
			if (o.start >= sec && o.start < sec + 1) score += 1; // overlay entrance
			else if (overlaps(o, sec)) score += 0.3; // overlay present
		}
		for (const w of inputs.captionWords) {
			if (w.startSec >= sec && w.startSec < sec + 1) score += 0.25; // active-word churn
		}
		for (const a of inputs.audioHits) {
			if (a.start >= sec && a.start < sec + 1) score += 0.8;
		}
		for (const e of inputs.effects) {
			if (e.start >= sec && e.start < sec + 1) score += 1;
		}
		out.push(Math.round(score * 100) / 100);
	}
	return out;
}

/** Heuristic viewer-retention curve, one value per second in [0,1]. Starts at 1;
 *  each second loses a base rate plus a boredom penalty when density sags. The
 *  first 3 seconds (hook window) are penalized double — short-form drop-off is
 *  front-loaded. */
export function retentionCurve(density: number[], targetDensity = 2.2): number[] {
	let retained = 1;
	const out: number[] = [];
	for (let sec = 0; sec < density.length; sec++) {
		const value = density[sec] ?? 0;
		const boredom = Math.max(0, 1 - value / targetDensity);
		const overload = Math.max(0, value / targetDensity - 1.5);
		const hookMultiplier = sec < 3 ? 2 : 1;
		retained *= 1 - (0.006 + 0.035 * boredom + 0.02 * overload) * hookMultiplier;
		out.push(Math.round(retained * 1000) / 1000);
	}
	return out;
}

/** ESLint-for-boredom: timestamped findings sorted by start time. */
export function lintPacing(inputs: PacingInputs): PacingFinding[] {
	const findings: PacingFinding[] = [];
	const density = densityPerSecond(inputs);

	// Weak hook: first 3 seconds under-stimulated.
	const hookDensity = density.slice(0, 3);
	if (hookDensity.length && hookDensity.reduce((a, b) => a + b, 0) / hookDensity.length < 1) {
		findings.push({
			code: "weak_hook",
			severity: "high",
			startSec: 0,
			endSec: 3,
			message:
				"Hook (0–3s) is under-stimulated — add a cut, overlay, or caption punch before viewers swipe.",
		});
	}

	for (const s of inputs.scenes) {
		const isStatic = STATIC_MOVES.has((s.move ?? "").toLowerCase());
		if (isStatic && s.dur > 4) {
			findings.push({
				code: "static_scene",
				severity: "warn",
				startSec: s.start,
				endSec: s.start + s.dur,
				message: `${s.dur.toFixed(1)}s static shot — add camera motion or split with a cut.`,
			});
		} else if (s.dur > 7) {
			findings.push({
				code: "long_scene",
				severity: "info",
				startSec: s.start,
				endSec: s.start + s.dur,
				message: `${s.dur.toFixed(1)}s scene — consider a pattern interrupt to reset attention.`,
			});
		}
	}

	// High density is cognitive overload, not infinite engagement. One-second
	// spikes can be intentional; sustained overload blocks comprehension.
	let overloadStart = -1;
	for (let sec = 0; sec <= density.length; sec++) {
		const overloaded = sec < density.length && (density[sec] ?? 0) >= 4.2;
		if (overloaded && overloadStart < 0) overloadStart = sec;
		if (!overloaded && overloadStart >= 0) {
			const duration = sec - overloadStart;
			findings.push({
				code: "viewer_overload",
				severity: duration >= 2 ? "high" : "warn",
				startSec: overloadStart,
				endSec: sec,
				message:
					duration >= 2
						? `${duration}s of competing viewer cues. Keep one primary message.`
						: "Short attention spike. Verify it is intentional.",
			});
			overloadStart = -1;
		}
	}

	// Dead zones: 2+ consecutive seconds with (near-)zero stimulation.
	let runStart = -1;
	for (let sec = 0; sec <= density.length; sec++) {
		const dead = sec < density.length && (density[sec] ?? 0) < 0.35;
		if (dead && runStart < 0) runStart = sec;
		if (!dead && runStart >= 0) {
			if (sec - runStart >= 2) {
				findings.push({
					code: "dead_zone",
					severity: "warn",
					startSec: runStart,
					endSec: sec,
					message: `${sec - runStart}s with nothing changing on screen — dead zone.`,
				});
			}
			runStart = -1;
		}
	}

	// Caption gaps: silence between consecutive words while captions are in use.
	const words = [...inputs.captionWords].sort((a, b) => a.startSec - b.startSec);
	for (let i = 1; i < words.length; i++) {
		const gap = words[i]!.startSec - words[i - 1]!.endSec;
		if (gap > 1.5) {
			findings.push({
				code: "caption_gap",
				severity: "info",
				startSec: words[i - 1]!.endSec,
				endSec: words[i]!.startSec,
				message: `${gap.toFixed(1)}s caption gap — trim the pause or fill with a visual beat.`,
			});
		}
	}

	return findings.sort((a, b) => a.startSec - b.startSec);
}
