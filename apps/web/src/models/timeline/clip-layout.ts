// ClipLayout / ClipTextStyle are part of the shared timeline domain model (one
// source of truth, shared with the render worker). Re-exported so existing
// `./clip-layout.ts` imports keep resolving.
import {
	defaultClipLayout,
	type ClipKind,
	clipMaskSchema,
	clipColorSchema,
	clipBlendModeSchema,
	clipAnimationSchema,
	textAnimationSchema,
	type ClipLayout,
	type ClipTextStyle,
} from "@maleo/shared";
export type { ClipLayout, ClipTextStyle } from "@maleo/shared";

export type { ClipKind } from "@maleo/shared";
export function defaultTextStyle(preset?: string): ClipTextStyle {
	return {
		fontFamily: "Inter",
		fontSize: 64,
		weight: preset === "plain" ? 400 : 800,
		fill: "#ffffff",
		background: "transparent",
		accent: "#7C66FF",
		bodyFill: "#ffffff",
		bgOpacity: 0,
		scale: 1,
		align: "center",
		casing: preset === "plain" ? "none" : "upper",
	};
}

function valid<T>(result: { success: true; data: T } | { success: false }): T | undefined {
	return result.success ? result.data : undefined;
}

const clampPct = (n: number, lo = -50, hi = 150): number => Math.max(lo, Math.min(hi, n));

export function normalizeLayout(l: Partial<ClipLayout> | undefined, kind: ClipKind): ClipLayout {
	const base = defaultClipLayout(kind);
	if (!l) return base;
	// Reads tolerate a malformed field by dropping it; save and agent boundaries are where invalid input is refused.
	const mask =
		l.mask === null
			? null
			: l.mask === undefined
				? undefined
				: valid(clipMaskSchema.safeParse(l.mask));
	const color = l.color ? valid(clipColorSchema.safeParse(l.color)) : undefined;
	const blendMode = l.blendMode ? valid(clipBlendModeSchema.safeParse(l.blendMode)) : undefined;
	// Text keys style and colour tracks a visual clip cannot, so it validates against its own registry entries.
	const animation = l.animation
		? valid((kind === "text" ? textAnimationSchema : clipAnimationSchema).safeParse(l.animation))
		: undefined;
	return {
		...(mask === undefined ? {} : { mask }),
		...(color ? { color } : {}),
		...(blendMode ? { blendMode } : {}),
		...(animation ? { animation } : {}),
		xPct: clampPct(l.xPct ?? base.xPct),
		yPct: clampPct(l.yPct ?? base.yPct),
		widthPct: Math.max(2, Math.min(200, l.widthPct ?? base.widthPct)),
		heightPct: l.heightPct == null ? base.heightPct : Math.max(2, Math.min(200, l.heightPct)),
		fit: l.fit ?? base.fit,
		rotationDeg: l.rotationDeg ?? 0,
		aspectLocked: Boolean(l.aspectLocked),
		opacity: l.opacity == null ? 1 : Math.max(0, Math.min(1, l.opacity)),
		crop: l.crop,
		flipX: Boolean(l.flipX),
		flipY: Boolean(l.flipY),
		playbackRate: l.playbackRate == null ? 1 : Math.max(0.25, Math.min(4, l.playbackRate)),
		reverse: Boolean(l.reverse),
		reverseMedia: l.reverseMedia,
		preservePitch: l.preservePitch,
		audioMedia: l.audioMedia,
		sourceAudioExtraction: l.sourceAudioExtraction,
	};
}

/* ── The three widths a clip's geometry turns on ── */

/** A clip narrower than this is unreadable; the timeline has always clamped to
 *  it so a sub-second clip at wide zoom is at least a visible sliver. */
export const MIN_CLIP_PX = 16;

/** And unreachable below this, on a finger. 44px is the platform minimum, and
 *  padding a clip up to it is the one place this timeline stops telling the
 *  truth about duration — which is why the padding is drawn rather than applied
 *  silently. The alternative is a clip that cannot be tapped at all. */
export const TOUCH_MIN_CLIP_PX = 44;

/** Two 44px trim handles plus enough body left to grab. Below this a clip is
 *  moved by its body and must be zoomed into before it can be trimmed — there is
 *  no trim precision at that zoom anyway, so the handles would be a promise the
 *  geometry cannot keep. */
export const TOUCH_TRIM_MIN_PX = 132;

/** The trim handle's drawn width, matching `--tl2-handle-w` in tracks-interaction.css. */
export const CLIP_HANDLE_PX = 16;
