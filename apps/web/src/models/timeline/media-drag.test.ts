import { describe, expect, test } from "vite-plus/test";
import type { DragEvent } from "react";
import { writeMediaDragPayload, type MediaDragPayload } from "./media-drag.ts";
import { readMediaDrop } from "./timeline-drops.ts";
import { admitMediaAsset } from "./media-admission.ts";

/* The pair only holds if the writer and the reader agree on every key, which is
 * exactly what a hand-written payload at a third call site would break. So the
 * test drives them against each other rather than asserting on either alone. */
class FakeDataTransfer {
	private readonly data = new Map<string, string>();
	effectAllowed = "none";
	setData(type: string, value: string): void {
		this.data.set(type, value);
	}
	getData(type: string): string {
		return this.data.get(type) ?? "";
	}
	get types(): string[] {
		return [...this.data.keys()];
	}
}

function roundTrip(payload: MediaDragPayload) {
	const dt = new FakeDataTransfer();
	writeMediaDragPayload(dt as unknown as DataTransfer, payload);
	return readMediaDrop({ dataTransfer: dt } as unknown as DragEvent);
}

const stockClip: MediaDragPayload = {
	url: "https://cdn.example/clip.mp4",
	kind: "video",
	label: "City at dusk",
	source: "stock",
	thumb: "https://cdn.example/clip.jpg",
	dur: 12.5,
};

describe("a dragged asset survives the trip to the drop handler", () => {
	test("every field the drop needs comes back", () => {
		const m = roundTrip(stockClip);
		expect(m).toMatchObject({
			url: stockClip.url,
			kind: "video",
			label: "City at dusk",
			source: "stock",
			thumb: stockClip.thumb,
			dur: 12.5,
		});
	});

	test("a stock result carries no asset identity, because it has none yet", () => {
		expect(roundTrip(stockClip)!.mediaAssetId).toBeUndefined();
	});

	test("an already-admitted asset carries its identity", () => {
		expect(roundTrip({ ...stockClip, mediaAssetId: "a1" })!.mediaAssetId).toBe("a1");
	});

	test("a sound effect arrives as a sound effect, not as music", () => {
		const m = roundTrip({
			url: "https://cdn.example/whoosh.mp3",
			kind: "audio",
			label: "Whoosh",
			source: "stock",
			audioKind: "sfx",
		});
		expect(m!.audioKind).toBe("sfx");
	});

	test("a music bed arrives as music", () => {
		const m = roundTrip({
			url: "https://cdn.example/bed.mp3",
			kind: "audio",
			label: "Bed",
			source: "stock",
			audioKind: "music",
		});
		expect(m!.audioKind).toBe("music");
	});

	test("an unset audio track stays unset, so the drop applies its own default", () => {
		expect(roundTrip(stockClip)!.audioKind).toBeUndefined();
	});
});

describe("placing a stock result admits it", () => {
	const admitDrop = (assets: Parameters<typeof admitMediaAsset>[0], payload: MediaDragPayload) => {
		const m = roundTrip(payload)!;
		return admitMediaAsset(assets, {
			id: m.mediaAssetId,
			label: m.label ?? "Media",
			url: m.url,
			kind: m.kind,
			audioKind: m.audioKind,
			thumb: m.thumb,
			dur: m.dur,
			source: m.source ?? "stock",
		});
	};

	test("one gesture both admits the asset and yields the id the clip records", () => {
		const { assets, id, added } = admitDrop([], stockClip);
		expect(added).toBe(true);
		expect(assets).toHaveLength(1);
		expect(id).toBe(assets[0]!.id);
	});

	test("dragging the same result twice yields two placements against one asset", () => {
		const first = admitDrop([], stockClip);
		const second = admitDrop(first.assets, stockClip);
		expect(second.assets).toHaveLength(1);
		expect(second.id).toBe(first.id);
	});
});

describe("placing a reference", () => {
	const reference: MediaDragPayload = {
		url: "https://cdn.example/chef.png",
		kind: "image",
		label: "Chef",
		source: "reference",
		referenceEntityId: "ent-chef",
	};

	const admitReference = (assets: Parameters<typeof admitMediaAsset>[0]) => {
		const m = roundTrip(reference)!;
		return admitMediaAsset(assets, {
			id: m.mediaAssetId,
			label: m.label ?? "Media",
			url: m.url,
			kind: m.kind,
			source: m.source ?? "reference",
			...(m.referenceEntityId
				? { provenance: { copiedFromGlobalRefId: m.referenceEntityId } }
				: {}),
		});
	};

	test("the admitted asset records which workspace entity it came from", () => {
		const { assets } = admitReference([]);
		expect(assets[0]!.provenance?.copiedFromGlobalRefId).toBe("ent-chef");
		expect(assets[0]!.source).toBe("reference");
	});

	test("dragging the same reference twice does not accumulate assets", () => {
		const first = admitReference([]);
		const second = admitReference(first.assets);
		expect(second.assets).toHaveLength(1);
		expect(second.id).toBe(first.id);
	});

	test("a stock result carries no entity provenance", () => {
		expect(roundTrip(stockClip)!.referenceEntityId).toBeUndefined();
	});

	test("placing carries provenance, never a selection", () => {
		// Placing an image and choosing what a scene generates against are separate
		// decisions. Admission takes assets and nothing else, so a drag structurally
		// cannot reach the project's selection — this pins that.
		const m = roundTrip(reference)!;
		expect(m.referenceEntityId).toBe("ent-chef");
		expect(Object.keys(m)).not.toContain("projectReferences");
		expect(Object.keys(m)).not.toContain("entityIds");
	});
});
