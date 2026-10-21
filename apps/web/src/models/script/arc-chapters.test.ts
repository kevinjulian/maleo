import { fixtureArtifact } from "@models/agent/artifact-fixture.ts";
import { describe, expect, it } from "vite-plus/test";
import { readableArcTerm, scriptArcRoles } from "./arc-chapters.ts";
import type { ChatLogMessage } from "@models/chat/chat-log.ts";

function planMessage(over: Record<string, unknown> = {}): ChatLogMessage {
	return {
		role: "assistant",
		text: "",
		artifact: fixtureArtifact("story_plan", {
			targetSec: 120,
			arc: "fichtean",
			sections: [
				{
					id: "sec-1",
					title: "One",
					narration: "n1",
					visualPrompt: "v1",
					estimatedDurationSec: 20,
					chapterFunction: "inciting_crisis",
					chapterObligation: "Open inside trouble.",
				},
				{
					id: "sec-2",
					title: "Two",
					narration: "n2",
					visualPrompt: "v2",
					estimatedDurationSec: 20,
					chapterFunction: "climax",
					chapterObligation: "The highest crisis.",
				},
			],
			...over,
		}),
	} as ChatLogMessage;
}

describe("scriptArcRoles", () => {
	it("keys each section's arc function by the chapter id that shares its section id", () => {
		const roles = scriptArcRoles([planMessage()]);
		expect(roles.arc).toBe("fichtean");
		expect(roles.byChapterId.get("sec-1")).toEqual({
			chapterFunction: "inciting_crisis",
			obligation: "Open inside trouble.",
		});
		expect(roles.byChapterId.get("sec-2")?.chapterFunction).toBe("climax");
	});

	it("yields nothing for a plan made before arcs existed", () => {
		const legacy = planMessage({
			arc: undefined,
			sections: [
				{
					id: "sec-1",
					title: "One",
					narration: "n1",
					visualPrompt: "v1",
					estimatedDurationSec: 20,
				},
			],
		});
		const roles = scriptArcRoles([legacy]);
		expect(roles.arc).toBeUndefined();
		expect(roles.byChapterId.size).toBe(0);
	});

	it("yields nothing when the log holds no story plan", () => {
		expect(scriptArcRoles([]).byChapterId.size).toBe(0);
		expect(scriptArcRoles([{ role: "user", text: "hi" } as ChatLogMessage]).arc).toBeUndefined();
	});

	/* A re-planned project keeps the superseded plan earlier in the log, so reading
	 * the first one would make the script disagree with the plan card. */
	it("reads the newest plan in the log, not the first", () => {
		const older = planMessage({
			arc: "three_act",
			sections: [
				{
					id: "sec-1",
					title: "Old",
					narration: "n",
					visualPrompt: "v",
					estimatedDurationSec: 20,
					chapterFunction: "setup",
				},
			],
		});
		const roles = scriptArcRoles([older, planMessage()]);
		expect(roles.arc).toBe("fichtean");
		expect(roles.byChapterId.get("sec-1")?.chapterFunction).toBe("inciting_crisis");
	});

	it("names the arc even when no section carries a function", () => {
		const roles = scriptArcRoles([
			planMessage({
				sections: [
					{
						id: "sec-1",
						title: "One",
						narration: "n",
						visualPrompt: "v",
						estimatedDurationSec: 20,
					},
				],
			}),
		]);
		expect(roles.arc).toBe("fichtean");
		expect(roles.byChapterId.size).toBe(0);
	});
});

describe("readableArcTerm", () => {
	it("reads a function key as words", () => {
		expect(readableArcTerm("inciting_crisis")).toBe("inciting crisis");
		expect(readableArcTerm("pov_lifecycle")).toBe("pov lifecycle");
		expect(readableArcTerm("climax")).toBe("climax");
	});
});
