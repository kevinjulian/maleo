/* The document has one write path.
 *
 * It used to have two: `CreateContent` committed through `updateArrays`, the
 * timeline editor through `mutateDoc`, and each defined its own copy of the same
 * eight per-type setter shims and of `resolveNext`. Two entry points into one
 * store is two places for a write to go wrong, and neither was testable without
 * mounting a Remotion player. */
import { describe, expect, test } from "vite-plus/test";
import { toTimelineDoc, type Scene, type TextOverlay } from "@maleo/shared";
import { createTimelineDocumentStore, type EditorDoc } from "./timeline-document-store.ts";
import { createDocumentWriters } from "./document-writers.ts";
import {
	commandLabel,
	moveClip,
	resizeClip,
	applyCommand,
	replaceScope,
	type EditScope,
} from "@maleo/shared/editor";
import { createCommandLedger } from "@models/chat/command-ledger.ts";
import { resolveEdit, type CommandEdit } from "@models/timeline/command-edit.ts";
import { editorExecutor } from "@maleo/shared/editor";

const scene = (id: number, over: Partial<Scene> = {}): Scene =>
	({
		id,
		dur: 3,
		name: `S${id}`,
		shot: "Medium Shot",
		move: "Static",
		vis: "",
		vo: "",
		img: false,
		...over,
	}) as Scene;

function harness(opts: { initial?: EditorDoc; applyCommand?: (c: CommandEdit) => void } = {}) {
	const store = createTimelineDocumentStore(opts.initial);
	const commits: EditorDoc[] = [];
	const writers = createDocumentWriters({
		store,
		// Stands in for the command ledger: in the app this diffs the document into
		// a typed command and pushes it on the undo stack.
		commit: (next) => {
			commits.push(next);
			store.setDoc(next);
		},
		applyCommand: opts.applyCommand,
	});
	return { store, writers, commits };
}

describe("every per-type write goes through commit", () => {
	test("setScenes commits a document, never mutates the store directly", () => {
		const { writers, commits, store } = harness();
		writers.setScenes([scene(1)]);

		expect(commits).toHaveLength(1);
		expect(store.deriveArrays().scenes.map((s) => s.id)).toEqual([1]);
	});

	test("a setter accepts an updater function and sees the current value", () => {
		const { writers, store } = harness();
		writers.setScenes([scene(1), scene(2)]);
		writers.setScenes((prev) => prev.filter((s) => s.id !== 1));

		expect(store.deriveArrays().scenes.map((s) => s.id)).toEqual([2]);
	});

	test("text overlays round-trip through the clip projection", () => {
		const { writers, store } = harness();
		const overlay: TextOverlay = {
			id: 10,
			content: "Hi",
			start: 0,
			dur: 2,
			preset: "title",
			track: 1,
		};
		writers.setOverlays([overlay]);

		expect(store.deriveArrays().textOverlays.map((o) => o.content)).toEqual(["Hi"]);
	});

	test("editing one family leaves the others intact", () => {
		const { writers, store } = harness();
		writers.setScenes([scene(1)]);
		writers.setOverlays([{ id: 10, content: "Hi", start: 0, dur: 2, preset: "title", track: 1 }]);
		writers.setScenes((prev) => prev.map((s) => ({ ...s, name: "renamed" })));

		const views = store.deriveArrays();
		expect(views.scenes[0]!.name).toBe("renamed");
		expect(views.textOverlays).toHaveLength(1);
	});

	test("project references are document state, not a separate store", () => {
		const { writers, store } = harness();
		writers.setProjectReferences({ prompt: "", entityIds: ["anna"] });

		expect(store.getDoc().projectReferences?.entityIds).toEqual(["anna"]);
	});

	test("captions are document state too", () => {
		const { writers, store } = harness();
		writers.setCaptions({ enabled: true } as never);

		expect(store.getDoc().captions).toEqual({ enabled: true } as never);
	});

	test("a caption updater reads the captions already on the document", () => {
		const { writers, store } = harness();
		writers.setCaptions({ enabled: true } as never);
		writers.setCaptions((prev) => ({ ...prev, enabled: false }) as never);

		expect((store.getDoc().captions as { enabled: boolean }).enabled).toBe(false);
	});
});

describe("mutate is the raw seam under the setters", () => {
	test("it applies a doc -> doc edit and commits the result", () => {
		const { writers, commits, store } = harness();
		writers.mutate((doc) => ({
			...doc,
			markers: [{ id: "m1", clipId: "scene:1", title: "Intro", startSec: 0, endSec: 1 }] as never,
		}));

		expect(commits).toHaveLength(1);
		expect(store.getDoc().markers).toHaveLength(1);
	});

	test("updateArrays edits the projection and rebuilds the document", () => {
		const { writers, store } = harness();
		writers.setScenes([scene(1), scene(2)]);
		writers.updateArrays((views) => ({ ...views, scenes: views.scenes.slice(0, 1) }));

		expect(store.deriveArrays().scenes.map((s) => s.id)).toEqual([1]);
	});
});

