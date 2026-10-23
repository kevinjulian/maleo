import { describe, expect, it } from "vite-plus/test";
import { preserveAgentSceneTimeline } from "./editor-media.ts";
import type { Scene } from "@maleo/shared";

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
