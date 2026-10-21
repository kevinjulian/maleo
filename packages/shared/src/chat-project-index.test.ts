import { describe, expect, test } from "vite-plus/test";
import {
	buildChatProjectIndex,
	INDEX_SUMMARY_MAX,
	type ChatIndexInput,
} from "./chat-project-index.ts";
import { EMPTY_CHAT_PROJECT_INDEX } from "./chat-context-envelope.ts";
import { EMPTY_PROJECT_MATERIALS, type ProjectMaterials } from "./project-materials.ts";
import type { TimelineDoc } from "./timeline-doc.ts";

function clip(
	id: string,
	startSec: number,
	durationSec: number,
	name?: string,
): TimelineDoc["clips"][number] {
	return {
		id,
		type: "image",
		startSec,
		durationSec,
		track: 0,
		...(name
			? { scene: { id: 1, dur: durationSec, name, shot: "", move: "", vis: "", vo: "" } }
			: {}),
	} as TimelineDoc["clips"][number];
}

const clipRich: ChatIndexInput = {
	doc: {
		schemaVersion: 2,
		clips: [
			clip("scene:1", 0, 4, "Opening"),
			clip("scene:2", 4, 3, "Middle"),
			clip("audio:1", 0, 7),
		],
		markers: [
			{
				id: 1,
				title: "Hook",
				clipIds: ["scene:1"],
				startSec: 0,
				endSec: 4,
				voiceoverText: "Why it matters",
			},
			{ id: 2, title: "Payoff", clipIds: ["scene:2"], startSec: 4, endSec: 7 },
		],
	},
};

describe("buildChatProjectIndex", () => {
	test("empty project yields the empty index", () => {
		expect(buildChatProjectIndex({})).toEqual(EMPTY_CHAT_PROJECT_INDEX);
		expect(
			buildChatProjectIndex({ doc: null, slides: [], posts: [], references: [], assets: [] }),
		).toEqual(EMPTY_CHAT_PROJECT_INDEX);
	});

	test("clip-rich project indexes every clip by stable id and every scene marker", () => {
		const index = buildChatProjectIndex(clipRich);
		expect(index.timeline.map((e) => e.id)).toEqual(["scene:1", "scene:2", "audio:1"]);
		expect(index.timeline.every((e) => e.kind === "clip")).toBe(true);
		expect(index.story.map((e) => e.label)).toEqual(["Hook", "Payoff"]);
		expect(index.story[0]?.summary).toBe("Why it matters");
		expect(index.story[1]?.summary).toBeUndefined();
	});

	test("clip entries carry timeline position so a planner can locate them", () => {
		const opening = buildChatProjectIndex(clipRich).timeline[0];
		expect(opening).toMatchObject({ startSec: 0, durationSec: 4, label: "Opening" });
	});

	test("multi-section project indexes chapters as sections spanning their scenes", () => {
		const index = buildChatProjectIndex({
			...clipRich,
			chapters: [
				{ id: "ch1", title: "Act one", startSec: 0, endSec: 4 },
				{ id: "ch2", title: "Act two", startSec: 4, endSec: 7 },
			],
		});
		const sections = index.story.filter((e) => e.kind === "section");
		expect(sections).toHaveLength(2);
		expect(sections[0]).toMatchObject({ id: "ch1", label: "Act one", startSec: 0, durationSec: 4 });
		// Sections come before scenes so the outline reads top-down.
		expect(index.story[0]?.kind).toBe("section");
		expect(index.story.at(-1)?.kind).toBe("scene");
	});

	test("mixed-reference project indexes references and assets without inventing labels", () => {
		const index = buildChatProjectIndex({
			references: [{ id: "ref_a", label: "Brand deck" }, { id: "ref_b" }],
			assets: [{ id: "as_1", label: "hero.png", kind: "image" }, { id: "as_2" }],
		});
		expect(index.references).toEqual([
			{ kind: "reference", id: "ref_a", label: "Brand deck" },
			{ kind: "reference", id: "ref_b", label: "ref_b" },
		]);
		expect(index.assets[0]).toMatchObject({ id: "as_1", label: "hero.png", summary: "image" });
		expect(index.assets[1]).toMatchObject({ id: "as_2", label: "as_2" });
	});

	test("only material groups with content are indexed", () => {
		const materials = {
			...EMPTY_PROJECT_MATERIALS,
			story: { body: "Speak plainly.", assetIds: [] },
		} as unknown as ProjectMaterials;
		const index = buildChatProjectIndex({ materials });
		expect(index.materials).toEqual([
			{ kind: "material", id: "story", label: "story", summary: "Speak plainly." },
		]);
	});

	test("slides and posts are indexed by stable key, never by position", () => {
		const index = buildChatProjectIndex({
			slides: [
				{ key: "sl_b", name: "Second", caption: "cap" },
				{ key: "sl_a", name: "First" },
			],
			posts: [{ key: "po_x", body: "hello world" }],
		});
		expect(index.story.map((e) => e.id)).toEqual(["sl_b", "sl_a", "po_x"]);
		expect(index.story.map((e) => e.id)).not.toContain("1");
	});

	test("long text is truncated so a large project stays compact", () => {
		const body = "x".repeat(INDEX_SUMMARY_MAX * 2);
		const summary =
			buildChatProjectIndex({ posts: [{ key: "po_1", body }] }).story[0]?.summary ?? "";
		expect(summary.length).toBe(INDEX_SUMMARY_MAX);
		expect(summary.endsWith("…")).toBe(true);
	});
});
