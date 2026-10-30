import { expect, test, vi } from "vite-plus/test";
import { borrowLocalPreviewSource, registerLocalPreviewSource } from "./local-sources.ts";

test("removal denies new borrowers and waits for existing decoders without deleting original bytes", async () => {
	const file = new File(["complete"], "video.mp4");
	const remove = registerLocalPreviewSource("blob:owned", {
		id: "id",
		revision: "r1",
		file,
		video: null,
		audio: null,
	});
	let finish!: () => void;
	const closed = new Promise<void>((resolve) => {
		finish = resolve;
	});
	const dispose = vi.fn(() => closed);
	const held = borrowLocalPreviewSource("blob:owned", dispose);
	expect(held.source.file).toBe(file);
	const removed = vi.fn();
	const pending = remove();
	void pending.then(removed);
	expect(remove()).toBe(pending);
	expect(dispose).toHaveBeenCalledOnce();
	expect(() => borrowLocalPreviewSource("blob:owned", dispose)).toThrow("unavailable");
	await Promise.resolve();
	expect(removed).not.toHaveBeenCalled();
	finish();
	await pending;
	expect(await file.text()).toBe("complete");
	held.release();
});

test("released borrowers are not disposed with their owner", async () => {
	const remove = registerLocalPreviewSource("blob:released", {
		id: "id",
		revision: "r1",
		file: new File(["x"], "x"),
		video: null,
		audio: null,
	});
	const dispose = vi.fn(async () => {});
	const held = borrowLocalPreviewSource("blob:released", dispose);
	held.release();
	await remove();
	expect(dispose).not.toHaveBeenCalled();
});
