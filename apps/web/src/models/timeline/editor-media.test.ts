import { describe, expect, it } from "vite-plus/test";
import { preserveAgentSceneTimeline, DATA_CALLOUT_DND_MIME } from "./editor-media.ts";
import { defaultInfographicPayload } from "@models/presets/generation-defaults.ts";
import type { InfographicPayload, Scene } from "@maleo/shared";

const scene = (over: Partial<Scene> & { id: number }): Scene => ({
	dur: 4,
	name: `Scene ${over.id}`,
	shot: "Medium",
	move: "Static",
	vis: "",
	vo: "",
	img: false,
	...over,
});

describe("preserveAgentSceneTimeline", () => {
	it("keeps absolute placement while applying a live agent scene patch", () => {
		const previous = scene({ id: 27, start: 107.753, track: 0, contentDur: 5.889 });

		expect(preserveAgentSceneTimeline(previous, 5.5)).toEqual({
			start: 107.753,
			track: 0,
			contentDur: 5.5,
		});
	});

	it("keeps the prior narrated duration when a patch omits it", () => {
		const previous = scene({ id: 28, start: 113.642, track: 0, contentDur: 1.683 });

		expect(preserveAgentSceneTimeline(previous, undefined)).toEqual({
			start: 113.642,
			track: 0,
			contentDur: 1.683,
		});
	});
});

describe("data callout defaults", () => {
	it("covers every draggable callout type with renderable payload data", () => {
		const types: InfographicPayload["type"][] = [
			"stat_reveal",
			"bar_chart",
			"line_chart",
			"area_chart",
			"pie_chart",
			"donut_chart",
			"progress_bars",
			"circular_progress",
			"table_build",
			"price_tag",
			"social_proof",
			"urgency",
		];
		expect(DATA_CALLOUT_DND_MIME).toBe("text/maleo-data-callout");
		for (const type of types) {
			const payload = defaultInfographicPayload(type);
			expect(payload.type).toBe(type);
			expect(payload.title.length).toBeGreaterThan(0);
		}
	});
});
