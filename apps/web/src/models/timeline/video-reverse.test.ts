import { expect, test } from "vite-plus/test";
import {
	toTimelineDoc,
	fromTimelineDoc,
	readStoryboardDocument,
	reverseMediaBlockers,
	type ProjectMediaProcessingResponse,
} from "@maleo/shared";
import {
	applyReverseResult,
	canReuseReverse,
	reverseTargetSource,
	setReverseLayout,
} from "./video-reverse.ts";
import { diffScopeToCommand } from "@maleo/shared/editor";
import { createCommandLedger } from "@models/chat/command-ledger.ts";
import type { EditScope } from "@maleo/shared/editor";
import { editorExecutor } from "@maleo/shared/editor";

const url = "/api/media/11111111-1111-4111-8111-111111111111";
const asset = {
	id: "source",
	kind: "video" as const,
	source: "upload" as const,
	url,
	label: "Original",
};
const result: ProjectMediaProcessingResponse = {
	id: "22222222-2222-4222-8222-222222222222",
	status: "ready",
	sourceMediaId: url.split("/").at(-1)!,
	sourceRevision: url.split("/").at(-1)!,
	operation: {
		type: "reverse",
		startSec: 1,
		durationSec: 4,
	},
	error: null,
	url: "/api/media/33333333-3333-4333-8333-333333333333",
	metadata: { originalFilename: "Reverse.mp4", byteSize: 100, kind: "video", duration: 4 },
};

test("reverse completion commits once across overlay and scene targets, persists, and protects live edits", () => {
	const visual = {
		id: "v",
		kind: "video" as const,
		url,
		label: "Original",
		mediaAssetId: asset.id,
		startSec: 0,
		durationSec: 4,
		mediaStartSec: 1,
	};
	const doc = toTimelineDoc(
		[
			{
				id: 1,
				name: "Scene",
				shot: "Wide",
				move: "Static",
				vis: "",
				vo: "Before",
				img: true,
				dur: 4,
				src: url,
				visualClips: [visual],
			},
		],
		[
			{
				id: 2,
				kind: "video",
				url,
				mediaAssetId: asset.id,
				start: 7,
				dur: 4,
				mediaStartSec: 1,
				track: 1,
				volume: 0.5,
			},
		],
	);
	for (const target of [
		{ source: "video", id: 2 },
		{ source: "scene", id: 1, visualId: "v" },
	] as const) {
		const source = reverseTargetSource(doc, target, [asset])!;
		const edited = setReverseLayout(doc, target, { rotationDeg: 25 });
		expect(reverseTargetSource(edited, target, [asset])?.fingerprint).toBe(source.fingerprint);
		const before: EditScope = { doc: edited, slides: [], posts: [], mediaAssets: [asset] };
		const after = {
			...before,
			doc: applyReverseResult(edited, target, [asset], source.fingerprint, result),
		};
		const current = reverseTargetSource(after.doc, target, [asset])!;
		expect(current.layout).toMatchObject({
			reverse: true,
			rotationDeg: 25,
			reverseMedia: { url: result.url, sourceUrl: url },
		});
		expect(canReuseReverse(current)).toBe(true);
		expect(current.url).toBe(url);
		expect(current.start).toBe(1);
		const ledger = createCommandLedger(editorExecutor);
		ledger.record(diffScopeToCommand(before, after), before);
		expect(ledger.depths()).toEqual({ undo: 1, redo: 0 });
		expect(ledger.undo(after)).toEqual(before);
		expect(ledger.redo(before)).toEqual(after);
		const loaded = {
			...after.doc,
			clips: readStoryboardDocument(JSON.parse(JSON.stringify(after.doc))).doc.clips,
		};
		expect(reverseTargetSource(loaded, target, [asset])?.layout.reverseMedia).toEqual(
			current.layout.reverseMedia,
		);
		expect(reverseMediaBlockers(fromTimelineDoc(loaded))).toEqual([]);
		expect(() =>
			applyReverseResult(
				{ ...doc, trackFlags: { [-1]: { locked: true }, 1: { locked: true } } },
				target,
				[asset],
				source.fingerprint,
				result,
			),
		).toThrow("locked");
		expect(() => applyReverseResult(doc, target, [asset], "stale", result)).toThrow("changed");
		expect(() =>
			applyReverseResult(doc, target, [asset], source.fingerprint, {
				...result,
				operation: { ...result.operation, startSec: 2 },
			}),
		).toThrow("does not match");
		expect(() =>
			applyReverseResult(doc, target, [asset], source.fingerprint, {
				...result,
				metadata: { ...result.metadata!, duration: 3 },
			}),
		).toThrow("does not match");
	}
});
