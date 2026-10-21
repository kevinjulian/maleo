import { describe, expect, it } from "bun:test";
import { buildAgentTrace } from "./agent-trace.ts";
import type { ContentProjectEventRow } from "@maleo/db/events";

function ev(
	partial: Partial<ContentProjectEventRow> & { kind: string; created_at: number },
): ContentProjectEventRow {
	return {
		id: `e-${partial.created_at}`,
		project_id: "p1",
		output_id: null,
		storyboard_id: null,
		actor_type: "agent",
		actor_id: "chat-agent",
		summary: "",
		payload_json: null,
		...partial,
	};
}

describe("buildAgentTrace", () => {
	it("groups events into runs with chronological tool calls", () => {
		// listContentProjectEvents returns DESC — newest first.
		const events: ContentProjectEventRow[] = [
			ev({
				kind: "agent.session_ended",
				created_at: 400,
				payload_json: { job_id: "job-A", status: "done" },
			}),
			ev({
				kind: "agent.tool_call",
				created_at: 300,
				payload_json: {
					job_id: "job-A",
					tool: "generate_frame",
					ok: true,
					duration_ms: 1200,
					tool_call_id: "tc-2",
					args: { index: 1 },
					result: "frame ok",
				},
			}),
			ev({
				kind: "agent.tool_call",
				created_at: 200,
				payload_json: {
					job_id: "job-A",
					tool: "add_scene",
					ok: true,
					duration_ms: 5,
					tool_call_id: "tc-1",
					args: { name: "Opening" },
					result: "added",
				},
			}),
			ev({
				kind: "agent.session_started",
				created_at: 100,
				payload_json: {
					job_id: "job-A",
					content_type: "video",
					instruction: "build a scene",
					status: "running",
				},
			}),
		];
		const sessions = buildAgentTrace(events);
		expect(sessions.length).toBe(1);
		const s = sessions[0]!;
		expect(s.jobId).toBe("job-A");
		expect(s.instruction).toBe("build a scene");
		expect(s.contentType).toBe("video");
		expect(s.status).toBe("done");
		expect(s.startedAt).toBe(100);
		expect(s.endedAt).toBe(400);
		// Chronological within the run, stable ids preserved.
		expect(s.toolCalls.map((t) => t.id)).toEqual(["tc-1", "tc-2"]);
		expect(s.toolCalls.map((t) => t.tool)).toEqual(["add_scene", "generate_frame"]);
		expect(s.toolCalls[1]!.durationMs).toBe(1200);
	});

	it("orders multiple runs newest-first and ignores non-agent / job-less events", () => {
		const events: ContentProjectEventRow[] = [
			ev({
				kind: "agent.session_started",
				created_at: 1000,
				payload_json: { job_id: "job-new", instruction: "second" },
			}),
			ev({ kind: "publish.completed", created_at: 900, payload_json: { platform: "x" } }), // ignored
			ev({ kind: "agent.tool_call", created_at: 50, payload_json: { tool: "add_scene" } }), // no job_id → ignored
			ev({
				kind: "agent.session_started",
				created_at: 10,
				payload_json: { job_id: "job-old", instruction: "first" },
			}),
		];
		const sessions = buildAgentTrace(events);
		expect(sessions.map((s) => s.jobId)).toEqual(["job-new", "job-old"]);
		expect(sessions.every((s) => s.toolCalls.length === 0)).toBe(true);
	});

	it("attaches assets to their producing tool call and surfaces approvals", () => {
		// DESC order: asset folded before its parent tool_call; approval present.
		const events: ContentProjectEventRow[] = [
			ev({
				kind: "agent.asset",
				created_at: 320,
				payload_json: {
					job_id: "job-A",
					tool_call_id: "tc-1",
					asset_type: "image",
					url: "/uploads/a.png",
					ref: "scene:1",
					prompt: "wide shot",
					model: "image-service",
				},
			}),
			ev({
				kind: "agent.tool_call",
				created_at: 300,
				payload_json: {
					job_id: "job-A",
					tool: "generate_frame",
					ok: true,
					tool_call_id: "tc-1",
					args: { index: 0 },
					result: "ok",
				},
			}),
			ev({
				kind: "agent.approval",
				actor_type: "operator",
				created_at: 250,
				payload_json: { job_id: "job-A", target: "story_plan" },
			}),
			ev({
				kind: "agent.session_started",
				created_at: 100,
				payload_json: { job_id: "job-A", instruction: "make it" },
			}),
		];
		const [s] = buildAgentTrace(events);
		expect(s!.approvals.map((a) => a.target)).toEqual(["story_plan"]);
		const frame = s!.toolCalls.find((t) => t.tool === "generate_frame")!;
		expect(frame.assets.length).toBe(1);
		expect(frame.assets[0]!.url).toBe("/uploads/a.png");
		expect(frame.assets[0]!.ref).toBe("scene:1");
		expect(frame.assets[0]!.prompt).toBe("wide shot");
	});

	it("falls back to first tool-call time when no session_started exists", () => {
		const events: ContentProjectEventRow[] = [
			ev({
				kind: "agent.tool_call",
				created_at: 70,
				payload_json: {
					job_id: "job-x",
					tool: "build_text",
					ok: false,
					duration_ms: 3,
					result: "boom",
				},
			}),
		];
		const sessions = buildAgentTrace(events);
		expect(sessions[0]!.startedAt).toBe(70);
		expect(sessions[0]!.toolCalls[0]!.ok).toBe(false);
	});
});
