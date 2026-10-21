import { describe, expect, it } from "vite-plus/test";
import {
	assignUniqueIds,
	dropDuplicateAudio,
	findDuplicates,
	type PreparedTrack,
} from "./music-dedup.ts";

const track = (over: Partial<PreparedTrack> & { file: string }): PreparedTrack => ({
	id: over.file.replace(/\.[^.]+$/, ""),
	title: over.file,
	source: `https://pixabay.test/${over.file}`,
	sha256: `hash-${over.file}`,
	...over,
});

describe("finding duplicates", () => {
	it("catches byte-identical beds captured under different titles", () => {
		// The filename embeds title AND hash, so two labels for one recording
		// produce two names — only the hash notices.
		const problems = findDuplicates([
			track({ file: "calm.mp3", id: "calm", sha256: "aaaa1111" }),
			track({ file: "soft-pad.mp3", id: "soft-pad", sha256: "aaaa1111" }),
		]);
		expect(problems).toHaveLength(1);
		expect(problems[0]!.kind).toBe("same-audio");
		expect(problems[0]!.files).toEqual(["calm.mp3", "soft-pad.mp3"]);
	});

	it("catches a source url listed twice", () => {
		const problems = findDuplicates([
			track({ file: "a.mp3", source: "https://pixabay.test/x/" }),
			track({ file: "b.mp3", source: "https://pixabay.test/x" }),
		]);
		expect(problems.some((p) => p.kind === "same-source")).toBe(true);
	});

	it("catches an id collision, which the emotion lookup would hide", () => {
		// bakedMusicForEmotion uses find(), so a second "calm" bed is simply never
		// reachable — the manifest looks fine and one bed is dead weight.
		const problems = findDuplicates([
			track({ file: "one.mp3", id: "calm" }),
			track({ file: "two.mp3", id: "calm" }),
		]);
		const collision = problems.find((p) => p.kind === "duplicate-id");
		expect(collision).toBeDefined();
		expect(collision!.files).toEqual(["one.mp3", "two.mp3"]);
	});

	it("reports every problem in one pass", () => {
		const problems = findDuplicates([
			track({ file: "a.mp3", id: "calm", sha256: "same", source: "https://x/1" }),
			track({ file: "b.mp3", id: "calm", sha256: "same", source: "https://x/1" }),
		]);
		expect(new Set(problems.map((p) => p.kind))).toEqual(
			new Set(["same-audio", "same-source", "duplicate-id"]),
		);
	});

	it("is quiet about a clean set", () => {
		expect(findDuplicates([track({ file: "a.mp3" }), track({ file: "b.mp3" })])).toEqual([]);
	});

	it("does not treat missing hashes as identical", () => {
		const problems = findDuplicates([
			track({ file: "a.mp3", sha256: undefined }),
			track({ file: "b.mp3", sha256: undefined }),
		]);
		expect(problems.some((p) => p.kind === "same-audio")).toBe(false);
	});
});

describe("making ids unique", () => {
	it("leaves an already-unique set untouched", () => {
		const input = [track({ file: "a.mp3", id: "calm" }), track({ file: "b.mp3", id: "hope" })];
		expect(assignUniqueIds(input).map((t) => t.id)).toEqual(["calm", "hope"]);
	});

	it("disambiguates a collision with the content hash", () => {
		const ids = assignUniqueIds([
			track({ file: "a.mp3", id: "calm", sha256: "aaaa1111bbbb" }),
			track({ file: "b.mp3", id: "calm", sha256: "cccc2222dddd" }),
		]).map((t) => t.id);
		expect(ids).toEqual(["calm-aaaa1111", "calm-cccc2222"]);
	});

	it("does not depend on ordering", () => {
		// A counter would rename beds when the input order changed, invalidating
		// anything that referenced them.
		const a = track({ file: "a.mp3", id: "calm", sha256: "aaaa1111" });
		const b = track({ file: "b.mp3", id: "calm", sha256: "bbbb2222" });
		const forward = assignUniqueIds([a, b])
			.map((t) => t.id)
			.sort();
		const reverse = assignUniqueIds([b, a])
			.map((t) => t.id)
			.sort();
		expect(forward).toEqual(reverse);
	});
});

describe("dropping duplicate audio", () => {
	it("keeps the first and reports the rest", () => {
		const { kept, dropped } = dropDuplicateAudio([
			track({ file: "keep.mp3", sha256: "same" }),
			track({ file: "drop.mp3", sha256: "same" }),
			track({ file: "other.mp3", sha256: "different" }),
		]);
		expect(kept.map((t) => t.file)).toEqual(["keep.mp3", "other.mp3"]);
		expect(dropped.map((t) => t.file)).toEqual(["drop.mp3"]);
	});

	it("keeps beds that have no hash rather than collapsing them", () => {
		const { kept } = dropDuplicateAudio([
			track({ file: "a.mp3", sha256: undefined }),
			track({ file: "b.mp3", sha256: undefined }),
		]);
		expect(kept).toHaveLength(2);
	});
});
