import { describe, expect, test } from "vite-plus/test";
import { createTimelineDocumentStore, type EditorDoc } from "./timeline-document-store.ts";
import { fromTimelineDoc, toTimelineDoc } from "@maleo/shared";
import type { Scene } from "@maleo/shared";

const scene = (over: Partial<Scene> & { id: number }): Scene => ({
	dur: 4,
	name: `Scene ${over.id}`,
	shot: "Medium",
	move: "Static",
	vis: "",
	vo: "",
	img: false,
	...over,
});

const docWith = (scenes: Scene[]): EditorDoc => ({ ...toTimelineDoc(scenes), captions: undefined });

describe("timeline-document-store", () => {
	test("seeds empty and exposes the document", () => {
		const store = createTimelineDocumentStore();
		expect(store.getDoc()).toEqual({ schemaVersion: 2, clips: [], markers: [] });
		expect(store.getMarkers()).toEqual([]);
	});

	test("setDoc replaces the document and notifies subscribers", () => {
		const store = createTimelineDocumentStore();
		let hits = 0;
		store.subscribe(() => {
			hits += 1;
		});
		store.setDoc(docWith([scene({ id: 1 })]));
		expect(hits).toBe(1);
		expect(store.getDoc().clips.map((c) => c.id)).toEqual(["scene:1"]);
	});

	test("setDoc with an updater function derives the next document from the current one", () => {
		const store = createTimelineDocumentStore(docWith([scene({ id: 1 })]));
		store.setDoc((d) => ({
			...d,
			markers: [...d.markers, { id: 99, title: "M", clipIds: [], startSec: 0, endSec: 1 }],
		}));
		expect(store.getMarkers().map((m) => m.id)).toEqual([1, 99]);
	});

	test("setDoc with an identical reference does not notify", () => {
		const store = createTimelineDocumentStore();
		let hits = 0;
		store.subscribe(() => {
			hits += 1;
		});
		store.setDoc((d) => d); // returns the same reference
		expect(hits).toBe(0);
	});

	test("deriveArrays is memoized on document identity (stable refs until change)", () => {
		const store = createTimelineDocumentStore(docWith([scene({ id: 1 })]));
		const a = store.deriveArrays();
		const b = store.deriveArrays();
		expect(b).toBe(a); // same reference while the document is unchanged
		store.setDoc(docWith([scene({ id: 1 }), scene({ id: 2 })]));
		const c = store.deriveArrays();
		expect(c).not.toBe(a); // fresh projection after a change
		expect(c.scenes).toHaveLength(2);
	});

	test("deriveArrays equals a direct fromTimelineDoc projection", () => {
		const doc = docWith([scene({ id: 1, dur: 3 }), scene({ id: 2, dur: 2, start: 8, track: 1 })]);
		const store = createTimelineDocumentStore(doc);
		expect(store.deriveArrays()).toEqual(fromTimelineDoc(doc));
	});

	test("unsubscribe stops delivery", () => {
		const store = createTimelineDocumentStore();
		let hits = 0;
		const off = store.subscribe(() => {
			hits += 1;
		});
		off();
		store.setDoc(docWith([scene({ id: 1 })]));
		expect(hits).toBe(0);
	});
});
