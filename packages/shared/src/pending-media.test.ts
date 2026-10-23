import { expect, test } from "vite-plus/test";
import { localMediaUrlIssues } from "./pending-media.ts";

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
	expect(localMediaUrlIssues({ clips: [{ url: "/api/media/x", thumb: "/api/media/y" }] })).toEqual(
		[],
	);
});
