import { commandLabel } from "./commands.ts";
import { applyCommand, invertCommand } from "./engine-registry.ts";
import { describe, expect, test } from "vite-plus/test";
import { EMPTY_PROJECT_MATERIALS, type ProjectMaterials } from "../project-materials.ts";
import type { Clip, SceneMarker } from "../timeline-doc.ts";
import type { EditorDoc, EditScope } from "./scope.ts";
import { deepEqual, diffScopeToCommand } from "./scope-diff.ts";

const clip = (id: string, over: Partial<Clip> = {}): Clip => ({
	id,
	type: "text",
	startSec: 0,
	durationSec: 2,
	track: 0,
	...over,
});
const marker = (id: number, over: Partial<SceneMarker> = {}): SceneMarker => ({
	id,
	title: `M${id}`,
	clipIds: [],
	startSec: 0,
	endSec: 1,
	...over,
});
const doc = (clips: Clip[] = [], markers: SceneMarker[] = []): EditorDoc => ({
	schemaVersion: 2,
	clips,
	markers,
});
const scope = (over: Partial<EditScope> = {}): EditScope => ({
	doc: doc(),
	slides: [],
	posts: [],
	mediaAssets: [],
	...over,
});
const materials = (story: string): ProjectMaterials => ({
	...EMPTY_PROJECT_MATERIALS,
	story: { body: story, assetIds: [], materialId: null },
});
// Deep-clone so `after` carries fresh object refs (mirrors the toTimelineDoc rebuild).
const clone = <T>(v: T): T => structuredClone(v);

/** Every diff must reproduce `after` exactly and invert back to `before`. */
function assertCorrect(before: EditScope, after: EditScope): ReturnType<typeof diffScopeToCommand> {
	const cmd = diffScopeToCommand(before, after);
	expect(applyCommand(before, cmd)).toEqual(after);
	expect(applyCommand(applyCommand(before, cmd), invertCommand(before, cmd))).toEqual(before);
	return cmd;
}

describe("deepEqual", () => {
	test("treats undefined keys as absent", () => {
		expect(deepEqual({ a: 1, b: undefined }, { a: 1 })).toBe(true);
		expect(deepEqual({ a: 1 }, { a: 2 })).toBe(false);
		expect(deepEqual([1, 2], [1, 2])).toBe(true);
		expect(deepEqual([1, 2], [2, 1])).toBe(false);
	});
});

