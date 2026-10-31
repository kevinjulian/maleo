/* Reference motion intents (motion-design-generation), one per presentation that
 * receives motion. The authoring prompt shows them as the expected shape, and the
 * compiler and lint tests use them as clean input. Each one follows every motion
 * token, so compiling it must produce no lint finding. */
import type { MotionIntent } from "./motion-intent.ts";

export interface MotionExample {
	presentation: "headline" | "explainer" | "transition";
	spanSec: number;
	sourceText: string;
	intent: MotionIntent;
}

export const MOTION_EXAMPLES: readonly MotionExample[] = [
	{
		presentation: "headline",
		spanSec: 2.4,
		sourceText: "Ship faster",
		intent: {
			layers: [
				{
					id: "bar",
					primitive: "shape-rect",
					content: "",
					role: "secondary",
					class: "container",
					box: { xPct: 18, yPct: 40, widthPct: 64, heightPct: 20 },
					opacity: 1,
					shape: { radius: 24 },
					enter: { state: "in", from: "grow-x" },
				},
				{
					id: "title",
					primitive: "plain",
					content: "Ship faster",
					role: "hero",
					class: "headline",
					box: { xPct: 18, yPct: 42, widthPct: 64, heightPct: 16 },
					opacity: 1,
					text: { fontSize: 96, weight: 800, align: "center" },
					enter: { state: "in", from: "up" },
				},
				{
					id: "spark",
					primitive: "shape-circle",
					content: "",
					role: "ambient",
					class: "accent",
					box: { xPct: 80, yPct: 34, widthPct: 4, heightPct: 4 },
					opacity: 0.8,
					enter: { state: "in", from: "fade" },
				},
			],
			states: [{ id: "in", atSec: 0, changes: [] }],
		},
	},
	{
		presentation: "explainer",
		spanSec: 3.6,
		sourceText: "Renders run on your GPU\nTen times faster than the cloud",
		intent: {
			layers: [
				{
					id: "marker",
					primitive: "shape-rect",
					content: "",
					role: "hero",
					class: "indicator",
					box: { xPct: 35, yPct: 43, widthPct: 30, heightPct: 1.2 },
					opacity: 1,
					shape: { radius: 4 },
				},
				{
					id: "claim",
					primitive: "plain",
					content: "Renders run on your GPU",
					role: "hero",
					class: "headline",
					box: { xPct: 10, yPct: 30, widthPct: 80, heightPct: 12 },
					opacity: 1,
					text: { fontSize: 72, weight: 700, align: "center" },
					enter: { state: "in", from: "up" },
				},
				{
					id: "evidence",
					primitive: "plain",
					content: "Ten times faster than the cloud",
					role: "secondary",
					class: "body",
					box: { xPct: 10, yPct: 50, widthPct: 80, heightPct: 10 },
					opacity: 1,
					text: { fontSize: 48, weight: 500, align: "center" },
					enter: { state: "in", from: "up" },
				},
			],
			states: [
				{ id: "in", atSec: 0, changes: [] },
				{
					id: "focus",
					atSec: 2.2,
					changes: [{ layer: "marker", xPct: 30, yPct: 61, widthPct: 40 }],
				},
			],
		},
	},
	{
		presentation: "transition",
		spanSec: 0.9,
		sourceText: "Next: pricing",
		intent: {
			layers: [
				{
					id: "wipe",
					primitive: "shape-rect",
					content: "",
					role: "secondary",
					class: "container",
					box: { xPct: 0, yPct: 44, widthPct: 100, heightPct: 12 },
					opacity: 1,
					enter: { state: "in", from: "grow-x" },
				},
				{
					id: "label",
					primitive: "plain",
					content: "Next: pricing",
					role: "hero",
					class: "label",
					box: { xPct: 10, yPct: 45, widthPct: 80, heightPct: 10 },
					opacity: 1,
					text: { fontSize: 56, weight: 700, align: "center", casing: "upper" },
					enter: { state: "in", from: "left" },
				},
			],
			states: [{ id: "in", atSec: 0, changes: [] }],
		},
	},
];
