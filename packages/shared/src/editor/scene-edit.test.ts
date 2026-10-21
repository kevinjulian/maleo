import { describe, expect, test } from "vite-plus/test";
import { toTimelineDoc } from "../timeline-doc.ts";
import type { Scene } from "../timeline-model.ts";
import { applyCommand, invertCommand } from "./engine-registry.ts";
import { sceneEditCommand } from "./scene-edit.ts";
import type { EditScope } from "./scope.ts";

const scene = (id: number, dur: number): Scene =>
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
	}) as Scene;

/* Ids that are not positions, as the editor's are. */
const doc = toTimelineDoc([scene(40, 3), scene(12, 4), scene(77, 2)], [], [], [], [], []);
const scope = (d = doc): EditScope => ({ mediaAssets: [], doc: d, slides: [], posts: [] });
const startOf = (s: EditScope, id: string) => s.doc.clips.find((c) => c.id === id)?.startSec;

describe("sceneEditCommand", () => {
	/* Scenes read from a document carry their position, so — as in the editor — a
	 * scene edit changes that scene and its marker and leaves the others where they are. */
	test("a duration change updates the scene and its marker and inverts exactly", () => {
		const command = sceneEditCommand(doc, 12, { dur: 6 });
		expect(command.type).not.toBe("scope.replace");

		const after = applyCommand(scope(), command);
		expect(after.doc.clips.find((c) => c.id === "scene:12")?.durationSec).toBe(6);
		expect(after.doc.markers.find((m) => m.id === 12)?.endSec).toBe(9);
		expect(startOf(after, "scene:77")).toBe(7);
		expect(applyCommand(after, invertCommand(scope(), command)).doc).toEqual(doc);
	});

	test("a removal drops the scene and its marker and inverts exactly", () => {
		const command = sceneEditCommand(doc, 40, "remove");
		const after = applyCommand(scope(), command);

		expect(after.doc.clips.map((c) => c.id)).toEqual(["scene:12", "scene:77"]);
		expect(startOf(after, "scene:12")).toBe(3);
		expect(after.doc.markers.map((m) => m.id)).toEqual([12, 77]);
		expect(applyCommand(after, invertCommand(scope(), command)).doc).toEqual(doc);
	});

	test("applies to a document whose clips are stored in another order", () => {
		const shuffled = { ...doc, clips: [...doc.clips].reverse() };
		const after = applyCommand(scope(shuffled), sceneEditCommand(shuffled, 12, { dur: 6 }));
		expect(after.doc.clips.find((c) => c.id === "scene:12")?.durationSec).toBe(6);
		expect(after.doc.clips.map((c) => c.id)).toEqual(shuffled.clips.map((c) => c.id));
	});

	test("an unknown scene is refused", () => {
		expect(() => sceneEditCommand(doc, 5, { dur: 6 })).toThrow("No scene with id 5");
	});
});

describe("sceneEditCommand on a document the editor has not normalized", () => {
	/* Scenes written without their visual and audio clip lists, as an agent persist
	 * writes them: normalizing would change every scene's payload. */
	const raw = toTimelineDoc([scene(40, 3), scene(12, 4), scene(77, 2)], [], [], [], [], []);
	const unnormalized = {
		...raw,
		clips: raw.clips.map((c) =>
			c.scene ? { ...c, scene: { ...c.scene, audioClips: undefined, visualClips: undefined } } : c,
		),
	};

	test("edits only the scene it names", () => {
		const command = sceneEditCommand(unnormalized, 12, { name: "Renamed" });
		const flat = (c: typeof command): (typeof command)[] =>
			c.type === "batch" ? c.commands.flatMap(flat) : [c];
		const clipIds = flat(command).flatMap((c) =>
			"id" in c && typeof c.id === "string" ? [c.id] : [],
		);
		expect(clipIds).toEqual(["scene:12"]);
	});
});
