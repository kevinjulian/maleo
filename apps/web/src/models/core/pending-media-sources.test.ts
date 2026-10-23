import { afterEach, expect, test } from "vite-plus/test";
import { mediaUrl, mintMediaId, type ReadyImportedMedia } from "@maleo/shared";
import { assetUrl } from "./asset-url.ts";
import {
	awaitsImport,
	clearPendingSources,
	isPendingMedia,
	trackPendingSource,
	pendingSourcesVersion,
	removePendingSource,
	resolveMediaUrl,
	resolvePendingAsset,
	setPendingLocalUrl,
	setPendingReady,
	subscribePendingSources,
	withReadyPending,
	withResolvedPending,
} from "./pending-media-sources.ts";

const ready: ReadyImportedMedia = {
	id: "import-row-id",
	label: "beach.mov",
	url: "/api/media/11111111-1111-4111-8111-111111111111",
	kind: "video",
	source: "upload",
	dur: 4.2,
	thumb: "/api/media/22222222-2222-4222-8222-222222222222",
	metadata: {
		originalFilename: "beach.mov",
		byteSize: 10,
		kind: "video",
		width: 1920,
		height: 1080,
		duration: 4.2,
		hasAudio: true,
	},
	compatibility: { preview: { status: "supported" }, render: { status: "supported" } },
	importedSource: {
		revision: "r1",
		fingerprint: "a".repeat(64),
		originalMediaId: "33333333-3333-4333-8333-333333333333",
	},
};
const k1 = mintMediaId(),
	k2 = mintMediaId();
const pendingAsset = {
	id: k1,
	label: "My beach",
	url: mediaUrl(k1),
	kind: "video" as const,
	source: "upload" as const,
	dur: 4,
	metadata: { originalFilename: "beach.mov", byteSize: 10, kind: "video" as const, duration: 4 },
};

afterEach(() => {
	clearPendingSources();
});

test("readiness returns the local URL to revoke and notifies subscribers", () => {
	let calls = 0;
	const stop = subscribePendingSources(() => {
		calls++;
	});
	const before = pendingSourcesVersion();
	setPendingLocalUrl(k1, "blob:http://x/1");
	expect(setPendingReady(k1, ready)).toBe("blob:http://x/1");
	expect(removePendingSource(k1)).toBeUndefined();
	expect(calls).toBe(3);
	expect(pendingSourcesVersion()).toBeGreaterThan(before);
	stop();
	setPendingLocalUrl(k2, "blob:http://x/2");
	expect(calls).toBe(3);
	expect(clearPendingSources()).toEqual(["blob:http://x/2"]);
});

test("a ready asset keeps its identity, label and URL and takes server metadata", () => {
	expect(resolvePendingAsset(pendingAsset)).toBe(pendingAsset);
	setPendingReady(k1, { ...ready, url: mediaUrl(k1) });
	expect<unknown>(resolvePendingAsset(pendingAsset)).toEqual({
		...pendingAsset,
		thumb: ready.thumb,
		dur: 4.2,
		metadata: ready.metadata,
		compatibility: ready.compatibility,
		importedSource: ready.importedSource,
	});
});

test("save keeps every reference and takes ready metadata; preview plays local copies", () => {
	setPendingReady(k1, { ...ready, url: mediaUrl(k1) });
	setPendingLocalUrl(k2, "blob:http://x/2");
	const doc = {
		clips: [
			{ id: "video:1", url: mediaUrl(k1), mediaAssetId: k1 },
			{ id: "video:2", url: mediaUrl(k2) },
		],
		media_assets: [pendingAsset],
	};
	const saved = withReadyPending(doc);
	expect(saved.clips).toEqual(doc.clips);
	expect(saved.media_assets[0]).toMatchObject({
		id: k1,
		label: "My beach",
		url: mediaUrl(k1),
		dur: 4.2,
	});
	expect(JSON.stringify(saved)).not.toContain("blob:");
	expect(withResolvedPending(doc).clips.map((c) => c.url)).toEqual([
		mediaUrl(k1),
		"blob:http://x/2",
	]);
	expect(assetUrl(mediaUrl(k2))).toBe("blob:http://x/2");
	expect(withReadyPending({ a: 1 })).toEqual({ a: 1 });
});

test("a minted media URL plays the local copy until its import is ready, and never changes", () => {
	const id = mintMediaId();
	const url = mediaUrl(id);
	// Not tracked by this session: an ordinary stored media URL.
	expect(resolveMediaUrl(url)).toBe(url);
	expect(isPendingMedia(url)).toBe(false);
	// Tracked but no local copy (reload while processing): nothing to load, never the server's 409.
	trackPendingSource(id);
	expect(isPendingMedia(url)).toBe(true);
	expect(resolveMediaUrl(url)).toBe("");
	setPendingLocalUrl(id, "blob:http://x/m");
	expect(resolveMediaUrl(url)).toBe("blob:http://x/m");
	const doc = { clips: [{ id: "video:1", url }] };
	expect(withReadyPending(doc)).toEqual(doc);
	expect(withResolvedPending(doc).clips[0]!.url).toBe("blob:http://x/m");
	expect(setPendingReady(id, { ...ready, url })).toBe("blob:http://x/m");
	expect(isPendingMedia(url)).toBe(false);
	expect(resolveMediaUrl(url)).toBe(url);
	// The import finishing changes no reference; the library asset takes the server metadata.
	expect(withReadyPending(doc)).toEqual(doc);
	const asset = { ...pendingAsset, id, url };
	expect(resolvePendingAsset(asset)).toMatchObject({
		id,
		url,
		importedSource: ready.importedSource,
	});
});

test("an upload asset without imported provenance is an unsettled import", () => {
	const id = mintMediaId();
	expect(awaitsImport({ url: mediaUrl(id), source: "upload" })).toBe(true);
	expect(
		awaitsImport({ url: mediaUrl(id), source: "upload", importedSource: ready.importedSource }),
	).toBe(false);
	// Server-minted identities are v4; they never await a client import.
	expect(awaitsImport({ url: ready.url, source: "upload" })).toBe(false);
});
