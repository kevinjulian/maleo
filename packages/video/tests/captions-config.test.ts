import { describe, expect, it } from "vite-plus/test";
import { captionActiveColor, captionAt } from "../src/components/Captions.tsx";

describe("captionActiveColor", () => {
	it("uses configured active color instead of storyboard accent color", () => {
		expect(captionActiveColor({ activeColor: "#ffbb00" }, "#ff3e6c")).toBe("#ffbb00");
	});

	it("falls back to accent color when active color is absent or transparent", () => {
		expect(captionActiveColor({}, "#ff3e6c")).toBe("#ff3e6c");
		expect(captionActiveColor({ activeColor: "transparent" }, "#ff3e6c")).toBe("#ff3e6c");
	});
});

it("cue selection owns shared boundaries once and stays absent between cues", () => {
	const cue = {
		id: "c1",
		startSec: 0,
		durationSec: 1,
		caption: {
			text: "Hello",
			words: [],
			sources: [],
			provenance: { origin: "manual" as const, wordTimingOrigin: "estimated" as const },
			protection: { text: false, timing: false, segmentation: false, style: false },
			revision: 0,
			groupId: "g",
			status: "current" as const,
		},
	};
	const next = { ...cue, id: "c2", startSec: 1 };
	expect(captionAt([cue, next], 0.9)?.id).toBe("c1");
	expect(captionAt([cue, next], 1)?.id).toBe("c2");
	expect(captionAt([cue, next], 2)).toBeUndefined();
});
