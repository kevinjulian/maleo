import { expect, test, vi } from "vite-plus/test";
import { createWorkerDecoderRouter } from "./decoder-router.ts";
import type { PreviewMediaEvent } from "@models/timeline/preview-protocol.ts";

test("worker routes grants and fair-yield notices without deciding codec limits", async () => {
	const events: PreviewMediaEvent[] = [];
	const router = createWorkerDecoderRouter((event) => events.push(event));
	const yielded = vi.fn(),
		owner = router.open(yielded);
	const grant = owner.request("video", 2);
	expect(events).toEqual([
		{ type: "decoder-request", owner: 1, request: 1, kind: "video", slots: 2 },
	]);
	expect(router.handle({ type: "decoder-grant", owner: 1, request: 1, lease: 7 })).toBe(true);
	await expect(grant).resolves.toBe(7);
	router.handle({ type: "decoder-yield", owner: 1, lease: 7 });
	expect(yielded).toHaveBeenCalledExactlyOnceWith(7);
	owner.release(7);
	owner.close();
	expect(events.slice(1)).toEqual([
		{ type: "decoder-return", owner: 1, lease: 7 },
		{ type: "decoder-close", owner: 1 },
	]);
	expect(router.handle({ type: "seek", generation: 0, frame: 0 })).toBe(false);
});

test("closed owners reject pending work and return late grants", async () => {
	const events: PreviewMediaEvent[] = [];
	const router = createWorkerDecoderRouter((event) => events.push(event));
	const owner = router.open();
	const waiting = owner.request("audio");
	const rejected = expect(waiting).rejects.toThrow("closed");
	owner.close();
	owner.close();
	await rejected;
	router.handle({ type: "decoder-grant", owner: 1, request: 1, lease: 9 });
	expect(events.at(-1)).toEqual({ type: "decoder-return", owner: 1, lease: 9 });
	await expect(owner.request("video")).rejects.toThrow("closed");
	expect(events.filter((event) => event.type === "decoder-close")).toHaveLength(1);
});
