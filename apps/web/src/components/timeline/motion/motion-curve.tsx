/* What a keyframe track LOOKS like: the curve behind a lane, and the rail icon
 * for a layer.
 *
 * Split out of `motion-studio-modal.tsx` with the keyframe helpers. These read
 * nothing from the modal either — a track and a layer in, an element out. */
import { useMemo, type JSX } from "react";
import { evalTrack } from "@maleo/video/composition";
import type { CompositionLayer, ValueKeyframe } from "@maleo/shared";
import { Ic } from "@design-system/icons/index.tsx";
import type { MotionStudioTrack } from "@models/timeline/motion-vui-adapter.ts";
import { PROP_BASE } from "./motion-keyframes.ts";

/** SVG polyline of a track's value curve, sampled through `evalTrack` so the
 * drawn curve is exactly the animation the renderer plays. */
function CurvePath({ kfs, base }: { kfs: ValueKeyframe[]; base: number }): JSX.Element {
	const points = useMemo(() => {
		const n = 48;
		const values: number[] = [];
		for (let i = 0; i <= n; i += 1) values.push(evalTrack(kfs, i / n, base));
		let lo = Math.min(...values);
		let hi = Math.max(...values);
		if (hi - lo < 1e-6) {
			lo -= 1;
			hi += 1;
		}
		return values.map((v, i) => `${(i / n) * 100},${22 - ((v - lo) / (hi - lo)) * 18}`).join(" ");
	}, [kfs, base]);
	return (
		<svg className="tl2-studio-curve" viewBox="0 0 100 26" preserveAspectRatio="none" aria-hidden>
			<polyline
				points={points}
				fill="none"
				stroke="currentColor"
				strokeWidth="1.4"
				vectorEffect="non-scaling-stroke"
			/>
		</svg>
	);
}

/* The curve drawn behind a track's keyframes.
 *
 * Its own component for the same reason `onTrack` exists: reading the keyframe
 * array beside a `track.kind` check produces a union the narrowing cannot
 * reach, so the render used to assert the array on every branch. Here the read
 * happens inside the branch and the types stay correlated. */
export function TrackCurve({
	track,
	anim,
}: {
	track: MotionStudioTrack;
	anim: CompositionLayer["anim"];
}): JSX.Element | null {
	if (!anim) return null;
	if (track.kind === "value") {
		const kfs = anim.tracks[track.prop];
		return kfs ? <CurvePath kfs={kfs} base={PROP_BASE[track.prop]} /> : null;
	}
	const kfs = anim.colorTracks?.[track.prop];
	if (!kfs) return null;
	const stops = `${kfs[0]?.v ?? "#fff"}, ${kfs[kfs.length - 1]?.v ?? "#fff"}`;
	return (
		<div
			className="tl2-studio-curve"
			style={{ background: `linear-gradient(90deg, ${stops})`, opacity: 0.72 }}
		/>
	);
}

/** Rail icon per layer kind: text glyph, square, circle. */
export function layerIcon(o: CompositionLayer, size = 16): JSX.Element {
	if (o.preset === "shape-rect") return Ic.rect(size);
	if (o.preset === "shape-circle") return Ic.circle(size);
	return Ic.type(size);
}
