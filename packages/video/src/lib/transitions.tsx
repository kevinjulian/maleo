import React from "react";
import { AbsoluteFill } from "remotion";
import { linearTiming } from "@remotion/transitions";
import { fade } from "@remotion/transitions/fade";
import { wipe } from "@remotion/transitions/wipe";
import { flip } from "@remotion/transitions/flip";
import { clockWipe } from "@remotion/transitions/clock-wipe";
import { none } from "@remotion/transitions/none";
import type {
	TransitionPresentation,
	TransitionPresentationComponentProps,
} from "@remotion/transitions";

export type TransitionId =
	| "cut"
	| "fade"
	| "slide"
	| "zoom"
	| "wipe"
	| "flip"
	| "clock_wipe"
	| "pixel";

const TRANSITION_FRAMES = 12;

type SlideProps = Record<string, unknown>;
export const SlidePresentation: React.FC<TransitionPresentationComponentProps<SlideProps>> = ({
	children,
	presentationProgress,
	presentationDirection,
}) => {
	const entering = presentationDirection === "entering";
	const translateX = entering ? (1 - presentationProgress) * 100 : -presentationProgress * 100;
	return (
		<AbsoluteFill style={{ transform: `translateX(${translateX}%)` }}>{children}</AbsoluteFill>
	);
};
function slideBoth(): TransitionPresentation<SlideProps> {
	return { component: SlidePresentation, props: {} };
}

// Zoom cross-transition: the outgoing scene pushes in while the incoming scene
// settles from a slight over-zoom, cross-faded. Pure opacity/transform (no
// canvas shader), so it renders identically in preview and headless export.
type ZoomProps = Record<string, unknown>;
const ZoomPresentation: React.FC<TransitionPresentationComponentProps<ZoomProps>> = ({
	children,
	presentationProgress,
	presentationDirection,
}) => {
	const entering = presentationDirection === "entering";
	const scale = entering ? 1.12 - 0.12 * presentationProgress : 1 + 0.12 * presentationProgress;
	const opacity = entering ? presentationProgress : 1 - presentationProgress;
	return <AbsoluteFill style={{ opacity, transform: `scale(${scale})` }}>{children}</AbsoluteFill>;
};
function zoom(): TransitionPresentation<ZoomProps> {
	return { component: ZoomPresentation, props: {} };
}

type PixelProps = Record<string, unknown>;
const PixelPresentation: React.FC<TransitionPresentationComponentProps<PixelProps>> = ({
	children,
	presentationProgress,
	presentationDirection,
}) => {
	const entering = presentationDirection === "entering";
	const step = Math.floor(presentationProgress * 9) / 9;
	const opacity = entering ? step : 1 - step;
	const scale = entering ? 1.04 - step * 0.04 : 1 + step * 0.03;
	return (
		<AbsoluteFill style={{ opacity, scale, imageRendering: "pixelated" }}>
			{children}
			<AbsoluteFill
				style={{
					opacity: 0.22 * (1 - Math.abs(0.5 - presentationProgress) * 2),
					backgroundImage:
						"linear-gradient(90deg, rgba(255,255,255,0.45) 1px, transparent 1px), linear-gradient(0deg, rgba(255,255,255,0.45) 1px, transparent 1px)",
					backgroundSize: "46px 46px",
					mixBlendMode: "overlay",
				}}
			/>
		</AbsoluteFill>
	);
};
function pixel(): TransitionPresentation<PixelProps> {
	return { component: PixelPresentation, props: {} };
}

/** A transition ready for `<TransitionSeries.Transition>`: the presentation with
 *  its props already baked in, and the timing that drives it. The presentation's
 *  prop type is erased to `Record<string, unknown>` because Remotion types each
 *  presentation with its own props and the renderer supplies none. */
export interface ResolvedTransition {
	presentation: TransitionPresentation<Record<string, unknown>>;
	timing: ReturnType<typeof linearTiming>;
}

export function resolveTransition(
	id?: TransitionId,
	durationFrames?: number,
	dims?: { width: number; height: number },
): ResolvedTransition {
	const frames =
		durationFrames && durationFrames > 0 ? Math.round(durationFrames) : TRANSITION_FRAMES;
	const timing = linearTiming({ durationInFrames: frames });

	switch (id) {
		case "cut":
			return { presentation: none(), timing: linearTiming({ durationInFrames: 1 }) };
		case "slide":
			return { presentation: slideBoth(), timing };
		case "wipe":
			return { presentation: wipe(), timing };
		case "zoom":
			return { presentation: zoom(), timing };
		case "flip":
			// SAFETY: `flip()` and `clockWipe()` carry their own prop types, which this
			// erases to the caller-facing `Record` shape. Sound because the props are
			// baked in at construction — the returned presentation is called with no
			// props by the renderer, so the erased type is never used to supply any.
			return {
				presentation: flip() as unknown as TransitionPresentation<Record<string, unknown>>,
				timing,
			};
		case "clock_wipe":
			// clockWipe needs the composition size; without it, fall back to wipe.
			// SAFETY: as above — props baked in at construction, never supplied later.
			return dims
				? {
						presentation: clockWipe({
							width: dims.width,
							height: dims.height,
						}) as unknown as TransitionPresentation<Record<string, unknown>>,
						timing,
					}
				: { presentation: wipe(), timing };
		case "pixel":
			return { presentation: pixel(), timing };
		case "fade":
		case undefined:
		default:
			return { presentation: fade(), timing };
	}
}
