import { expect, test } from "vite-plus/test";
import { sourceStartFrame } from "./duration.ts";

test("split in-points land on the same frame for audio and video", () => {
	// 1.1 + 3/30 is 4.1000000000000005 / 4.099999… in float; floor lost a frame where round does not.
	for (let i = 0; i < 300; i++) {
		const inPoint = 1.1 + i / 30;
		expect(sourceStartFrame(inPoint, 30)).toBe(33 + i);
	}
	expect(sourceStartFrame(undefined, 30)).toBe(0);
});
