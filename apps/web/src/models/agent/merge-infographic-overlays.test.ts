import { describe, expect, it } from "vite-plus/test";
import { mergeAgentInfographicOverlays } from "./merge-infographic-overlays.ts";

describe("mergeAgentInfographicOverlays", () => {
	const manual = {
		id: 7,
		start: 0,
		dur: 2,
		track: 0,
		payload: { type: "stat_reveal" as const, title: "Manual", value: "42" },
	};
	const auto = {
		id: 10_000_001,
		start: 1,
		dur: 3,
		track: 1,
		payload: { type: "stat_reveal" as const, title: "Auto", value: "9" },
	};

	it("empty incoming clears prior auto overlays but preserves manual clips", () => {
		expect(mergeAgentInfographicOverlays([manual, auto], [])).toEqual([manual]);
	});

	it("incoming overlays replace matching manual clips and all old auto clips", () => {
		const incoming = [
			{
				id: 7,
				startSec: 4,
				durationSec: 5,
				track: 2,
				payload: { type: "stat_reveal" as const, title: "Updated", value: "11" },
			},
		];
		expect(mergeAgentInfographicOverlays([manual, auto], incoming)).toEqual([
			{
				id: 7,
				start: 4,
				dur: 5,
				track: 2,
				layout: undefined,
				animation: undefined,
				payload: { type: "stat_reveal", title: "Updated", value: "11" },
			},
		]);
	});
});
