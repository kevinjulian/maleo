import { afterEach, expect, test } from "vite-plus/test";
import type { ReadyImportedMedia } from "@maleo/shared";
import { assetUrl } from "./asset-url.ts";
import {
	clearPendingSources,
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
const pendingAsset = {
	id: "k1",
	label: "My beach",
	url: "pending:k1",
	kind: "video" as const,
	source: "upload" as const,
	dur: 4,
	metadata: { originalFilename: "beach.mov", byteSize: 10, kind: "video" as const, duration: 4 },
};

afterEach(() => {
	clearPendingSources();
});

test("a pending reference resolves to the ready URL, else the local copy, else nothing", () => {
	expect(resolveMediaUrl("pending:k1")).toBe("");
	setPendingLocalUrl("k1", "blob:http://x/1");
	expect(resolveMediaUrl("pending:k1")).toBe("blob:http://x/1");
	expect(assetUrl("pending:k1")).toBe("blob:http://x/1");
	setPendingReady("k1", ready);
	expect(resolveMediaUrl("pending:k1")).toBe(ready.url);
	expect(assetUrl("pending:k1")).toBe(ready.url);
	expect(resolveMediaUrl("/api/media/x")).toBe("/api/media/x");
});

test("readiness returns the local URL to revoke and notifies subscribers", () => {
	let calls = 0;
	const stop = subscribePendingSources(() => {
		calls++;
	});
	const before = pendingSourcesVersion();
	setPendingLocalUrl("k1", "blob:http://x/1");
	expect(setPendingReady("k1", ready)).toBe("blob:http://x/1");
	expect(removePendingSource("k1")).toBeUndefined();
	expect(calls).toBe(3);
	expect(pendingSourcesVersion()).toBeGreaterThan(before);
	stop();
	setPendingLocalUrl("k2", "blob:http://x/2");
	expect(calls).toBe(3);
	expect(clearPendingSources()).toEqual(["blob:http://x/2"]);
});

test("a ready asset keeps its identity and label and takes server metadata", () => {
	expect(resolvePendingAsset(pendingAsset)).toBe(pendingAsset);
	setPendingReady("k1", ready);
	expect<unknown>(resolvePendingAsset(pendingAsset)).toEqual({
		...pendingAsset,
		url: ready.url,
		thumb: ready.thumb,
		dur: 4.2,
		metadata: ready.metadata,
		compatibility: ready.compatibility,
		importedSource: ready.importedSource,
	});
});

test("save substitution replaces only ready references; preview substitution also uses local copies", () => {
	setPendingReady("k1", ready);
	setPendingLocalUrl("k2", "blob:http://x/2");
	const doc = {
		clips: [
			{ id: "video:1", url: "pending:k1", mediaAssetId: "k1" },
			{ id: "video:2", url: "pending:k2" },
		],
		media_assets: [pendingAsset],
	};
	const saved = withReadyPending(doc);
	expect(saved.clips).toEqual([
		{ id: "video:1", url: ready.url, mediaAssetId: "k1" },
		{ id: "video:2", url: "pending:k2" },
	]);
	expect(saved.media_assets[0]).toMatchObject({
		id: "k1",
		label: "My beach",
		url: ready.url,
		dur: 4.2,
	});
	expect(JSON.stringify(saved)).not.toContain("pending:k1");
	expect(withResolvedPending(doc).clips.map((c) => c.url)).toEqual([ready.url, "blob:http://x/2"]);
	expect(withReadyPending({ a: 1 })).toEqual({ a: 1 });
});
