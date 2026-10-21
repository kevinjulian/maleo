import { describe, expect, it, test } from "vite-plus/test";
import {
	compileManifest,
	isCarried,
	readPublishedTrack,
	readSidecar,
	type PublishedTrack,
	type SidecarTrack,
} from "./music-compile.ts";

const sidecar = (over: Partial<SidecarTrack> & { source: string }): SidecarTrack => ({
	file: "a.mp3",
	title: "A Track",
	description: "",
	tags: ["ambient"],
	license: "Pixabay Content License",
	...over,
});

const published = (over: Partial<PublishedTrack> & { source: string }): PublishedTrack => ({
	id: "calm",
	url: "https://files.test/music/music-calm-aaaa1111.mp3",
	title: "A Track",
	description: "sustained pad",
	tags: ["ambient", "pad"],
	emotion: "calm",
	sha256: "aaaa1111",
	license: "Pixabay Content License",
	...over,
});

describe("adding newly captured beds", () => {
	it("takes a sidecar that was never published", () => {
		const result = compileManifest([], [sidecar({ source: "https://pixabay.test/a" })]);
		expect(result.added).toBe(1);
		expect(result.tracks).toHaveLength(1);
	});

	it("keeps the first when the same track is captured twice in one folder", () => {
		const result = compileManifest(
			[],
			[
				sidecar({ source: "https://pixabay.test/a", file: "first.mp3" }),
				sidecar({ source: "https://pixabay.test/a/", file: "second.mp3" }),
			],
		);
		expect(result.tracks).toHaveLength(1);
		expect(result.tracks[0]!.file).toBe("first.mp3");
		expect(result.problems.join(" ")).toContain("second.mp3");
	});

	it("skips a sidecar with no provenance and says which", () => {
		const result = compileManifest(
			[],
			[sidecar({ source: "https://x/a", license: "", file: "bad.mp3" })],
		);
		expect(result.tracks).toHaveLength(0);
		expect(result.problems.join(" ")).toContain("bad.mp3");
	});
});

describe("beds that are already published", () => {
	it("carries one whose audio is no longer on disk", () => {
		// The whole reason this module exists. Nobody keeps every mp3 they ever
		// published; if this fell out here, bake would not see it, publish would
		// call it orphaned, and the library would quietly shrink.
		const result = compileManifest([published({ source: "https://pixabay.test/old" })], []);
		expect(result.carried).toBe(1);
		expect(isCarried(result.tracks[0]!)).toBe(true);
		expect(result.tracks[0]!.url).toBe("https://files.test/music/music-calm-aaaa1111.mp3");
	});

	it("keeps its labels and its hash, so publish can recognise it", () => {
		const result = compileManifest([published({ source: "https://pixabay.test/old" })], []);
		expect(result.tracks[0]!.description).toBe("sustained pad");
		expect(result.tracks[0]!.emotion).toBe("calm");
		expect(result.tracks[0]!.sha256).toBe("aaaa1111");
	});

	it("does not treat a trailing slash as a different track", () => {
		const result = compileManifest(
			[published({ source: "https://pixabay.test/a" })],
			[sidecar({ source: "https://pixabay.test/a/" })],
		);
		expect(result.tracks).toHaveLength(1);
		expect(result.updated).toBe(1);
	});
});

