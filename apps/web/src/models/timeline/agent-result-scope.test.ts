import { describe, expect, test } from "vite-plus/test";
import {
	applyAgentPreview,
	applyTouchedResult,
	fenceTouchedResult,
	scopeFingerprints,
	touchedScopeOf,
} from "./agent-result-scope.ts";
import type { EditScope } from "@maleo/shared/editor";
import type { Slide, Post } from "@models/content/content-types.ts";
import type { Clip } from "@maleo/shared";

function slide(key: string, cap: string, id = 1): Slide {
	return { key, id, cap, vis: "v", img: false };
}
function post(key: string, body: string, id = 1): Post {
	return { key, id, body, img: false };
}
function clip(id: string, startSec = 0): Clip {
	return { id, type: "image", startSec, durationSec: 4, track: 0 } as Clip;
}

function scope(over: Partial<EditScope> = {}): EditScope {
	return {
		doc: { schemaVersion: 2, clips: [], markers: [], ...over.doc } as EditScope["doc"],
		slides: over.slides ?? [],
		posts: over.posts ?? [],
		mediaAssets: over.mediaAssets ?? [],
	};
}

const base = scope({
	slides: [slide("a", "one", 1), slide("b", "two", 2), slide("c", "three", 3)],
});
const captured = scopeFingerprints(base);

describe("touchedScopeOf", () => {
	test("an unchanged result touches nothing", () => {
		expect(touchedScopeOf(captured, base)).toEqual([]);
	});

	test("an edited entity is touched", () => {
		const result = scope({
			slides: [slide("a", "one", 1), slide("b", "EDITED", 2), slide("c", "three", 3)],
		});
		expect(touchedScopeOf(captured, result)).toEqual([{ kind: "slide", id: "b" }]);
	});

	test("a created entity is touched", () => {
		const result = scope({ slides: [...base.slides, slide("d", "new", 4)] });
		expect(touchedScopeOf(captured, result)).toEqual([{ kind: "slide", id: "d" }]);
	});

	test("a deleted entity is touched", () => {
		const result = scope({ slides: [slide("a", "one", 1), slide("c", "three", 3)] });
		expect(touchedScopeOf(captured, result)).toEqual([{ kind: "slide", id: "b" }]);
	});

	test("a reorder alone does not mark content as touched", () => {
		// `id` is a render ordinal, not content. Renumbering on reorder must not
		// read as an edit to every slide.
		const result = scope({
			slides: [slide("c", "three", 1), slide("a", "one", 2), slide("b", "two", 3)],
		});
		expect(touchedScopeOf(captured, result)).toEqual([]);
	});

	test("works across clips, slides and posts together", () => {
		const before = scope({
			doc: { schemaVersion: 2, clips: [clip("scene:1")], markers: [] } as EditScope["doc"],
			slides: [slide("a", "one")],
			posts: [post("p", "body")],
		});
		const fps = scopeFingerprints(before);
		const after = scope({
			doc: { schemaVersion: 2, clips: [clip("scene:1", 5)], markers: [] } as EditScope["doc"],
			slides: [slide("a", "one")],
			posts: [post("p", "CHANGED")],
		});
		expect(touchedScopeOf(fps, after)).toEqual([
			{ kind: "clip", id: "scene:1" },
			{ kind: "post", id: "p" },
		]);
	});
});

