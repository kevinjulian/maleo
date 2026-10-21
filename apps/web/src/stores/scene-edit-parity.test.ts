/* The agent's scene edit records the command the editor records for the same edit
 * by hand (`move-agent-tools-to-editor-commands`). The hand path is the real one:
 * `useSceneOps.upd`/`rmScene` write `resequenceScenes(...)` through the document
 * writers, and `CreateContent.commitDoc` diffs the committed document. */
import { describe, expect, test } from "vite-plus/test";
import {
	fromTimelineDoc,
	rebuildDocWith,
	resequenceScenes,
	toTimelineDoc,
	type Scene,
} from "@maleo/shared";
import { diffScopeToCommand, sceneEditCommand, type EditScope } from "@maleo/shared/editor";
import { createTimelineDocumentStore, type EditorDoc } from "@stores/timeline-document-store.ts";
import { createDocumentWriters } from "@stores/document-writers.ts";

const scene = (id: number, dur: number, over: Partial<Scene> = {}): Scene =>
	({
		id,
		dur,
		name: `S${id}`,
		shot: "Medium Shot",
		move: "Static",
		transition: "fade",
		vis: "",
		vo: `vo ${id}`,
		img: false,
		...over,
	}) as Scene;

function handCommand(initial: EditorDoc, edit: (scenes: Scene[]) => Scene[]) {
	const store = createTimelineDocumentStore(initial);
	let recorded: ReturnType<typeof diffScopeToCommand> | undefined;
	const writers = createDocumentWriters({
		store,
		commit: (next) => {
			const before: EditScope = { doc: store.getDoc(), slides: [], posts: [], mediaAssets: [] };
			recorded = diffScopeToCommand(before, { ...before, doc: next });
			store.setDoc(next);
		},
	});
	writers.setScenes((ss) => resequenceScenes(edit(ss)));
	return recorded!;
}

/* Normalized first, as any editor write leaves it. On a document that is not, the
 * hand path's re-sequencing rewrites every scene's payload once; the agent's
 * command touches only the scene it names (`sceneEditCommand`). */
const raw = toTimelineDoc(
	[
		scene(40, 3, { storyBeatId: "b1" }),
		scene(12, 4, {
			storyBeatId: "b1",
			visualClips: [
				{
					id: "a",
					kind: "image",
					label: "A",
					url: "a.png",
					startSec: 0,
					durationSec: 2,
					primary: true,
				},
				{ id: "b", kind: "image", label: "B", url: "b.png", startSec: 2, durationSec: 2 },
			],
		}),
		scene(77, 2),
	],
	[],
	[],
	[],
	[],
	[],
) as EditorDoc;
const doc = rebuildDocWith(raw, { scenes: resequenceScenes(fromTimelineDoc(raw).scenes) });

describe("agent scene edits match hand edits", () => {
	test("a duration change", () => {
		const hand = handCommand(doc, (ss) => ss.map((s) => (s.id === 12 ? { ...s, dur: 6 } : s)));
		expect(sceneEditCommand(doc, 12, { dur: 6 })).toEqual(hand);
	});

	test("a field edit", () => {
		const hand = handCommand(doc, (ss) =>
			ss.map((s) => (s.id === 77 ? { ...s, name: "Close" } : s)),
		);
		expect(sceneEditCommand(doc, 77, { name: "Close" })).toEqual(hand);
	});

	test("a removal", () => {
		const hand = handCommand(doc, (ss) => ss.filter((s) => s.id !== 40));
		expect(sceneEditCommand(doc, 40, "remove")).toEqual(hand);
	});
});
