import { describe, expect, it } from "bun:test";
import { orderRefsForBinding, referenceMapFor, sceneIntent } from "./visual-gen.ts";

const IMG = "/api/image-gen/files/x.png";
const IMG2 = "/api/image-gen/files/y.png";
const STYLE = "/api/image-gen/files/style.png";

describe("sceneIntent", () => {
	it("keeps scene, look, rules, and camera in separate provider fields", () => {
		const refs = [
			{
				url: "https://example.com/worker.png",
				role: "character" as const,
				entityId: "worker",
				label: "worker bee",
			},
		];
		const intent = sceneIntent(
			{
				name: "Worker",
				durationSec: 4,
				shot: "Macro",
				move: "Push in",
				transition: "fade",
				visual: "bee enters hive",
				action: "landing",
				voiceover: "",
				emotion: "tense",
			},
			"9:16",
			refs,
			"watercolor",
			{ raw: "", story: "", voice: "", visual: "golden light", rules: "no human hands" },
		);
		expect(intent.scene).toEqual({ visualMoment: "bee enters hive", action: "landing" });
		expect(intent.composition).toEqual({ shotType: "Macro", movement: "Push in" });
		expect(intent.style?.visualTreatment).toBe("watercolor");
		expect(intent.lightingColor?.mood).toBe("tense");
		expect(intent.constraints.mustInclude).toContain("golden light");
		expect(intent.constraints.mustAvoid).toContain("human hands");
		expect(intent.references).toEqual(refs);
		expect(intent.subjectLocks[0]?.referenceId).toBe("worker");
		expect(intent.scene.visualMoment).not.toContain("golden light");
	});
});

describe("orderRefsForBinding", () => {
	it("puts subjects first and the style ref last", () => {
		const ordered = orderRefsForBinding([
			{ url: STYLE, role: "style" },
			{ url: IMG, role: "character", entityId: "man" },
			{ url: IMG2, role: "location", entityId: "cafe" },
		]);
		expect(ordered.map((r) => r.role)).toEqual(["character", "location", "style"]);
	});

	it("drops urlless refs and caps at 4", () => {
		const ordered = orderRefsForBinding([
			{ url: "", role: "character" },
			{ url: "a", role: "character" },
			{ url: "b", role: "character" },
			{ url: "c", role: "character" },
			{ url: "d", role: "character" },
			{ url: "e", role: "character" },
		]);
		expect(ordered).toHaveLength(4);
	});
});

describe("referenceMapFor", () => {
	it("numbers subject images and excludes the trailing style ref", () => {
		const ordered = orderRefsForBinding([
			{ url: STYLE, role: "style" },
			{ url: IMG, role: "character", entityId: "man", label: "navy suit" },
			{ url: IMG2, role: "character", entityId: "woman", label: "red dress" },
		]);
		const map = referenceMapFor(ordered);
		expect(map).toContain("Image 1 = man: navy suit. Use ONLY for man.");
		expect(map).toContain("Image 2 = woman: red dress. Use ONLY for woman.");
		expect(map).toContain("Do not blend");
		expect(map).not.toContain("style");
	});

	it("map index N names the ref at ordered position N (alignment invariant)", () => {
		const ordered = orderRefsForBinding([
			{ url: IMG, role: "character", entityId: "man", label: "man" },
			{ url: STYLE, role: "style" },
			{ url: IMG2, role: "product", entityId: "bottle", label: "bottle" },
		]);
		const subjects = ordered.filter((r) => r.role !== "style");
		const map = referenceMapFor(ordered);
		subjects.forEach((ref, i) => {
			expect(map).toContain(`Image ${i + 1} = ${ref.entityId}:`);
		});
	});

	it("returns empty when only a style ref is present", () => {
		expect(referenceMapFor(orderRefsForBinding([{ url: STYLE, role: "style" }]))).toBe("");
	});
});
