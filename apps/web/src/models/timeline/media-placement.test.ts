import { expect, test } from "vite-plus/test";
import { toTimelineDoc } from "@maleo/shared";
import { CONTENT_TIMEBASE } from "./content-document-adapter.ts";
import { createCommandLedger } from "@models/chat/command-ledger.ts";
import { diffScopeToCommand } from "@maleo/shared/editor";
import { testEngine } from "@models/editor-engine/engine-fixture.ts";
import {
	mediaDropReason,
	mediaDropTime,
	mediaPlacementLane,
	placeMediaOverlay,
	sceneVisualPlacement,
} from "./media-placement.ts";
import type { EditScope } from "@maleo/shared/editor";
import { editorExecutor } from "@maleo/shared/editor";

test("drop coordinates follow scroll and zoom; Alt bypasses edge snapping", () => {
	const candidates = [
		{ ticks: 7 * 30 * CONTENT_TIMEBASE.ticksPerFrame, kind: "playhead" as const },
	];
	expect(mediaDropTime(testEngine, 183, -100, 40, candidates, false)).toBe(7);
	expect(mediaDropTime(testEngine, 466, -100, 80, candidates, false)).toBe(7);
	expect(mediaDropTime(testEngine, 183, -100, 40, candidates, true)).toBeCloseTo(7.0666667, 5);
	expect(mediaDropTime(testEngine, -120, -100, 40, candidates, false)).toBe(0);
});

test("typed placement retains duration/source/neighbor data and undoes a new lane in one step", () => {
	const doc = {
		...toTimelineDoc(
			[],
			[],
			[],
			[{ id: 1, start: 0, dur: 4, content: "Existing", kind: "music", track: 0 }],
		),
		trackFlags: { 0: { group: "audio" as const, locked: true } },
	};
	const media = {
		url: "/api/media/video",
		kind: "video" as const,
		label: "Footage",
		mediaAssetId: "ready",
		dur: 12.5,
		source: "upload" as const,
	};
	const before: EditScope = { doc, slides: [], posts: [], mediaAssets: [] };
	const after = { ...before, doc: placeMediaOverlay(doc, media, 2, 1, 9) };
	expect(after.doc.clips.find((c) => c.video)).toMatchObject({
		startSec: 2,
		durationSec: 12.5,
		track: 0,
		video: { mediaAssetId: "ready", source: "upload" },
	});
	expect(after.doc.clips.find((c) => c.audio)).toMatchObject({
		track: 1,
		audio: { track: 1, content: "Existing", start: 0, dur: 4 },
	});
	expect(after.doc.trackFlags).toEqual({
		0: { group: "visual" },
		1: { group: "audio", locked: true },
	});
	expect(doc.clips[0]?.track).toBe(0);
	const ledger = createCommandLedger(editorExecutor);
	ledger.record(diffScopeToCommand(before, after), before);
	expect(ledger.undo(after)).toEqual(before);
	expect(ledger.redo(before)).toEqual(after);
	const locked = { ...doc, trackFlags: { 1: { group: "visual" as const, locked: true } } };
	expect(placeMediaOverlay(locked, media, 2, 1, 9)).toBe(locked);
	expect(mediaPlacementLane("audio", 1, locked.trackFlags, 2).error).toBe("Track locked");
	expect(mediaDropReason({ ...media, url: "" }, [])).toBe("Media is not ready");
	expect(mediaDropReason(media, [])).toBe("Media is no longer available");
	expect(
		mediaDropReason(media, [
			{ id: "ready", url: media.url, kind: "audio", label: "Audio", source: "upload" },
		]),
	).toBe("Media type does not match source");
	expect(
		mediaDropReason(media, [
			{
				id: "ready",
				url: "/api/media/relinked",
				kind: "video",
				label: "Relinked",
				source: "upload",
			},
		]),
	).toContain("changed");
	expect(
		sceneVisualPlacement({
			id: 1,
			name: "Scene",
			dur: 3,
			src: "image",
			shot: "Wide",
			move: "Static",
			vis: "Frame",
			vo: "",
			img: true,
		}),
	).toEqual({ startSec: 2.5, durationSec: 0.5 });
});

test("known preview/render failures block placement; unknown legacy compatibility stays neutral", () => {
	const asset = {
		id: "file",
		url: "/api/media/file",
		label: "Footage",
		kind: "video" as const,
		source: "upload" as const,
	};
	const media = { ...asset, mediaAssetId: asset.id };
	expect(mediaDropReason(media, [asset])).toBeUndefined();
	expect(
		mediaDropReason(media, [
			{
				...asset,
				compatibility: {
					preview: { status: "unsupported", reason: "Codec needs conversion" },
					render: { status: "supported" },
				},
			},
		]),
	).toBe("Codec needs conversion");
	expect(
		mediaDropReason(media, [
			{
				...asset,
				compatibility: {
					preview: { status: "supported" },
					render: { status: "failed", reason: "Conversion failed" },
				},
			},
		]),
	).toBe("Conversion failed");
});
