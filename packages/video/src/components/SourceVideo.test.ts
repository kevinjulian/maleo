import { expect, test } from "vite-plus/test";
import { videoPremountFrames } from "./SourceVideo";

test("video premount window follows composition frame rate", () => {
	expect(videoPremountFrames(30)).toBe(60);
	expect(videoPremountFrames(24)).toBe(48);
});
