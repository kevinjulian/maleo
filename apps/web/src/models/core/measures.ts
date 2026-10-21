/* Maleo — Content-First Create · Data, helpers, constants, types */

export function fmtMMSS(sec: number): string {
	const v = Math.max(0, Math.round(sec || 0));
	const m = Math.floor(v / 60);
	const s = v % 60;
	return m + ":" + String(s).padStart(2, "0");
}

export function parseMMSS(str: string | number | null | undefined): number {
	if (str == null) return 0;
	const p = String(str).trim().split(":");
	if (p.length >= 2) {
		const m = parseInt(p[0]) || 0;
		const s = parseInt(p[1]) || 0;
		return m * 60 + Math.min(59, Math.max(0, s));
	}
	return parseInt(String(str)) || 0;
}

/* ════ Format → aspect ════ */

/* The formats the client can express as a ratio, as a table rather than a
 * ternary chain, so the supported set can be enumerated.
 *
 * It was `fmt === "16:9" ? 16/9 : fmt === "1:1" ? 1 : 9/16`, which cannot be
 * asked what it supports and whose fallback is indistinguishable from a real
 * answer — `aspectOf("4:5")` and `aspectOf("nonsense")` both returned 9/16.
 * That is how `4:5` stayed selectable in the timeline while no layer of the
 * render pipeline implemented it. Adding a format here is not enough on its
 * own; see render-option-parity.test.ts for what else has to carry it. */
export const ASPECT_RATIOS: Record<string, number> = {
	"16:9": 16 / 9,
	"9:16": 9 / 16,
	"1:1": 1,
};

export function aspectOf(fmt: string | undefined): number {
	return ASPECT_RATIOS[fmt ?? ""] ?? ASPECT_RATIOS["9:16"]!;
}

/** Keep editor-owned timeline placement when a live agent job patches scene content. */

export function hashHue(s: string | undefined): number {
	let h = 0;
	for (const c of String(s || "")) h = (h * 31 + c.charCodeAt(0)) % 360;
	return h;
}

/* ════ Reference roles ════
 *
 * The role vocabulary is NOT defined here — it comes from @maleo/shared, which
 * the DB also constrains via a CHECK on reference_entity.role. This file supplies
 * only presentation (label, icon, hue) for each role.
 *
 * Previously this was a local `REF_KINDS` map plus a local order array, and the UI
 * resolved a ref's role as `tags[0]` with a "style" fallback while the backend used
 * a "character" fallback — so one reference rendered as Style and bound as
 * Character at generation. `video` also lived on this axis in the UI only: inspo
 * and competitor clips are pacing references, never generation inputs, so they
 * belong on the asset-type axis. `prop` was specified but never implemented here. */

const GEN_GRADS: [string, string][] = [
	["#e8d5f5", "#c2dcff"],
	["#ffd6e7", "#e8d5f5"],
	["#d4f0e0", "#c2dcff"],
	["#fce3c7", "#ffd6e7"],
	["#c4c1ff", "#d4f0e0"],
	["#c2dcff", "#c4c1ff"],
];

export function gradFor(seed: number): string {
	const g = GEN_GRADS[Math.abs(seed) % GEN_GRADS.length];
	return `linear-gradient(150deg, ${g[0]}, ${g[1]})`;
}

/* ════ Studio shots / moves / transitions ════ */
