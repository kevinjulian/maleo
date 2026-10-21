import { describe, expect, it } from "vite-plus/test";
import { isCastable, scenesStrandedBy, tierOf, usageCount, usageMap } from "./tiers.ts";

const projectEntityIds = ["anna", "cafe"];
const sceneCasts = [["anna"], ["anna", "cafe"], []];

describe("tierOf", () => {
	it("reports the deepest scope an entity belongs to", () => {
		expect(tierOf("anna", { projectEntityIds, sceneRefIds: ["anna"] })).toBe("scene");
		expect(tierOf("cafe", { projectEntityIds, sceneRefIds: ["anna"] })).toBe("project");
		expect(tierOf("stranger", { projectEntityIds, sceneRefIds: ["anna"] })).toBe("workspace");
	});

	it("falls back to project scope when no scene is in context", () => {
		expect(tierOf("anna", { projectEntityIds })).toBe("project");
		expect(tierOf("stranger", { projectEntityIds })).toBe("workspace");
	});
});

describe("isCastable", () => {
	it("allows casting only what the project has selected", () => {
		expect(isCastable("anna", { projectEntityIds })).toBe(true);
		// The defect this rule exists to prevent: a scene casting an entity the
		// project never selected renders nothing, because the generation path
		// resolves ids through the project roster.
		expect(isCastable("stranger", { projectEntityIds })).toBe(false);
	});
});

describe("usageCount", () => {
	it("spans the project selection and every scene cast", () => {
		expect(usageCount("anna", { projectEntityIds, sceneCasts })).toBe(3); // project + 2 scenes
		expect(usageCount("cafe", { projectEntityIds, sceneCasts })).toBe(2); // project + 1 scene
	});

	it("counts an unattached entity as zero", () => {
		expect(usageCount("stranger", { projectEntityIds, sceneCasts })).toBe(0);
	});

	it("counts a scene cast that the project has not selected", () => {
		expect(usageCount("ghost", { projectEntityIds, sceneCasts: [["ghost"]] })).toBe(1);
	});
});

describe("usageMap", () => {
	it("matches usageCount for every attached id in one pass", () => {
		const map = usageMap({ projectEntityIds, sceneCasts });
		expect(map.get("anna")).toBe(3);
		expect(map.get("cafe")).toBe(2);
		expect(map.get("stranger")).toBeUndefined();
	});

	it("is empty when nothing is attached", () => {
		expect(usageMap({ projectEntityIds: [], sceneCasts: [] }).size).toBe(0);
	});
});

describe("scenesStrandedBy", () => {
	it("counts the scenes that would lose a cast member", () => {
		expect(scenesStrandedBy("anna", sceneCasts)).toBe(2);
		expect(scenesStrandedBy("cafe", sceneCasts)).toBe(1);
		expect(scenesStrandedBy("stranger", sceneCasts)).toBe(0);
	});
});
