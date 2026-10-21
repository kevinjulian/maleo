import { describe, expect, test } from "vite-plus/test";
import { timelineJumpFor } from "./chat-focus-descriptors.ts";

describe("timelineJumpFor", () => {
	test("maps scenes and jumpable clips onto the timeline's jump", () => {
		expect(timelineJumpFor({ kind: "scene", id: "3" })).toEqual({ type: "scene", id: 3 });
		expect(timelineJumpFor({ kind: "clip", id: "scene:4" })).toEqual({ type: "scene", id: 4 });
		expect(timelineJumpFor({ kind: "clip", id: "video:7" })).toEqual({ type: "broll", id: 7 });
		expect(timelineJumpFor({ kind: "clip", id: "audio:2" })).toEqual({ type: "audio", id: 2 });
		expect(timelineJumpFor({ kind: "clip", id: "text:9" })).toEqual({ type: "text", id: 9 });
	});

	test("has no jump for off-timeline entities or clip kinds it cannot select", () => {
		expect(timelineJumpFor({ kind: "clip", id: "effect:1" })).toBeNull();
		expect(timelineJumpFor({ kind: "slide", id: "slide_a" })).toBeNull();
		expect(timelineJumpFor({ kind: "scene", id: "abc" })).toBeNull();
	});
});