/* The command seam.
 *
 * The other writers hand a whole document to `commit`, which compares it against
 * the previous one to work out what changed. A caller that already knows its edit
 * — a drag knows a clip moved — commits the command instead, and the comparison
 * never runs for it. */
describe("apply commits a command the caller already knows", () => {
	test("it forwards the command to the ledger rather than a document", () => {
		const applied: string[] = [];
		const { writers } = harness({
			applyCommand: (c) =>
				applied.push(
					commandLabel(
						resolveEdit(c, {
							doc: { schemaVersion: 2, clips: [], markers: [] },
							slides: [],
							posts: [],
							mediaAssets: [],
						}),
					),
				),
		});

		writers.apply(moveClip("scene:1", { startSec: 4.5 }));

		expect(applied).toEqual(["clip.move"]);
	});

	test("without a ledger it still produces the same document", () => {
		const { writers, store } = harness();
		writers.setScenes([scene(1)]);
		const before = store.getDoc().clips.find((c) => c.id === "scene:1")!.startSec;

		writers.apply(moveClip("scene:1", { startSec: before + 3 }));

		expect(store.getDoc().clips.find((c) => c.id === "scene:1")!.startSec).toBe(before + 3);
	});

	/* The property the whole change rests on: committing the command a caller knows
	 * lands the same document as letting the diff infer it from the arrays. */
	test("the command path and the array path agree", () => {
		const viaCommand = harness();
		viaCommand.writers.setScenes([scene(1), scene(2)]);
		const target = viaCommand.store.getDoc().clips.find((c) => c.id === "scene:2")!.startSec + 2;
		viaCommand.writers.apply(moveClip("scene:2", { startSec: target }));

		const viaArrays = harness();
		viaArrays.writers.setScenes([scene(1), scene(2)]);
		viaArrays.writers.updateArrays((views) => ({
			...views,
			scenes: views.scenes.map((s) => (s.id === 2 ? { ...s, start: target } : s)),
		}));

		const clipOf = (h: ReturnType<typeof harness>): number =>
			h.store.getDoc().clips.find((c) => c.id === "scene:2")!.startSec;
		expect(clipOf(viaCommand)).toBe(clipOf(viaArrays));
	});
});

/* Timing lives on the clip and is mirrored onto its payload — the invariant
 * `@maleo/shared`'s timeline document states, and the reason a command and the
 * array path can be used interchangeably. `updateClip` used to patch only the
 * top-level fields, so a moved clip kept its old `start` inside `clip.text`, and
 * the same edit persisted different bytes depending on which path it took. */
describe("a command leaves the document the array path would have left", () => {
	const overlay = {
		id: 1,
		content: "A",
		start: 0,
		dur: 4,
		preset: "title",
		track: 2,
	} as unknown as TextOverlay;

	test("moving a clip mirrors the new timing onto its payload", () => {
		const viaArrays = harness();
		viaArrays.writers.setOverlays([overlay]);
		viaArrays.writers.setOverlays((o) => o.map((x) => ({ ...x, start: 3 })));

		const viaCommand = harness();
		viaCommand.writers.setOverlays([overlay]);
		const id = viaCommand.store.getDoc().clips.find((c) => c.type === "text")!.id;
		viaCommand.writers.apply(moveClip(id, { startSec: 3 }));

		const clipOf = (h: ReturnType<typeof harness>): unknown =>
			h.store.getDoc().clips.find((c) => c.type === "text");
		expect(clipOf(viaCommand)).toEqual(clipOf(viaArrays));
	});

	test("resizing mirrors the duration too", () => {
		const viaArrays = harness();
		viaArrays.writers.setOverlays([overlay]);
		viaArrays.writers.setOverlays((o) => o.map((x) => ({ ...x, dur: 9 })));

		const viaCommand = harness();
		viaCommand.writers.setOverlays([overlay]);
		const id = viaCommand.store.getDoc().clips.find((c) => c.type === "text")!.id;
		viaCommand.writers.apply(resizeClip(id, { durationSec: 9 }));

		const clipOf = (h: ReturnType<typeof harness>): unknown =>
			h.store.getDoc().clips.find((c) => c.type === "text");
		expect(clipOf(viaCommand)).toEqual(clipOf(viaArrays));
	});
});

