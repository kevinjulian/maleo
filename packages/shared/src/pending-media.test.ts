import { expect, test } from "vite-plus/test";
import {
	isPendingMediaUrl,
	localMediaUrlIssues,
	pendingMediaBlockers,
	pendingMediaRequestKey,
	pendingMediaUrl,
} from "./pending-media.ts";

test("pending references round-trip one import request key", () => {
	expect(pendingMediaUrl("abc_123-x")).toBe("pending:abc_123-x");
	expect(pendingMediaRequestKey(pendingMediaUrl("abc_123-x"))).toBe("abc_123-x");
	expect(isPendingMediaUrl("pending:abc")).toBe(true);
});

test("malformed pending references and keys are refused", () => {
	for (const value of [
		"pending:",
		"pending:a/b",
		"pending:a b",
		`pending:${"x".repeat(161)}`,
		"/api/media/x",
		"blob:pending:x",
		"Pending:x",
		3,
		undefined,
	])
		expect(pendingMediaRequestKey(value)).toBeUndefined();
	expect(isPendingMediaUrl("pending:../x")).toBe(false);
	expect(() => pendingMediaUrl("a/b")).toThrow();
	expect(() => pendingMediaUrl("")).toThrow();
});

test("blockers name each pending file the render uses, once", () => {
	const input = {
		clips: [
			{ id: "c1", url: "pending:k1", label: "beach.mov" },
			{ id: "c2", video: { url: "pending:k1" } },
			{ id: "c3", url: "pending:k2" },
			{ id: "c4", url: "/api/media/11111111-1111-4111-8111-111111111111" },
		],
	};
	const assets = [
		{ id: "k1", url: "pending:k1", label: "Beach", metadata: { originalFilename: "beach.mov" } },
		{ id: "k3", url: "pending:k3", label: "unplaced.wav" },
	];
	expect(pendingMediaBlockers(input, assets)).toEqual([
		"beach.mov is still uploading. Wait for it to finish before export.",
		"A file is still uploading. Wait for it to finish before export.",
	]);
	expect(pendingMediaBlockers({ clips: [{ url: "/api/media/x" }] }, assets)).toEqual([]);
});

test("blockers fall back to a clip label when no asset names the file", () => {
	expect(pendingMediaBlockers([{ url: "pending:k9", label: "voice.m4a" }])).toEqual([
		"voice.m4a is still uploading. Wait for it to finish before export.",
	]);
});

test("persistence issues name browser-local media URLs by field path", () => {
	const blank = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==";
	const doc = {
		clips: [
			{ id: "c1", url: "blob:http://localhost/1", video: { thumb: "data:image/jpeg;base64,AAAA" } },
		],
		scenes: [
			{ image: blank, visualClips: [{ src: `data:image/png;base64,${"A".repeat(70_000)}` }] },
		],
		mediaAssets: [{ url: "data:video/mp4;base64,AAAA", label: "data: is fine in text" }],
		caption: "blob: in prose is not a media field",
	};
	expect(localMediaUrlIssues(doc)).toEqual([
		"clips[0].url is a browser-local blob: URL",
		"scenes[0].visualClips[0].src is a data: URL too large to store",
		"mediaAssets[0].url is a data: URL that is not an image",
	]);
	expect(localMediaUrlIssues({ clips: [{ url: "pending:k1", thumb: "/api/media/x" }] })).toEqual(
		[],
	);
});
