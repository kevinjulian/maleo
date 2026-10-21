import { expect, test } from "vite-plus/test";
import {
	bookmarkSchema,
	parseBookmarks,
	toTimelineDoc,
	rebuildDocWith,
	readStoryboardDocument,
	buildRenderStoryboardFromDoc,
	fromTimelineDoc,
} from "@maleo/shared";
import {
	commandLabel,
	invertCommand,
	applyCommand,
	upsertBookmark,
	removeBookmark,
	type EditScope,
} from "@maleo/shared/editor";
import { diffScopeToCommand } from "@maleo/shared/editor";
import { createCommandLedger } from "@models/chat/command-ledger.ts";
import { applyAgentPreview } from "./agent-result-scope.ts";
import { storyboardJson } from "@models/storyboard/document-wire.ts";
import { editorExecutor } from "@maleo/shared/editor";

const scenes = [1, 2].map((id) => ({
	id,
	name: `Scene ${id}`,
	shot: "Wide",
	move: "Static",
	vis: "",
	vo: "",
	img: true,
	src: "/image.png",
	dur: 4,
}));
const bookmark = { id: "review", timeSec: 6.125, label: "Check cut" };
const refs = { images: [], speakers: [], notes: [], style: { tone: "", palette: "", music: "" } };

test("bookmarks remain independent through scene resequence, deletion, reload, and agent edits", () => {
	const before: EditScope = { doc: toTimelineDoc(scenes), slides: [], posts: [], mediaAssets: [] };
	const added = applyCommand(before, upsertBookmark(bookmark));
	const ledger = createCommandLedger(editorExecutor);
	ledger.record(upsertBookmark(bookmark), before);
	expect(ledger.depths()).toEqual({ undo: 1, redo: 0 });
	expect(ledger.undo(added)).toEqual(before);
	expect(ledger.redo(before)).toEqual(added);
	const render = (doc: EditScope["doc"]) =>
		buildRenderStoryboardFromDoc({ format: "16:9" }, refs, doc).storyboard;
	expect(render(added.doc)).toEqual(render(before.doc));
	const resequenced = rebuildDocWith(added.doc, { scenes: [...scenes].reverse() });
	expect(resequenced.bookmarks).toEqual([bookmark]);
	const shortened = rebuildDocWith(resequenced, { scenes: [scenes[0]!] });
	expect(shortened.bookmarks).toEqual([bookmark]);
	expect(render(shortened).targetDurationSec).toBe(4);
	const json = storyboardJson(
		"video",
		{ scenes: fromTimelineDoc(shortened).scenes },
		{ clips: shortened.clips, bookmarks: shortened.bookmarks },
	);
	expect(readStoryboardDocument(JSON.parse(JSON.stringify(json))).doc.bookmarks).toEqual([
		bookmark,
	]);
	const agent = applyAgentPreview(before, added, {
		...before,
		doc: {
			...before.doc,
			clips: before.doc.clips.map((c) =>
				c.scene ? { ...c, scene: { ...c.scene, vo: "Narration edited" } } : c,
			),
		},
	});
	expect(agent.status).toBe("apply");
	if (agent.status === "apply") expect(agent.current.doc.bookmarks).toEqual([bookmark]);
	const changed = applyCommand(
		added,
		upsertBookmark({ ...bookmark, label: "Renamed", timeSec: 2 }),
	);
	expect(commandLabel(diffScopeToCommand(added, changed))).toBe("bookmark.set");
	expect(applyCommand(changed, invertCommand(added, diffScopeToCommand(added, changed)))).toEqual(
		added,
	);
	expect(applyCommand(changed, removeBookmark(bookmark.id)).doc.bookmarks).toEqual([]);
	expect(
		applyCommand(
			applyCommand(changed, removeBookmark(bookmark.id)),
			invertCommand(changed, removeBookmark(bookmark.id)),
		),
	).toEqual(changed);
});

test("legacy absence stays absent, invalid bookmark input cannot change document, and a blank label is repaired", () => {
	expect(parseBookmarks(undefined)).toBeUndefined();
	expect(
		parseBookmarks([
			bookmark,
			bookmark,
			{ ...bookmark, id: "bad", timeSec: Infinity },
			{ ...bookmark, id: "empty", label: "  " },
		]),
	).toEqual([bookmark, { ...bookmark, id: "empty", label: "Bookmark" }]);
	expect(
		readStoryboardDocument({ schemaVersion: 2, clips: [], markers: [] }).doc.bookmarks,
	).toBeNull();
	expect(storyboardJson("video", { scenes })).not.toHaveProperty("bookmarks");
	const scope: EditScope = { doc: toTimelineDoc(scenes), slides: [], posts: [], mediaAssets: [] };
	for (const timeSec of [-1, NaN, Infinity])
		expect(applyCommand(scope, upsertBookmark({ ...bookmark, timeSec }))).toBe(scope);
	expect(bookmarkSchema.safeParse({ ...bookmark, label: "x".repeat(161) }).success).toBe(false);
});
