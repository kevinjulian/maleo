import { describe, expect, it } from "vite-plus/test";
import { applyEntityDraft, nextTags } from "./entity-write.ts";
import type { RefImage } from "@maleo/shared";

const anna: RefImage = {
	id: "anna",
	label: "Anna",
	seed: 7,
	role: "character",
	tags: ["character", "kitchen"],
	imageUrl: "/u/a.png",
	description: "red coat",
};
const draft = { role: "location", label: "Anna B", description: "a corner cafe", src: "/u/b.png" };

describe("nextTags", () => {
	it("replaces the previous role tag and keeps everything else", () => {
		// The bug this covers: an edit used to write `[role]`, silently dropping
		// "kitchen" and every filter built on it.
		expect(nextTags("location", ["character", "kitchen"])).toEqual(["location", "kitchen"]);
	});
	it("does not duplicate the role when it is already the only tag", () => {
		expect(nextTags("character", ["character"])).toEqual(["character"]);
	});
	it("handles an entity with no tags", () => {
		expect(nextTags("product", undefined)).toEqual(["product"]);
	});
});

describe("applyEntityDraft", () => {
	it("keeps the id, so a role change edits in place instead of forking", () => {
		const next = applyEntityDraft(draft, anna, () => "new-id");
		expect(next.id).toBe("anna");
		expect(next.role).toBe("location");
		expect(next.tags).toEqual(["location", "kitchen"]);
	});
	it("mints an id only for a new entity", () => {
		expect(applyEntityDraft(draft, undefined, () => "new-id").id).toBe("new-id");
	});
	it("carries the generating prompt and marks the entity generated", () => {
		const next = applyEntityDraft({ ...draft, prompt: "a cafe at dusk" }, undefined, () => "x");
		expect(next.prompt).toBe("a cafe at dusk");
		expect(next.generated).toBe(true);
	});
	it("preserves an existing prompt when the draft carries none", () => {
		const next = applyEntityDraft(draft, { ...anna, prompt: "earlier" }, () => "x");
		expect(next.prompt).toBe("earlier");
	});
	it("preserves the seed, so an edit does not reshuffle the placeholder art", () => {
		expect(applyEntityDraft(draft, anna, () => "x").seed).toBe(7);
	});
});
