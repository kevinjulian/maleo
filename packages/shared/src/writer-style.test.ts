import { describe, expect, it } from "vite-plus/test";
import {
	WRITER_STYLES,
	forbiddenPhraseHits,
	resolveWriterStyle,
	writerStyleProfileSchema,
	writerStyleProfiles,
} from "./writer-style.ts";

describe("resolveWriterStyle", () => {
	it("resolves every library key to its own profile", () => {
		for (const key of WRITER_STYLES) {
			expect(resolveWriterStyle(key)?.key).toBe(key);
		}
	});

	it("yields undefined for an absent selection", () => {
		expect(resolveWriterStyle(undefined)).toBeUndefined();
		expect(resolveWriterStyle("")).toBeUndefined();
	});

	/* A retired or misspelled key must degrade to "no writer style", never throw:
	 * a workspace that stored a key this file no longer defines still has to load. */
	it("yields undefined for an unknown key without throwing", () => {
		expect(resolveWriterStyle("hemingway")).toBeUndefined();
		expect(resolveWriterStyle("PLAINSPOKEN_REPORTAGE")).toBeUndefined();
		expect(resolveWriterStyle("plainspoken_reportage ")).toBeUndefined();
	});
});

describe("the writer style library", () => {
	it("exposes one profile per key, in library order", () => {
		expect(writerStyleProfiles().map((profile) => profile.key)).toEqual([...WRITER_STYLES]);
	});

	it("has every profile parse its own schema", () => {
		for (const profile of writerStyleProfiles()) {
			expect(() => writerStyleProfileSchema.parse(profile)).not.toThrow();
		}
	});

	it("gives every profile a positive sentence density", () => {
		for (const profile of writerStyleProfiles()) {
			expect(profile.sentencesPerHundredWords).toBeGreaterThan(0);
		}
	});

	it("gives every profile forbidden moves and scannable phrases", () => {
		for (const profile of writerStyleProfiles()) {
			expect(profile.forbiddenMoves.length).toBeGreaterThan(0);
			expect(profile.forbiddenPhrases.length).toBeGreaterThan(0);
		}
	});

	/* The two lists do different jobs. Moves are descriptions a planner can honour
	 * but no substring scan can detect; phrases are literals that either appear or
	 * do not. A description landing in the scannable list produces a check that
	 * silently never fires, which reads like coverage while providing none. */
	it("keeps descriptions out of the scannable list", () => {
		const descriptions = [
			/\bquestions\b/,
			/\bcadence\b/,
			/\bwithout proof\b/,
			/\bself-evident\b/,
			/\bbefore its definition\b/,
		];
		for (const profile of writerStyleProfiles()) {
			for (const phrase of profile.forbiddenPhrases) {
				for (const description of descriptions) expect(phrase).not.toMatch(description);
			}
		}
	});

	/* Profiles are craft descriptions, not author impersonations. A key or label
	 * naming a real writer asks the system to imitate an identifiable person and
	 * produces pastiche that ages badly across model versions. */
	it("names no real writer in a key or label", () => {
		const writers = [
			"hemingway",
			"king",
			"gladwell",
			"mccarthy",
			"didion",
			"orwell",
			"vonnegut",
			"attenborough",
			"sagan",
		];
		for (const profile of writerStyleProfiles()) {
			const haystack = `${profile.key} ${profile.label}`.toLocaleLowerCase();
			for (const writer of writers) expect(haystack).not.toContain(writer);
		}
	});

	it("spreads sentence density rather than giving every profile the same value", () => {
		const densities = new Set(
			writerStyleProfiles().map((profile) => profile.sentencesPerHundredWords),
		);
		expect(densities.size).toBeGreaterThan(1);
	});
});

describe("forbiddenPhraseHits", () => {
	const tutorial = resolveWriterStyle("procedural_precise")!;

	it("finds a banned phrase regardless of case or punctuation", () => {
		expect(forbiddenPhraseHits("Simply, open the panel.", tutorial)).toContain("simply");
		expect(forbiddenPhraseHits("OBVIOUSLY the valve is closed", tutorial)).toContain("obviously");
		expect(forbiddenPhraseHits("All you have to do is wait.", tutorial)).toContain(
			"all you have to do",
		);
	});

	/* The reason this matches on word boundaries rather than by substring: "just"
	 * inside "adjusted" is not the tic the profile bans. */
	it("does not match a banned word inside a larger word", () => {
		expect(forbiddenPhraseHits("Adjusted the bracket until it seated.", tutorial)).toEqual([]);
	});

	it("returns nothing for clean narration", () => {
		expect(
			forbiddenPhraseHits("Open the panel. Seat the bracket. Tighten both screws.", tutorial),
		).toEqual([]);
	});

	it("returns nothing when there is no profile", () => {
		expect(forbiddenPhraseHits("Simply do the thing.", undefined)).toEqual([]);
	});

	it("reports each distinct phrase it found", () => {
		const hits = forbiddenPhraseHits("Simply open it. Obviously it works.", tutorial);
		expect(hits).toContain("simply");
		expect(hits).toContain("obviously");
	});
});