describe("fenceTouchedResult", () => {
	const touched = [{ kind: "slide" as const, id: "b" }];

	test("applies when the touched entity is untouched by the user", () => {
		expect(fenceTouchedResult(captured, base, touched)).toEqual({ status: "apply", touched });
	});

	test("holds when the user edited the same entity", () => {
		const current = scope({
			slides: [slide("a", "one", 1), slide("b", "USER EDIT", 2), slide("c", "three", 3)],
		});
		expect(fenceTouchedResult(captured, current, touched)).toEqual({
			status: "hold",
			reason: "changed",
			conflicts: touched,
		});
	});

	test("holds when the user deleted the entity rather than recreating it", () => {
		const current = scope({ slides: [slide("a", "one", 1), slide("c", "three", 3)] });
		expect(fenceTouchedResult(captured, current, touched)).toEqual({
			status: "hold",
			reason: "deleted",
			conflicts: touched,
		});
	});

	test("an unrelated edit is not a conflict", () => {
		// The flaw a project-wide revision counter has: this would have blocked.
		const current = scope({
			slides: [slide("a", "USER EDIT", 1), slide("b", "two", 2), slide("c", "three", 3)],
		});
		expect(fenceTouchedResult(captured, current, touched).status).toBe("apply");
	});

	test("edit-and-revert is not a conflict", () => {
		const current = scope({
			slides: [slide("a", "one", 1), slide("b", "two", 2), slide("c", "three", 3)],
		});
		expect(fenceTouchedResult(captured, current, touched).status).toBe("apply");
	});

	test("an entity the run created has nothing to conflict with", () => {
		const current = scope({ slides: base.slides });
		expect(fenceTouchedResult(captured, current, [{ kind: "slide", id: "brand-new" }]).status).toBe(
			"apply",
		);
	});
});

describe("applyTouchedResult", () => {
	test("writes the touched entity and leaves the rest current", () => {
		const result = scope({
			slides: [slide("a", "one", 1), slide("b", "AGENT", 2), slide("c", "three", 3)],
		});
		const next = applyTouchedResult(base, result, [{ kind: "slide", id: "b" }]);
		expect(next.slides.map((s) => s.cap)).toEqual(["one", "AGENT", "three"]);
	});

	test("an unrelated edit made during the run survives", () => {
		// The case that motivates the whole module: the result carries the OLD copy
		// of slide "a", because that is what the run read.
		const current = scope({
			slides: [slide("a", "USER EDIT", 1), slide("b", "two", 2), slide("c", "three", 3)],
		});
		const result = scope({
			slides: [slide("a", "one", 1), slide("b", "AGENT", 2), slide("c", "three", 3)],
		});
		const next = applyTouchedResult(current, result, [{ kind: "slide", id: "b" }]);
		expect(next.slides.map((s) => s.cap)).toEqual(["USER EDIT", "AGENT", "three"]);
	});

	test("an entity the result rewrote but did not touch keeps the user's value", () => {
		// A model that quietly rewrites something it was not asked to change does
		// not get to win, because it is not in the touched set.
		const result = scope({
			slides: [slide("a", "SNEAKY", 1), slide("b", "AGENT", 2), slide("c", "three", 3)],
		});
		const next = applyTouchedResult(base, result, [{ kind: "slide", id: "b" }]);
		expect(next.slides.map((s) => s.cap)).toEqual(["one", "AGENT", "three"]);
	});

	test("a slide the user added during the run is kept even though the result never saw it", () => {
		const current = scope({ slides: [...base.slides, slide("d", "user added", 4)] });
		const result = scope({
			slides: [slide("a", "one", 1), slide("b", "AGENT", 2), slide("c", "three", 3)],
		});
		const next = applyTouchedResult(current, result, [{ kind: "slide", id: "b" }]);
		expect(next.slides.map((s) => s.key)).toEqual(["a", "b", "c", "d"]);
	});

	test("a slide reorder during the run survives a touched edit", () => {
		const current = scope({
			slides: [slide("c", "three", 1), slide("a", "one", 2), slide("b", "two", 3)],
		});
		const result = scope({
			slides: [slide("a", "one", 1), slide("b", "AGENT", 2), slide("c", "three", 3)],
		});
		const next = applyTouchedResult(current, result, [{ kind: "slide", id: "b" }]);
		expect(next.slides.map((s) => [s.key, s.cap])).toEqual([
			["c", "three"],
			["a", "one"],
			["b", "AGENT"],
		]);
	});

	test("a post reorder during the run survives a touched edit", () => {
		const current = scope({
			posts: [post("c", "three", 1), post("a", "one", 2), post("b", "two", 3)],
		});
		const result = scope({
			posts: [post("a", "one", 1), post("b", "AGENT", 2), post("c", "three", 3)],
		});
		const next = applyTouchedResult(current, result, [{ kind: "post", id: "b" }]);
		expect(next.posts.map((item) => [item.key, item.body])).toEqual([
			["c", "three"],
			["a", "one"],
			["b", "AGENT"],
		]);
	});

	test("a touched deletion removes the entity", () => {
		const result = scope({ slides: [slide("a", "one", 1), slide("c", "three", 3)] });
		const next = applyTouchedResult(base, result, [{ kind: "slide", id: "b" }]);
		expect(next.slides.map((s) => s.key)).toEqual(["a", "c"]);
	});

	test("a touched creation is added", () => {
		const result = scope({ slides: [...base.slides, slide("d", "agent added", 4)] });
		const next = applyTouchedResult(base, result, [{ kind: "slide", id: "d" }]);
		expect(next.slides.map((s) => s.key)).toEqual(["a", "b", "c", "d"]);
	});

	test("an empty touched set is a no-op", () => {
		const result = scope({ slides: [slide("a", "AGENT", 1)] });
		expect(applyTouchedResult(base, result, [])).toBe(base);
	});

	test("clips merge by stable clip id", () => {
		const current = scope({
			doc: {
				schemaVersion: 2,
				clips: [clip("scene:1"), clip("scene:2", 4)],
				markers: [],
			} as EditScope["doc"],
		});
		const result = scope({
			doc: {
				schemaVersion: 2,
				clips: [clip("scene:1", 9), clip("scene:2", 4)],
				markers: [],
			} as EditScope["doc"],
		});
		const next = applyTouchedResult(current, result, [{ kind: "clip", id: "scene:1" }]);
		expect(next.doc.clips.map((c) => c.startSec)).toEqual([9, 4]);
	});

	test("the returned scope is new, never the result written wholesale", () => {
		const result = scope({ slides: [slide("b", "AGENT", 1)] });
		const next = applyTouchedResult(base, result, [{ kind: "slide", id: "b" }]);
		expect(next).not.toBe(result);
		expect(next.slides).toHaveLength(3);
	});
});

