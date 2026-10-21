/* Tool registry — single-source guarantees + stage-1 intent scoping. */
import { describe, expect, it } from "bun:test";
import {
	TOOLS,
	toolByName,
	toolsForContentType,
	toolsForIntent,
	ALL_TOOL_NAMES,
	toolNamesForContentType,
} from "../modules/agents/core/registry.ts";
import { renderToolList } from "../modules/agents/core/prompt.ts";
import type { ToolContext } from "../modules/agents/core/types.ts";

describe("agent tool registry", () => {
	it("has unique tool names and exposes them all in the enum list", () => {
		const names = TOOLS.map((t) => t.name);
		expect(new Set(names).size).toBe(names.length);
		// Every registered tool + the add_beat alias appears in the decision enum.
		for (const n of names) expect(ALL_TOOL_NAMES).toContain(n);
		expect(ALL_TOOL_NAMES).toContain("add_beat");
	});

	it("renders the prompt per content type, finish last", () => {
		for (const ct of ["video", "image", "text"] as const) {
			const lines = renderToolList(toolsForContentType(ct)).split("\n");
			expect(lines.some((l) => l.startsWith("ask_user"))).toBe(true);
			expect(lines[lines.length - 1].startsWith("finish")).toBe(true);
		}
	});

	it("keeps story planning out of the tool registry: it is the plan_story workflow definition", () => {
		const video = toolsForContentType("video").map((tool) => tool.name);
		expect(video).not.toContain("plan_story");
		expect(video).not.toContain("create_story_video");
		expect(video).toContain("generate_story_assets");
		// The superseded planners are deleted, not filtered — nothing to hide.
		for (const gone of [
			"plan_longform",
			"plan_video",
			"generate_video_assets",
			"update_blueprint_beat",
			"plan_explainer",
			"plan_product_video",
			"plan_tutorial",
			"plan_documentary",
			"plan_listicle",
			"plan_comparison",
		]) {
			expect(video).not.toContain(gone);
			expect(toolNamesForContentType("video")).not.toContain(gone);
			expect(toolByName.has(gone)).toBe(false);
		}
		// No registry tool proposes a plan: the planning definition is the only planner.
		expect(
			toolsForContentType("video")
				.filter((t) => t.proposes === "story_plan")
				.map((t) => t.name),
		).toEqual([]);
	});

	it("scopes tools by intent but always keeps core (grounding + terminal)", () => {
		const research = toolsForIntent("research", "video").map((t) => t.name);
		// Intent-specific tool present…
		expect(research).toContain("search_web");
		// …core grounding + terminal always available…
		expect(research).toContain("view_timeline");
		expect(research).toContain("ask_user");
		expect(research).toContain("finish");
		// …but an unrelated builder is scoped out.
		expect(research).not.toContain("add_scene");
	});

	it("migrated read-only tools dispatch from their ToolDef handler", async () => {
		const view = toolByName.get("view_timeline");
		expect(typeof view?.handler).toBe("function");
		// Runs off the job with no orchestrator closures — a minimal job stub is
		// enough (view_timeline reads scenes/overlays only).
		const job = {
			scenes: [],
			artifacts: [],
			textOverlays: [],
			videoOverlays: [],
			aspect: "9:16",
			brief: "",
		};
		const ctx = { job } as unknown as ToolContext;
		const res = await view!.handler!(ctx, {});
		expect(res.note).toContain("Timeline: 0 scenes");
	});

	it("every non-terminal tool has a ToolDef handler (execTool retired)", () => {
		const missing = TOOLS.filter(
			(t) => !t.handler && t.name !== "ask_user" && t.name !== "finish",
		).map((t) => t.name);
		expect(missing).toEqual([]);
	});

	it("classifies every tool into an effect kind", () => {
		for (const t of TOOLS)
			expect(["read", "mutate", "generate", "approve", "respond"]).toContain(t.kind);
		// Spot-check the taxonomy: mutate edits, generate makes assets, respond ends.
		expect(toolByName.get("update_scene")?.kind).toBe("mutate");
		expect(toolByName.get("generate_frame")?.kind).toBe("generate");
		expect(toolByName.get("finish")?.kind).toBe("respond");
	});

	it("edit_element surfaces index-guarded edits, not planning", () => {
		const edit = toolsForIntent("edit_element", "video").map((t) => t.name);
		expect(edit).toContain("update_scene");
		expect(edit).toContain("remove_scene");
		expect(edit).not.toContain("plan_story");
	});
});
