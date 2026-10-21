import { describe, expect, test } from "vite-plus/test";
import {
	bedDuckEnvelope,
	dialoguePriorityEnvelope,
	BED_VOLUME,
	BED_DUCKED_VOLUME,
	BED_SWELL_VOLUME,
} from "../src/lib/music";

const fps = 30;
const at = (sec: number, ranges: Array<{ startSec: number; endSec: number }>): number =>
	bedDuckEnvelope(Math.round(sec * fps), fps, ranges);

describe("bedDuckEnvelope — music bed ducks under VO, swells in gaps", () => {
	// Two voiceover sections with a gap between them: VO [0-3], gap [3-3.6], VO [3.6-8.6].
	const ranges = [
		{ startSec: 0, endSec: 3 },
		{ startSec: 3.6, endSec: 8.6 },
	];

	test("no voiceover → flat bed level", () => {
		expect(bedDuckEnvelope(50, fps, [])).toBe(BED_VOLUME);
	});

	test("deep inside a voiceover range → ducked", () => {
		expect(at(1.5, ranges)).toBeCloseTo(BED_DUCKED_VOLUME, 5);
		expect(at(6, ranges)).toBeCloseTo(BED_DUCKED_VOLUME, 5);
	});

	test("middle of an inter-section gap → swells above the duck", () => {
		const v = at(3.3, ranges); // center of the 0.6s gap
		expect(v).toBeGreaterThan(BED_DUCKED_VOLUME);
		expect(v).toBeLessThanOrEqual(BED_SWELL_VOLUME + 1e-9);
	});

	test("gap level is louder than the ducked narration level", () => {
		expect(at(3.3, ranges)).toBeGreaterThan(at(1.5, ranges));
	});

	test("lead-in before the first VO uses the bed (not the gap swell)", () => {
		// A range that doesn't start at 0 so there is a real lead-in.
		const r = [{ startSec: 2, endSec: 5 }];
		expect(at(0.2, r)).toBeCloseTo(BED_VOLUME, 5); // before first VO → bed
	});

	test("tail after the last VO uses the bed (not the gap swell)", () => {
		const r = [{ startSec: 2, endSec: 5 }];
		expect(at(7, r)).toBeCloseTo(BED_VOLUME, 5); // after last VO → bed
	});
});

// A story timeline may carry several sequential music beds (one per emotional
// span) rather than a single bed. The renderer gives each overlay its own Sequence
// and reads the envelope at `startFrame + clipLocalFrame`, so a bed that begins
// mid-timeline must duck against the absolute voiceover ranges under ITS span —
// not against the ranges under the first bed.
describe("music beds starting mid-timeline duck under their own narration", () => {
	// Bed A covers [0-8], bed B covers [8-16]. Voiceover runs under both.
	const ranges = [
		{ startSec: 1, endSec: 6 },
		{ startSec: 9, endSec: 14 },
	];
	const bedStartSec = 8;
	const bedLocal = (localSec: number): number =>
		dialoguePriorityEnvelope(Math.round((bedStartSec + localSec) * fps), fps, ranges, "music");

	test("ducks inside the voiceover that sits within its own span", () => {
		// 3s into bed B = 11s absolute, deep inside the second voiceover range.
		expect(bedLocal(3)).toBeCloseTo(0.35, 5);
	});

	test("stays full in the silent lead-in of its own span", () => {
		// 0.2s into bed B = 8.2s absolute, between the two voiceover ranges.
		expect(bedLocal(0.2)).toBe(1);
	});

	test("does not read the first bed's envelope for the same local frame", () => {
		// One voiceover range, sitting under bed A only. At the SAME clip-local
		// offset, bed A must duck and bed B must not. Ignoring startFrame would
		// make both report bed A's ducked level.
		const onlyUnderBedA = [{ startSec: 1, endSec: 6 }];
		const local = (startSec: number, localSec: number): number =>
			dialoguePriorityEnvelope(
				Math.round((startSec + localSec) * fps),
				fps,
				onlyUnderBedA,
				"music",
			);
		expect(local(0, 3)).toBeCloseTo(0.35, 5); // bed A, absolute 3s → inside the VO
		expect(local(bedStartSec, 3)).toBe(1); // bed B, absolute 11s → no VO at all
	});
});

describe("dialoguePriorityEnvelope", () => {
	const ranges = [{ startSec: 1, endSec: 3 }];
	test("keeps clips full outside voiceover", () => {
		expect(dialoguePriorityEnvelope(0, 30, ranges, "sfx")).toBe(1);
	});
	test("ducks beds and accents by kind during voiceover", () => {
		expect(dialoguePriorityEnvelope(60, 30, ranges, "music")).toBeCloseTo(0.35);
		expect(dialoguePriorityEnvelope(60, 30, ranges, "ambient")).toBeCloseTo(0.45);
		expect(dialoguePriorityEnvelope(60, 30, ranges, "sfx")).toBeCloseTo(0.62);
		expect(dialoguePriorityEnvelope(60, 30, ranges, "accent_hit")).toBeCloseTo(0.62);
		expect(dialoguePriorityEnvelope(60, 30, ranges, "voiceover")).toBe(1);
	});
});
