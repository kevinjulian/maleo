/* Pacing insights for the timeline: the density lane, the retention heatmap and
 * the lint findings behind them.
 *
 * `buildInputs` is separate from `pacing` because the chat Critique action needs
 * the same inputs while the insights strip is toggled off.
 */
import { useCallback, useMemo, useState } from "react";
import type { EffectClip, AudioOverlay, Scene, TextOverlay, VideoOverlay } from "@maleo/shared";
import {
	densityPerSecond,
	lintPacing,
	retentionCurve,
	type PacingInputs,
} from "@models/analysis/pacing-analysis.ts";

export interface TimedScene {
	start: number;
	dur: number;
	move?: string;
	name?: string;
	vo?: string;
}

/** What one pacing pass needs: the analyzer's inputs, and the scene timings the
 *  UI overlays them on. Built together because both derive from the same walk. */
interface PacingBuild {
	inputs: PacingInputs;
	timedScenes: TimedScene[];
}

export interface PacingInsights {
	insightsOn: boolean;
	setInsightsOn: (on: boolean | ((prev: boolean) => boolean)) => void;
	buildPacingInputs: () => { inputs: PacingInputs; timedScenes: TimedScene[] };
	pacing: {
		density: ReturnType<typeof densityPerSecond>;
		retention: ReturnType<typeof retentionCurve>;
		findings: ReturnType<typeof lintPacing>;
	} | null;
}

export function usePacingInsights(args: {
	scenes: Scene[];
	overlays: TextOverlay[];
	videoOverlays: VideoOverlay[];
	audioOverlays: AudioOverlay[];
	effects: EffectClip[];
	total: number;
	captionWords: Array<{ startSec: number; endSec: number }>;
}): PacingInsights {
	const { scenes, overlays, videoOverlays, audioOverlays, effects, total, captionWords } = args;
	const [insightsOn, setInsightsOn] = useState(false);

	const buildPacingInputs = useCallback((): PacingBuild => {
		const explicit = scenes.some((s) => s.start != null);
		let cursor = 0;
		const timedScenes = scenes.map((s) => {
			const start = explicit ? (s.start ?? cursor) : cursor;
			const dur = Math.max(1, s.dur);
			cursor = start + dur;
			return { start, dur, move: s.move, name: s.name, vo: s.vo };
		});
		const inputs: PacingInputs = {
			totalSec: total,
			scenes: timedScenes,
			captionWords,
			overlays: [...overlays, ...videoOverlays].map((o) => ({
				start: o.start,
				dur: o.dur,
			})),
			audioHits: audioOverlays
				.filter((a) => a.kind === "sfx" || a.kind === "accent_hit")
				.map((a) => ({ start: a.start, dur: a.dur })),
			effects: effects.map((e) => ({ start: e.start, dur: e.dur })),
		};
		return { inputs, timedScenes };
	}, [scenes, overlays, videoOverlays, audioOverlays, effects, total, captionWords]);

	const pacing = useMemo(() => {
		if (!insightsOn) return null;
		const { inputs } = buildPacingInputs();
		const density = densityPerSecond(inputs);
		return { density, retention: retentionCurve(density), findings: lintPacing(inputs) };
	}, [insightsOn, buildPacingInputs]);

	return { insightsOn, setInsightsOn, buildPacingInputs, pacing };
}
