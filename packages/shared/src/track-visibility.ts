import type { TrackFlags } from "./timeline-model.ts";

export interface TrackVisibility {
	shown: (track?: number) => boolean;
	audible: (track?: number) => boolean;
	baseHidden: boolean;
	baseMuted: boolean;
}

export function trackVisibility(flags: TrackFlags): TrackVisibility {
	return {
		shown: (t?: number) => !flags[t ?? 0]?.hidden,
		audible: (t?: number) => !flags[t ?? 0]?.hidden && !flags[t ?? 0]?.muted,
		baseHidden: Boolean(flags[-1]?.hidden),
		baseMuted: Boolean(flags[-1]?.muted),
	};
}
