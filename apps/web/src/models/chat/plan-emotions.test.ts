import { describe, expect, it } from "vite-plus/test";
import { planEmotions } from "./plan-emotions.ts";
import type { ChatLogMessage } from "./chat-log.ts";
import { fixtureArtifact } from "@models/agent/artifact-fixture.ts";

const section = (id: string, emotion?: string) => ({
	id,
	title: id,
	narration: "n",
	visualPrompt: "v",
	estimatedDurationSec: 30,
	...(emotion ? { emotion } : {}),
});

let nextId = 0;
const planMessage = (...emotions: Array<string | undefined>): ChatLogMessage =>
	({
		id: `msg-${++nextId}`,
		role: "assistant",
		content: "",
		artifact: fixtureArtifact("story_plan", {
			targetSec: 300,
			sections: emotions.map((emotion, i) => section(`sec-${i + 1}`, emotion)),
		}),
	}) as unknown as ChatLogMessage;

const noise = (): ChatLogMessage =>
	({ id: `msg-${++nextId}`, role: "user", content: "hello" }) as unknown as ChatLogMessage;

describe("planEmotions", () => {
	it("returns the distinct emotions of the plan in narrative order", () => {
		expect(planEmotions([noise(), planMessage("calm", "tension", "hope")])).toEqual([
			"calm",
			"tension",
			"hope",
		]);
	});

	it("collapses repeats without reordering", () => {
		// The arc reads calm → tension → calm; the palette needs each emotion once,
		// still in the order the viewer meets it.
		expect(planEmotions([planMessage("calm", "calm", "tension", "calm")])).toEqual([
			"calm",
			"tension",
		]);
	});

	it("reads the most recent plan when several exist", () => {
		expect(planEmotions([planMessage("chaos"), noise(), planMessage("hope", "victory")])).toEqual([
			"hope",
			"victory",
		]);
	});

	it("skips sections with no emotion", () => {
		expect(planEmotions([planMessage("calm", undefined, "hope")])).toEqual(["calm", "hope"]);
	});

	it("returns nothing for a plan written before emotions were recorded", () => {
		expect(planEmotions([planMessage(undefined, undefined)])).toEqual([]);
	});

	it("returns nothing when there is no plan at all", () => {
		expect(planEmotions([noise(), noise()])).toEqual([]);
	});

	it("returns nothing for an empty log", () => {
		expect(planEmotions([])).toEqual([]);
	});
});