describe("applyAgentPreview", () => {
	test("own preview remains valid baseline for settled fencing", () => {
		const preview = scope({
			slides: [slide("a", "one", 1), slide("b", "PREVIEW", 2), slide("c", "three", 3)],
		});
		const applied = applyAgentPreview(base, base, preview);
		expect(applied.status).toBe("apply");
		if (applied.status !== "apply") return;
		const final = scope({
			slides: [slide("a", "one", 1), slide("b", "FINAL", 2), slide("c", "three", 3)],
		});
		const touched = touchedScopeOf(captured, final);
		expect(
			fenceTouchedResult(scopeFingerprints(applied.expected), applied.current, touched).status,
		).toBe("apply");
	});

	test("user edit after preview still holds settled result", () => {
		const preview = scope({
			slides: [slide("a", "one", 1), slide("b", "PREVIEW", 2), slide("c", "three", 3)],
		});
		const applied = applyAgentPreview(base, base, preview);
		if (applied.status !== "apply") throw new Error("preview should apply");
		const userCurrent = scope({
			slides: [slide("a", "one", 1), slide("b", "USER", 2), slide("c", "three", 3)],
		});
		const final = scope({
			slides: [slide("a", "one", 1), slide("b", "FINAL", 2), slide("c", "three", 3)],
		});
		const decision = fenceTouchedResult(
			scopeFingerprints(applied.expected),
			userCurrent,
			touchedScopeOf(captured, final),
		);
		expect(decision).toEqual({
			status: "hold",
			reason: "changed",
			conflicts: [{ kind: "slide", id: "b" }],
		});
	});

	test("user edit before first preview is not overwritten", () => {
		const userCurrent = scope({
			slides: [slide("a", "one", 1), slide("b", "USER", 2), slide("c", "three", 3)],
		});
		const preview = scope({
			slides: [slide("a", "one", 1), slide("b", "PREVIEW", 2), slide("c", "three", 3)],
		});
		expect(applyAgentPreview(base, userCurrent, preview)).toEqual({
			status: "hold",
			reason: "changed",
			conflicts: [{ kind: "slide", id: "b" }],
		});
	});
});