/* Per family, the command a positional edit commits leaves the same document the
 * array path would have. This is what lets `setFreeClipPos` commit commands for the
 * overlay families.
 *
 * Scene is deliberately absent, and its absence is the finding: moving one scene
 * re-pins explicit start/track onto EVERY scene, because the array rebuild
 * re-sequences the whole run. A single-clip command leaves the others' implicit
 * timing implicit, so the documents differ on clips nobody edited. A scene move is
 * a sequence operation and keeps the array path. */
describe("a positional command matches the array path, per family", () => {
	const seeds: Array<[string, (w: ReturnType<typeof harness>["writers"]) => void, string]> = [
		[
			"video",
			(w) =>
				w.setVideoOverlays([
					{ id: 1, kind: "video", url: "/u.mp4", start: 0, dur: 4, track: 1 } as never,
				]),
			"video:1",
		],
		[
			"text",
			(w) =>
				w.setOverlays([
					{ id: 1, content: "A", start: 0, dur: 4, preset: "title", track: 2 } as never,
				]),
			"text:1",
		],
		[
			"audio",
			(w) =>
				w.setAudioOverlays([
					{
						id: 1,
						kind: "voiceover",
						content: "a",
						url: "/a.wav",
						start: 0,
						dur: 4,
						track: 1,
					} as never,
				]),
			"audio:1",
		],
		[
			"effect",
			(w) =>
				w.setEffects([
					{ id: 1, effect: "shake", start: 0, dur: 4, track: 0, intensity: 1 } as never,
				]),
			"effect:1",
		],
	];

	for (const [name, seed, id] of seeds) {
		test(`${name}: moving by command equals moving by array`, () => {
			const viaArrays = harness();
			seed(viaArrays.writers);
			viaArrays.writers.updateArrays(
				(views) =>
					({
						...views,
						[name === "text"
							? "textOverlays"
							: `${name}Overlays`.replace("effectOverlays", "effects")]: (
							views as unknown as Record<string, Array<{ id: number }>>
						)[
							name === "text"
								? "textOverlays"
								: `${name}Overlays`.replace("effectOverlays", "effects")
						]!.map((x) => ({ ...x, start: 7 })),
					}) as never,
			);

			const viaCommand = harness();
			seed(viaCommand.writers);
			viaCommand.writers.apply(moveClip(id, { startSec: 7 }));

			expect(viaCommand.store.getDoc()).toEqual(viaArrays.store.getDoc());
		});
	}
});

test("committed broken boundary and movement undo together; projection cancellation makes no edit", () => {
	const doc = toTimelineDoc(
		[scene(1, { dur: 8 })],
		[
			{ id: 2, kind: "image", url: "a.png", start: 0, dur: 4, track: 0 },
			{ id: 3, kind: "image", url: "b.png", start: 4, dur: 4, track: 0 },
		],
	);
	const scope: EditScope = { doc, slides: [], posts: [], mediaAssets: [] };
	const paired = {
		...doc,
		clips: [
			...doc.clips,
			{
				id: "trans:9",
				type: "transition" as const,
				track: 0,
				startSec: 0,
				durationSec: 0.4,
				transition: {
					id: 9,
					fromClipId: "video:2",
					toClipId: "video:3",
					type: "fade" as const,
					dur: 0.4,
				},
			},
		],
	};
	const store = createTimelineDocumentStore(paired),
		ledger = createCommandLedger(editorExecutor);
	let gesture: string | undefined;
	const current = (): EditScope => ({ ...scope, doc: store.getDoc() });
	const run = (command: Parameters<typeof ledger.record>[0]) => {
		const before = current();
		ledger.record(command, before, gesture);
		store.setDoc(applyCommand(before, command).doc);
	};
	const writers = createDocumentWriters({
		store,
		commit: (next) => run(replaceScope({ ...current(), doc: next })),
		applyCommand: (edit) => run(resolveEdit(edit, current())),
		gesture: {
			begin: () => {
				gesture = "drag";
			},
			end: () => {
				gesture = undefined;
			},
		},
	});
	writers.beginGesture();
	writers.endGesture();
	expect(ledger.depths().undo).toBe(0);
	expect(store.getDoc()).toEqual(paired);
	writers.beginGesture();
	writers.apply(moveClip("video:3", { startSec: 5 }));
	expect(store.getDoc().clips.some((c) => c.transition)).toBe(true);
	writers.endGesture();
	const moved = current();
	expect(moved.doc.clips.some((c) => c.transition)).toBe(false);
	expect(ledger.depths().undo).toBe(1);
	const restored = ledger.undo(moved)!;
	expect(restored.doc).toEqual(paired);
	expect(ledger.redo(restored)).toEqual(moved);
});
