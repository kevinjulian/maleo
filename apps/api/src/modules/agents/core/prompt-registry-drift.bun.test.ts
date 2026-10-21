/* The agent's instructions name tools; a renamed or retired tool left in the prose
 * sends the model after a tool it is not offered. This pins every tool name the
 * instructions mention, per content type, to the tools the agent actually gets:
 * its registry tools, its workflows (`workflow-<id>`) and ask_user. */
import { describe, expect, it } from "bun:test";
import { RequestContext } from "@mastra/core/request-context";
import { agentTools } from "./runtime/tools/registry-tools.ts";
import { agentWorkflowsFor, definitionToolsFor } from "./runtime/agent.ts";
import { instructionsFor } from "./runtime/instructions.ts";
import type { AgentRunContext } from "./runtime/tools/registry-tools.ts";
import type { ContentType } from "./types.ts";

/** Every tool-shaped token in the prose: snake_case, or a workflow's `workflow-<id>`. */
function toolNamesMentionedIn(prose: string): string[] {
	return [...new Set(prose.match(/\bworkflow-[a-z_]+\b|\b[a-z]+(?:_[a-z]+)+\b/g) ?? [])];
}

function offered(contentType: ContentType): Set<string> {
	const context = new RequestContext<AgentRunContext>([["contentType", contentType]]);
	return new Set([
		...Object.keys(agentTools(contentType)),
		...Object.keys(agentWorkflowsFor({ requestContext: context })).map((id) => `workflow-${id}`),
		...Object.keys(definitionToolsFor(context)),
		"ask_user",
	]);
}

describe("the agent's instructions and its tools agree", () => {
	for (const contentType of ["video"] as const) {
		it(`${contentType}: names only tools the agent is offered, and names some`, () => {
			const mentioned = toolNamesMentionedIn(instructionsFor(contentType)).filter(
				(name) => !["target_duration_sec"].includes(name),
			);
			expect(mentioned.length).toBeGreaterThan(3);
			expect(mentioned.filter((name) => !offered(contentType).has(name))).toEqual([]);
		});
	}

	it("routes new video planning and generation through their workflows", () => {
		const video = instructionsFor("video");
		expect(video).toContain("workflow-plan_story");
		expect(video).toContain("workflow-generate_story_assets");
		for (const gone of ["plan_video", "plan_longform", "generate_video_assets", "finish"])
			expect(video).not.toContain(gone);
	});
});
