/* Maleo's lane taxonomy, as the library's cross axis.
 *
 * Only the consumer knows what a lane means, and this is the file that knows.
 * The library resolves time; which lane a pointer is over, whether that lane
 * takes this clip, and how tall it is are all answered here.
 *
 * Two lane heights, and only two — the scene row carries the render and needs
 * its filmstrip legible; every free lane is the shorter one whatever it holds.
 * The numbers come from the same place `tracks.css` reads them, so a density
 * change moves both together rather than leaving a constant in code disagreeing
 * with one in a stylesheet.
 */
import {
	createCrossAxis,
	type CrossAxisAdapter,
	type RowMetric,
} from "@models/timeline-view/cross-axis.ts";
import { type TimelineItem } from "@models/timeline-view/types.ts";
import { laneGroupOfType, type ClipType, type LaneGroup, type TrackFlags } from "@maleo/shared";
import { laneRowId, laneTrackOf } from "./content-document-adapter.ts";
import { routeToLane } from "./lane-bookkeeping.ts";

/** Every clip type the lane vocabulary classifies, resolved once. */
const CLIP_TYPE_GROUPS = new Map<string, LaneGroup | undefined>(
	(
		[
			"image",
			"video",
			"audio",
			"text",
			"caption",
			"infographic",
			"effect",
			"transition",
		] satisfies ClipType[]
	).map((type) => [type, laneGroupOfType(type)]),
);

/** Row heights by tier, matching the base tokens in `tracks.css`
 *  (`--tl2-lane-h`, `--tl2-lane-h-visual`, `--tl2-lane-h-audio`,
 *  `--tl2-lane-h-short`). Only a fallback: the drawn heights move with density
 *  and pointer type, and the axis reads those when the consumer measures them. */
export const LANE_HEIGHT_FALLBACK_PX = { scene: 46, visual: 40, audio: 30, short: 24 } as const;

/** The fallback height of a free lane of this group. An undeclared lane may hold
 *  any free clip, so it takes the visual height. */
export function laneHeightFallbackPx(group: LaneGroup | undefined): number {
	if (group === "audio" || group === "caption") return LANE_HEIGHT_FALLBACK_PX.audio;
	if (group === "text" || group === "data" || group === "effect")
		return LANE_HEIGHT_FALLBACK_PX.short;
	return LANE_HEIGHT_FALLBACK_PX.visual;
}

/** Which clip kinds a declared lane group accepts. */
export function groupAccepts(group: LaneGroup | undefined, kind: string): boolean {
	/* An untyped lane — one migration has not reached — accepts anything that
	 * occupies a free lane at all. Refusing everything there would strand clips
	 * that are legitimately on it today.
	 *
	 * The kind arrives as a string because an item's `kind` is opaque to the
	 * library, so it is CHECKED against the vocabulary rather than asserted into
	 * it: a kind the taxonomy does not know occupies no lane, which is the same
	 * answer a transition gets. */
	const clipGroup = CLIP_TYPE_GROUPS.get(kind);
	if (clipGroup === undefined) return false;
	if (group === undefined) return true;
	return group === clipGroup;
}

export interface ContentCrossAxisOptions {
	/** The lane flags as they now stand. Called on every lookup. */
	trackFlags(): TrackFlags;
	/** How many free lanes exist. */
	laneCount(): number;
	/**
	 * Every row's height as it is actually drawn, scene row first.
	 *
	 * MEASURED rather than assumed. The tokens below are the defaults, but three
	 * density rules and a coarse-pointer rule all move them, and a constant here
	 * that disagreed with the stylesheet would resolve the pointer to the wrong
	 * lane in exactly the configurations nobody tests by hand. Supplying a
	 * measurement is what the library's "the consumer declares row height" is
	 * for.
	 */
	rowHeightsPx?(): readonly number[];
}

/** The metrics the library measures the cross axis with: each row's measured
 *  height (scene row first), or its group's fallback where a row has none yet. */