describe("recapturing a bed that is already published", () => {
	it("does not lose the description enrich wrote", () => {
		// The extension always writes a blank description — descriptions come from
		// enrich, later. Overwriting with blank would throw the work away and cost
		// another labelling pass.
		const result = compileManifest(
			[published({ source: "https://pixabay.test/a", description: "sustained pad, slow build" })],
			[sidecar({ source: "https://pixabay.test/a", description: "" })],
		);
		expect(result.tracks[0]!.description).toBe("sustained pad, slow build");
	});

	it("does not lose the emotion either", () => {
		const result = compileManifest(
			[published({ source: "https://pixabay.test/a", emotion: "hope" })],
			[sidecar({ source: "https://pixabay.test/a", emotion: undefined })],
		);
		expect(result.tracks[0]!.emotion).toBe("hope");
	});

	it("prefers what the operator just wrote when they wrote something", () => {
		const result = compileManifest(
			[published({ source: "https://pixabay.test/a", description: "old", emotion: "calm" })],
			[
				sidecar({
					source: "https://pixabay.test/a",
					description: "corrected by hand",
					emotion: "tension",
				}),
			],
		);
		expect(result.tracks[0]!.description).toBe("corrected by hand");
		expect(result.tracks[0]!.emotion).toBe("tension");
	});

	it("keeps the author when a recapture predates its capture", () => {
		const result = compileManifest(
			[published({ source: "https://pixabay.test/a", author: "SigmaMusicArt" })],
			[sidecar({ source: "https://pixabay.test/a", author: "" })],
		);
		expect(result.tracks[0]!.author).toBe("SigmaMusicArt");
	});

	it("carries the author on a bed that was not recaptured", () => {
		const result = compileManifest(
			[published({ source: "https://x/1", author: "SigmaMusicArt" })],
			[],
		);
		expect(result.tracks[0]!.author).toBe("SigmaMusicArt");
	});

	it("takes fresh tags when the recapture has them", () => {
		const result = compileManifest(
			[published({ source: "https://pixabay.test/a", tags: ["old"] })],
			[sidecar({ source: "https://pixabay.test/a", tags: ["sad piano", "rain"] })],
		);
		expect(result.tracks[0]!.tags).toEqual(["sad piano", "rain"]);
	});

	it("keeps the published url so the recaptured bed is not published twice", () => {
		const result = compileManifest(
			[published({ source: "https://pixabay.test/a" })],
			[sidecar({ source: "https://pixabay.test/a" })],
		);
		expect(result.tracks[0]!.url).toBe("https://files.test/music/music-calm-aaaa1111.mp3");
		expect(result.tracks[0]!.file).toBe("a.mp3");
	});
});

describe("a whole run", () => {
	it("adds, updates and carries in one pass without losing anything", () => {
		const result = compileManifest(
			[
				published({ source: "https://pixabay.test/kept", title: "Kept" }),
				published({ source: "https://pixabay.test/recaptured", title: "Recaptured" }),
			],
			[
				sidecar({ source: "https://pixabay.test/recaptured", file: "re.mp3" }),
				sidecar({ source: "https://pixabay.test/brand-new", file: "new.mp3" }),
			],
		);
		expect(result.tracks).toHaveLength(3);
		expect({ added: result.added, updated: result.updated, carried: result.carried }).toEqual({
			added: 1,
			updated: 1,
			carried: 1,
		});
		expect(result.problems).toEqual([]);
	});

	it("is empty rather than throwing when there is nothing at all", () => {
		expect(compileManifest([], []).tracks).toEqual([]);
	});
});

describe("reading track rows from disk", () => {
	test("a sidecar keeps its typed fields and extra keys, and drops wrong types", () => {
		expect(
			readSidecar({
				file: "bed.mp3",
				title: "Bed",
				source: "https://example.test/bed",
				license: "CC0",
				tags: ["calm", 3],
				durationSec: "12",
				author: 7,
				capturedBy: "extension",
			}),
		).toEqual({
			file: "bed.mp3",
			title: "Bed",
			source: "https://example.test/bed",
			license: "CC0",
			tags: ["calm"],
			capturedBy: "extension",
		});
	});

	test("a row missing its provenance reads as empty, which compile then reports", () => {
		const sidecar = readSidecar({ file: "x.mp3", title: "X", source: 1 });
		expect(sidecar.source).toBe("");
		expect(compileManifest([], [sidecar]).problems).toEqual([
			"x.mp3 has no source or licence and was skipped",
		]);
	});

	test("a published row is read without inventing a file", () => {
		expect(
			readPublishedTrack({
				id: "b1",
				url: "https://cdn.test/b1.mp3",
				title: "B1",
				source: "s",
				license: "l",
			}),
		).toEqual({ id: "b1", url: "https://cdn.test/b1.mp3", title: "B1", source: "s", license: "l" });
	});
});