describe("diffScopeToCommand — single-entity edits graduate to typed commands", () => {
	test("no structural change (fresh refs) → noop", () => {
		const before = scope({
			doc: doc([clip("scene:1", { scene: { id: 1, name: "A", dur: 2 } as never })]),
		});
		const after = scope({ doc: clone(before.doc) }); // identical data, new refs
		const cmd = diffScopeToCommand(before, after);
		expect(commandLabel(cmd)).toBe("noop");
	});

	test("one free clip moved → clip.move", () => {
		const before = scope({ doc: doc([clip("video:1"), clip("audio:1")]) });
		const after = scope({
			doc: doc([clip("video:1", { startSec: 9, track: 1 }), clip("audio:1")]),
		});
		expect(commandLabel(assertCorrect(before, after))).toBe("clip.move");
	});

	test("one clip resized → clip.resize", () => {
		const before = scope({ doc: doc([clip("video:1")]) });
		const after = scope({ doc: doc([clip("video:1", { durationSec: 7, startSec: 1 })]) });
		expect(commandLabel(assertCorrect(before, after))).toBe("clip.resize");
	});

	test("one clip content changed → clip.update", () => {
		const before = scope({
			doc: doc([clip("text:1", { text: { id: 1, content: "a" } as never })]),
		});
		const after = scope({ doc: doc([clip("text:1", { text: { id: 1, content: "b" } as never })]) });
		expect(commandLabel(assertCorrect(before, after))).toBe("clip.update");
	});

	test("one reveal edit → clip.update and undoable", () => {
		const before = scope({
			doc: doc([
				clip("video:1", { type: "video", video: { id: 1, url: "/b.png", kind: "image" } as never }),
			]),
		});
		const after = scope({
			doc: doc([
				clip("video:1", {
					type: "video",
					video: {
						id: 1,
						url: "/b.png",
						kind: "image",
						reveal: {
							type: "wipe",
							direction: "left",
							phase: "dark_pixels_first",
							texture: "paper",
							colorBuild: "muted_to_full",
						},
					} as never,
				}),
			]),
		});
		const cmd = assertCorrect(before, after);
		expect(commandLabel(cmd)).toBe("clip.update");
	});

	test("one clip added → clip.insert (at position)", () => {
		const before = scope({ doc: doc([clip("video:1"), clip("audio:1")]) });
		const after = scope({ doc: doc([clip("video:1"), clip("text:5"), clip("audio:1")]) });
		expect(commandLabel(assertCorrect(before, after))).toBe("clip.insert");
	});

	test("one clip removed → clip.remove", () => {
		const before = scope({ doc: doc([clip("video:1"), clip("audio:1")]) });
		const after = scope({ doc: doc([clip("video:1")]) });
		expect(commandLabel(assertCorrect(before, after))).toBe("clip.remove");
	});

	test("one marker changed → marker.upsert", () => {
		const before = scope({ doc: doc([], [marker(1, { title: "old" })]) });
		const after = scope({ doc: doc([], [marker(1, { title: "new" })]) });
		expect(commandLabel(assertCorrect(before, after))).toBe("marker.upsert");
	});

	test("captions changed → doc.setCaptions", () => {
		const before = scope();
		const after = scope({ doc: { ...doc(), captions: { enabled: true } as never } });
		expect(commandLabel(assertCorrect(before, after))).toBe("doc.setCaptions");
	});

	/* Track flags moved onto the document when they stopped being component state.
	 * A doc field the scope comparison does not list compares equal, which makes the
	 * diff return `noop` — and the commit is dropped, not merely coarsened. Hiding a
	 * track would silently do nothing. */
	test("track flags changed → doc.setTrackFlags, not a dropped noop", () => {
		const before = scope();
		const after = scope({ doc: { ...doc(), trackFlags: { 2: { hidden: true } } as never } });
		const cmd = assertCorrect(before, after);
		expect(commandLabel(cmd)).toBe("doc.setTrackFlags");
		expect(commandLabel(cmd)).not.toBe("noop");
	});

	test("a track unhidden diffs back the same way", () => {
		const before = scope({ doc: { ...doc(), trackFlags: { 2: { hidden: true } } as never } });
		const after = scope({ doc: { ...doc(), trackFlags: { 2: { hidden: false } } as never } });
		expect(commandLabel(assertCorrect(before, after))).toBe("doc.setTrackFlags");
	});

	/* Materials landed on the document for the same reason track flags did, and the
	 * same trap applies: a doc field `scopeEqual` does not list compares equal, the
	 * diff returns `noop`, and the commit is DROPPED. Editing the brief a video
	 * generates from would silently do nothing. */
	test("materials changed → doc.setMaterials, not a dropped noop", () => {
		const before = scope();
		const after = scope({ doc: { ...doc(), materials: materials("finance drama") } });
		const cmd = assertCorrect(before, after);
		expect(commandLabel(cmd)).toBe("doc.setMaterials");
		expect(commandLabel(cmd)).not.toBe("noop");
	});

	test("a materials-only edit replays to the after-state", () => {
		const before = scope({ doc: { ...doc(), materials: materials("old brief") } });
		const after = scope({ doc: { ...doc(), materials: materials("new brief") } });
		const cmd = assertCorrect(before, after);
		expect(applyCommand(before, cmd).doc.materials?.story.body).toBe("new brief");
	});

	test("editing one group leaves the others alone through the round trip", () => {
		const base = materials("brief");
		const before = scope({ doc: { ...doc(), materials: base } });
		const edited = { ...base, rules: { body: "no captions", assetIds: [], materialId: null } };
		const after = scope({ doc: { ...doc(), materials: edited } });
		const cmd = assertCorrect(before, after);
		expect(applyCommand(before, cmd).doc.materials?.story.body).toBe("brief");
	});

	/* A project that never carried materials must invert back to ABSENT. Inverting
	 * to an empty object would leave a field the document never had, and the next
	 * diff would then see a change that the operator did not make. */
	test("undo restores materials to absent when the document had none", () => {
		const before = scope();
		const after = scope({ doc: { ...doc(), materials: materials("brief") } });
		const cmd = diffScopeToCommand(before, after);
		expect(
			applyCommand(applyCommand(before, cmd), invertCommand(before, cmd)).doc.materials,
		).toBeUndefined();
	});

	test("the style bible lock survives the round trip", () => {
		const before = scope({ doc: { ...doc(), materials: materials("brief") } });
		const locked = { ...materials("brief"), styleBible: { body: "flat vector", locked: true } };
		const after = scope({ doc: { ...doc(), materials: locked } });
		const cmd = assertCorrect(before, after);
		expect(applyCommand(before, cmd).doc.materials?.styleBible).toEqual({
			body: "flat vector",
			locked: true,
		});
	});

	test("one slide edited → correct + undoable", () => {
		const s = (id: number, cap: string) => ({ key: `slide_${id}`, id, cap, vis: "v", img: false });
		const before = scope({ slides: [s(1, "a"), s(2, "b")] });
		const after = scope({ slides: [s(1, "a"), s(2, "x")] });
		assertCorrect(before, after);
	});

	test("one post added → correct + undoable", () => {
		const p = (id: number) => ({ key: `post_${id}`, id, body: "b", img: false });
		const before = scope({ posts: [p(1)] });
		const after = scope({ posts: [p(1), p(2)] });
		assertCorrect(before, after);
	});
});

describe("diffScopeToCommand — multi-entity edits", () => {
	test("two clips moved → batched but still exact + reversible", () => {
		const before = scope({ doc: doc([clip("video:1"), clip("audio:1")]) });
		const after = scope({
			doc: doc([clip("video:1", { startSec: 4 }), clip("audio:1", { startSec: 8 })]),
		});
		const cmd = assertCorrect(before, after);
		expect(["batch", "edit"]).toContain(commandLabel(cmd));
	});

	test("clip move + its marker range shift → exact + reversible (scene drag shape)", () => {
		const before = scope({ doc: doc([clip("scene:1")], [marker(1, { startSec: 0, endSec: 2 })]) });
		const after = scope({
			doc: doc([clip("scene:1", { startSec: 10 })], [marker(1, { startSec: 10, endSec: 12 })]),
		});
		assertCorrect(before, after);
	});

	test("wholesale replacement (nothing in common) → still exact + reversible", () => {
		const before = scope({ doc: doc([clip("video:1")]) });
		const after = scope({ doc: doc([clip("audio:9", { type: "audio" })]) });
		assertCorrect(before, after);
	});
});