function laneMetrics(options: ContentCrossAxisOptions): RowMetric[] {
	const measured = options.rowHeightsPx?.() ?? [];
	const flags = options.trackFlags();
	const heightAt = (index: number, fallback: number): number => {
		const height = measured[index] ?? 0;
		return height > 0 ? height : fallback;
	};
	const metrics: RowMetric[] = [
		{ id: laneRowId(-1), heightPx: heightAt(0, LANE_HEIGHT_FALLBACK_PX.scene) },
	];
	for (let track = 0; track < options.laneCount(); track += 1) {
		metrics.push({
			id: laneRowId(track),
			heightPx: heightAt(track + 1, laneHeightFallbackPx(flags[track]?.group)),
		});
	}
	return metrics;
}

/**
 * Maleo's cross axis.
 *
 * The metrics are read through a function rather than captured once, so adding a
 * lane, removing one, or changing the density is followed on the next lookup
 * with nothing to invalidate.
 */
export function createContentCrossAxis(options: ContentCrossAxisOptions): CrossAxisAdapter {
	/** The declared group of every free lane, in row order. */
	const groups = (): Array<LaneGroup | undefined> => {
		const flags = options.trackFlags();
		return Array.from({ length: options.laneCount() }, (_unused, row) => flags[row]?.group);
	};

	return createCrossAxis(() => laneMetrics(options), {
		accepts(rowId, item: TimelineItem) {
			const track = laneTrackOf(rowId);
			/* The scene row takes scenes and nothing else: a text overlay dropped
			 * onto the base track would become part of the render's spine. */
			if (track < 0) return item.kind === "scene" || item.kind === "image" || item.kind === "video";
			if (item.kind === "scene") return false;
			/* A declared lane accepts its own group and nothing else. An UNDECLARED
			 * lane accepts anything that occupies a free lane — migration has not
			 * reached it, and refusing there would strand clips that legitimately sit
			 * on one today. The editor's router agrees: it relocates a clip only when
			 * the lane declares a different group. */
			return groupAccepts(options.trackFlags()[track]?.group, item.kind);
		},
		/* Rerouted rather than declined, because that is what the editor does: a
		 * clip dropped on a lane that does not take it lands on the nearest lane of
		 * its own group. The projection reports BOTH — the lane the pointer is over
		 * as refused, and the lane it will actually land on — so a person sees the
		 * reroute while they are still holding the clip rather than discovering it
		 * afterwards. */
		refusal: "reroute",
		reroute: (item, refused) => {
			const group = CLIP_TYPE_GROUPS.get(item.kind);
			if (group === undefined) return undefined;
			const routed = routeToLane(groups(), group, laneTrackOf(refused));
			return routed === null ? undefined : laneRowId(routed);
		},
	});
}

/** Every lane group, and the clip kinds it accepts. For the table-driven test. */
export const LANE_ACCEPTANCE: ReadonlyArray<{
	group: LaneGroup | undefined;
	accepts: readonly string[];
	refuses: readonly string[];
}> = [
	{
		group: "visual",
		accepts: ["image", "video"],
		refuses: ["audio", "text", "infographic", "effect", "transition"],
	},
	{
		group: "audio",
		accepts: ["audio"],
		refuses: ["image", "video", "text", "infographic", "effect", "transition"],
	},
	{
		group: "text",
		accepts: ["text"],
		refuses: ["image", "video", "audio", "infographic", "effect", "transition"],
	},
	{
		group: "caption",
		accepts: ["caption"],
		refuses: ["image", "video", "audio", "text", "infographic", "effect", "transition"],
	},
	{
		group: "data",
		accepts: ["infographic"],
		refuses: ["image", "video", "audio", "text", "effect", "transition"],
	},
	{
		group: "effect",
		accepts: ["effect"],
		refuses: ["image", "video", "audio", "text", "infographic", "transition"],
	},
	/* An untyped lane — one migration has not reached — accepts nothing on its
	 * own account. The editor's router relocates a clip dropped there to a lane
	 * of its group, so an adapter that accepted it would report a destination the
	 * drop then moved away from. `groupAccepts` still answers for the group
	 * vocabulary; the lane check adds the declaration. */
	{
		group: undefined,
		accepts: ["image", "video", "audio", "text", "infographic", "effect"],
		refuses: ["transition"],
	},
];
