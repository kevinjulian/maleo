/* The envelope a command is sent with.
 *
 * The property that matters most here is freshness. Both the storyboard and
 * editor state autosave on a 1200ms debounce, and the usual shape of a command
 * is "edit something, then ask about the thing you just edited". An envelope
 * built from persisted state would describe the project as it was before the
 * edit the user is asking about — the single most confusing way for this feature
 * to be wrong, because the assistant would be demonstrably looking at the wrong
 * thing while insisting it is not. */
import { describe, expect, test } from "vite-plus/test";
import { buildChatEnvelope } from "./build-chat-envelope.ts";
import { focusFromPlayhead, focusFromSelection } from "./chat-focus-descriptors.ts";
import { EMPTY_SELECTION, selectScene } from "@models/timeline/selection-model.ts";
import type { EditScope } from "@maleo/shared/editor";
import type { Slide } from "@models/content/content-types.ts";
import { EMPTY_PROJECT_MATERIALS, type Clip, type ConversationDecision } from "@maleo/shared";
import type { ChatLogMessage } from "./chat-log.ts";

function clip(id: string, startSec: number, durationSec: number, track = 0): Clip {
	return { id, type: "image", startSec, durationSec, track } as Clip;
}
function slide(key: string, cap: string, id = 1): Slide {
	return { key, id, cap, vis: "v", img: false };
}

function scope(over: Partial<EditScope> = {}): EditScope {
	return {
		doc: { schemaVersion: 2, clips: [], markers: [], ...over.doc } as EditScope["doc"],
		slides: over.slides ?? [],
		posts: over.posts ?? [],
		mediaAssets: over.mediaAssets ?? [],
	};
}

const videoScope = scope({
	doc: {
		schemaVersion: 2,
		clips: [clip("scene:1", 0, 4), clip("scene:2", 4, 4)],
		markers: [{ id: 1, title: "Hook", clipIds: ["scene:1"], startSec: 0, endSec: 4 }],
	} as EditScope["doc"],
});

function build(
	over: Parameters<typeof buildChatEnvelope>[0] extends infer T ? Partial<T> : never = {},
) {
	return buildChatEnvelope({
		projectId: "p1",
		scope: videoScope,
		now: 1_000,
		...over,
	} as Parameters<typeof buildChatEnvelope>[0]);
}

describe("freshness", () => {
	test("an unsaved edit is present in the envelope", () => {
		// The scope IS the live editor state; nothing here reads a persisted copy.
		const edited = scope({
			doc: { schemaVersion: 2, clips: [clip("scene:1", 0, 9)], markers: [] } as EditScope["doc"],
		});
		const { envelope } = build({ scope: edited });
		expect(envelope.index.timeline[0]?.durationSec).toBe(9);
	});

	test("fingerprints are captured for everything the envelope describes", () => {
		const { envelope } = build();
		expect(envelope.fingerprints.map((f) => f.id)).toEqual(["scene:1", "scene:2"]);
		expect(envelope.fingerprints.every((f) => f.hash.length > 0)).toBe(true);
	});
});

describe("focus resolution", () => {
	test("a scene selection becomes scene focus", () => {
		const { envelope } = build({ selection: selectScene(1) });
		expect(envelope.focus.source).toBe("selection");
		expect(envelope.focus.entities).toEqual([{ kind: "scene", id: "1" }]);
	});

	test("an explicit mention outranks the selection", () => {
		const { envelope } = build({
			selection: selectScene(1),
			mentions: [{ kind: "clip", id: "scene:2" }],
		});
		expect(envelope.focus.source).toBe("mention");
		expect(envelope.focus.entities).toEqual([{ kind: "clip", id: "scene:2" }]);
	});

	test("nothing selected means whole project", () => {
		expect(build().envelope.focus.source).toBe("project");
	});

	test("a stale selection does not become focus", () => {
		// A clip deleted since selection: falling through to whole-project is right,
		// silently editing a clip that no longer exists is not.
		const { envelope } = build({ mentions: [{ kind: "clip", id: "scene:99" }] });
		expect(envelope.focus.source).toBe("project");
	});

	test("an entity named in the instruction resolves after playhead and selection fall through", () => {
		const { envelope } = build({ instruction: "Tighten the Hook" });
		expect(envelope.focus).toEqual({ source: "named", entities: [{ kind: "scene", id: "1" }] });
		expect(envelope.detail.some((record) => (record as { kind?: string }).kind === "scene")).toBe(
			true,
		);
	});
});

