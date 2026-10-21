import { describe, expect, test } from "bun:test";
import { infographicPayloadFromArgs, infographicPayloadFromMotionGraphic } from "./overlays.ts";

const timing = { startSec: 0, durationSec: 3 };

describe("infographic data integrity", () => {
	test("missing structured chart/table facts never become placeholders", () => {
		expect(
			infographicPayloadFromMotionGraphic(
				{ needed: true, kind: "table_build", purpose: "prove", reason: "No rows supplied" },
				{ title: "Claim", index: 0 },
			),
		).toBeNull();
		expect(() =>
			infographicPayloadFromArgs({ ...timing, type: "bar_chart", title: "Claim" }),
		).toThrow(/two finite rows/);
		expect(() =>
			infographicPayloadFromArgs({ ...timing, type: "table_build", title: "Claim" }),
		).toThrow(/explicit columns and rows/);
		expect(() =>
			infographicPayloadFromArgs({ ...timing, type: "stat_reveal", title: "Claim" }),
		).toThrow(/requires value/);
		expect(() =>
			infographicPayloadFromArgs({ ...timing, type: "price_tag", title: "Claim" }),
		).toThrow(/requires price or value/);
	});

	test("approved structured rows materialize unchanged", () => {
		expect(
			infographicPayloadFromArgs({
				...timing,
				type: "bar_chart",
				title: "Measured",
				rows: [
					{ label: "Before", value: 12 },
					{ label: "After", value: 19 },
				],
			}),
		).toEqual({
			type: "bar_chart",
			title: "Measured",
			rows: [
				{ label: "Before", value: 12, color: undefined },
				{ label: "After", value: 19, color: undefined },
			],
			unit: undefined,
		});
	});
});
