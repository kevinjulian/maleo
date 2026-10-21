import { expect, test } from "vite-plus/test";
import { sortProjectMedia, pruneMediaSelection } from "./media-library.ts";

test("media sort is stable, puts unknown measurements last and does not mutate admission order", () => {
	const items = [
		{ id: "b", label: "Take 2", kind: "video", dur: 4 },
		{ id: "a", label: "Take 2", kind: "video", dur: 4 },
		{ id: "z", label: "Take 1", kind: "image" },
	];
	expect(sortProjectMedia(items, "name").map((item) => item.id)).toEqual(["z", "a", "b"]);
	expect(sortProjectMedia(items, "duration").map((item) => item.id)).toEqual(["a", "b", "z"]);
	expect(sortProjectMedia(items, "type").map((item) => item.id)).toEqual(["z", "a", "b"]);
	const measured = [
		{
			...items[0]!,
			metadata: { originalFilename: "source.mp4", byteSize: 42, kind: "video" as const },
		},
		items[2]!,
	];
	expect(sortProjectMedia(measured, "size").map((item) => item.id)).toEqual(["b", "z"]);
	expect(items.map((item) => item.id)).toEqual(["b", "a", "z"]);
});

test("filtering prunes hidden selection while view switches retain visible identity", () => {
	const selected = new Set(["a", "b"]);
	expect(pruneMediaSelection(selected, ["b", "a"])).toEqual(selected);
	expect(pruneMediaSelection(selected, ["b"])).toEqual(new Set(["b"]));
	expect(selected).toEqual(new Set(["a", "b"]));
});