describe("memory", () => {
	test("live messages and decisions reach the envelope", () => {
		const messages: ChatLogMessage[] = [{ id: 1, role: "user", text: "make it punchier" }];
		const decisions: ConversationDecision[] = [
			{
				kind: "approval",
				question: "Which ending?",
				answer: "quiet",
				recordedAt: 1,
				provenance: { messageId: 2 },
			},
		];
		const { envelope } = build({ messages, decisions });
		expect(envelope.memory.recentTurns).toHaveLength(1);
		expect(envelope.memory.decisions).toHaveLength(1);
	});

	test("activity is excluded", () => {
		const messages: ChatLogMessage[] = [
			{ id: 1, role: "assistant", tool: { name: "render", status: "done" } },
		];
		expect(build({ messages }).envelope.memory.recentTurns).toHaveLength(0);
	});

	test("a decision contradicted by current structured state is dropped", () => {
		const decisions: ConversationDecision[] = [
			{
				kind: "approval",
				question: "Which aspect format?",
				answer: "16:9",
				recordedAt: 1,
				provenance: { messageId: 2 },
			},
		];
		const { envelope } = build({ decisions, inputs: { referenceIds: [], aspect: "9:16" } });
		expect(envelope.memory.decisions).toEqual([]);
	});

	test("latest unanswered action is carried", () => {
		const messages: ChatLogMessage[] = [
			{
				id: 3,
				role: "assistant",
				jobId: "run-1",
				question: {
					jobId: "run-1",
					actionId: "action-1",
					question: "Approve this plan?",
					options: [{ label: "Approve", value: "approve" }],
				},
			},
		];
		expect(build({ messages }).envelope.pendingAction).toEqual({
			actionId: "action-1",
			kind: "approval",
			question: "Approve this plan?",
		});
	});
});

describe("index", () => {
	test("slides are indexed by stable key", () => {
		const { envelope } = build({
			scope: scope({ slides: [slide("sl_a", "one"), slide("sl_b", "two", 2)] }),
		});
		expect(envelope.index.story.map((e) => e.id)).toEqual(["sl_a", "sl_b"]);
	});

	test("references travel as ids, never as urls", () => {
		const { envelope } = build({ referenceIds: ["ref_1", "ref_2"] });
		expect(envelope.index.references.map((r) => r.id)).toEqual(["ref_1", "ref_2"]);
	});

	test("chapters and generated assets populate the compact index", () => {
		const sectionClip = { ...clip("scene:1", 0, 4), scene: { sectionId: "section-1" } } as Clip;
		const doc = {
			schemaVersion: 2,
			clips: [sectionClip],
			markers: [],
			chapters: [{ id: "section-1", title: "Opening" }],
		} as EditScope["doc"];
		const { envelope } = build({
			scope: scope({ doc }),
			materials: EMPTY_PROJECT_MATERIALS,
			assets: [{ id: "asset-1", label: "Generated frame", kind: "image" }],
		});
		expect(envelope.index.story).toContainEqual(
			expect.objectContaining({ kind: "section", id: "section-1", label: "Opening" }),
		);
		expect(envelope.index.assets).toEqual([
			{ kind: "asset", id: "asset-1", label: "Generated frame", summary: "image" },
		]);
	});
});

describe("focus descriptors", () => {
	test("multi-select stays multi", () => {
		const selection = { ...EMPTY_SELECTION, freeIds: new Set(["scene:1", "scene:2"]) };
		expect(focusFromSelection(selection)).toHaveLength(2);
	});

	test("the primary clip is not duplicated when it is also in the set", () => {
		const selection = { ...EMPTY_SELECTION, overlayId: 5, freeIds: new Set(["text:5"]) };
		expect(focusFromSelection(selection)).toEqual([{ kind: "clip", id: "text:5" }]);
	});

	test("the playhead resolves to the clip covering it", () => {
		expect(focusFromPlayhead(videoScope.doc, 5)).toEqual({ kind: "clip", id: "scene:2" });
	});

	test("the playhead in a gap resolves to nothing", () => {
		expect(focusFromPlayhead(videoScope.doc, 99)).toBeNull();
	});

	test("overlapping clips resolve to the topmost track, matching the stage", () => {
		const doc = {
			schemaVersion: 2,
			clips: [clip("scene:1", 0, 10, 0), clip("text:2", 0, 10, 3)],
			markers: [],
		} as EditScope["doc"];
		expect(focusFromPlayhead(doc, 5)).toEqual({ kind: "clip", id: "text:2" });
	});

	test("a clip's end is exclusive, so a boundary belongs to the next clip", () => {
		expect(focusFromPlayhead(videoScope.doc, 4)).toEqual({ kind: "clip", id: "scene:2" });
	});
});

describe("dismissed chips", () => {
	test("removing the selection chip falls through to the playhead", () => {
		const { envelope } = build({
			selection: selectScene(1),
			playheadSec: 5,
			excludedSources: ["selection"],
		});
		expect(envelope.focus).toEqual({
			source: "playhead",
			entities: [{ kind: "clip", id: "scene:2" }],
		});
	});

	test("removing the playhead chip too falls through to the whole project", () => {
		const { envelope } = build({
			selection: selectScene(1),
			playheadSec: 5,
			excludedSources: ["selection", "playhead"],
		});
		expect(envelope.focus.source).toBe("project");
	});

	test("several explicit mentions stay one multi-target focus", () => {
		const { envelope } = build({
			mentions: [
				{ kind: "clip", id: "scene:1" },
				{ kind: "clip", id: "scene:2" },
			],
			selection: selectScene(1),
		});
		expect(envelope.focus).toEqual({
			source: "mention",
			entities: [
				{ kind: "clip", id: "scene:1" },
				{ kind: "clip", id: "scene:2" },
			],
		});
	});
});
