/* The suspended tool outcome: a tool result that says "I have not finished".
 *
 * It is API-local — `toolResultSchema` + `ToolResult` + the trace envelope — and
 * deliberately additive: an ordinary tool result carries no such flag and is
 * unchanged in shape, note, effect and trace events. These tests pin both halves,
 * because the loop branch built on top (reactExecuteTool holding its cursor) is
 * only safe if a normal tool can never accidentally look suspended. */
import { describe, expect, test } from "bun:test";
import { emitToolCall } from "./trace.ts";
import { toolResultSchema } from "./helpers/schemas.ts";
import type { AgentJob } from "./model.ts";

function job(): AgentJob {
	return {
		id: "run-1",
		projectId: "project-1",
		contentType: "video",
		status: "running",
		events: [],
		scenes: [],
		textOverlays: [],
		infographicOverlays: [],
		videoOverlays: [],
		audioOverlays: [],
		characters: [],
		artifacts: [],
		aspect: "9:16",
		brief: "a brief",
		startedAt: 100,
	};
}

describe("the suspended flag on a tool result", () => {
	test("validates only as the literal true, so a truthy accident is rejected", () => {
		expect(toolResultSchema.safeParse({ note: "parked", suspended: true }).success).toBe(true);
		expect(toolResultSchema.safeParse({ note: "parked", suspended: false }).success).toBe(false);
		expect(toolResultSchema.safeParse({ note: "parked", suspended: "yes" }).success).toBe(false);
	});

	test("is absent from an ordinary tool result", () => {
		const parsed = toolResultSchema.parse({ note: "Added scene 1", effect: "patch" });
		expect(parsed.suspended).toBeUndefined();
		expect("suspended" in parsed).toBe(false);
	});
});

describe("tracing a suspended tool call", () => {
	test("the flag reaches the caller and the phase's note is still traced", async () => {
		const current = job();

		const result = await emitToolCall(current, "plan_story", { brief: "b" }, async () => ({
			note: "Researched 4 sources — one editorial choice needs your call.",
			effect: "await" as const,
			suspended: true as const,
		}));

		expect(result.suspended).toBe(true);
		expect(result.note).toContain("needs your call");
		// The envelope closes normally: the phase that ran is visible in the trace,
		// rather than a tool that appears to have vanished mid-call.
		const started = current.events.find((event) => event.kind === "tool_call_started");
		const completed = current.events.find((event) => event.kind === "tool_call_completed");
		expect(started).toMatchObject({ tool: "plan_story" });
		expect(completed).toMatchObject({ tool: "plan_story", effect: "await" });
		// Parked is not failed.
		expect(completed && "errorInfo" in completed ? completed.errorInfo : undefined).toBeUndefined();
	});

	test("an ordinary tool call reports no suspension and keeps its own effect", async () => {
		const current = job();

		const result = await emitToolCall(current, "add_scene", { name: "Hook" }, async () => ({
			note: "Added scene 1",
			effect: "patch" as const,
		}));

		expect(result.suspended).toBeUndefined();
		expect(result.note).toBe("Added scene 1");
		expect(current.events.find((event) => event.kind === "tool_call_completed")).toMatchObject({
			effect: "patch",
		});
	});

	test("a throwing tool is an error, never a suspension", async () => {
		const current = job();

		const result = await emitToolCall(current, "plan_story", {}, async () => {
			throw new Error("provider down");
		});

		expect(result.suspended).toBeUndefined();
		expect(result.ok).toBe(false);
		expect(result.note).toBe("provider down");
	});
});
