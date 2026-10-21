import { describe, expect, it } from "vite-plus/test";
import { agentRunSucceeded, logicalRefId, renderButtonIntent } from "./create-content.tsx";
import type { AgentJobState } from "@models/agent/agent-wire.ts";

describe("agentRunSucceeded", () => {
	const base = {
		events: [],
		scenes: [],
		slides: [],
		posts: [],
		textOverlays: [],
		videoOverlays: [],
		audioOverlays: [],
		characters: [],
		artifacts: [],
		error: null,
	} as unknown as AgentJobState;
	it("null run is a failure", () => {
		expect(agentRunSucceeded(null)).toBe(false);
	});
	it("done + content succeeds", () => {
		expect(
			agentRunSucceeded({ ...base, status: "done", slides: [{ caption: "c", visual: "v" }] }),
		).toBe(true);
	});
	it("done but empty is a failure", () => {
		expect(agentRunSucceeded({ ...base, status: "done" })).toBe(false);
	});
	it("error WITH partial content is still a failure", () => {
		expect(
			agentRunSucceeded({ ...base, status: "error", slides: [{ caption: "c", visual: "v" }] }),
		).toBe(false);
	});
});

describe("create-content render button intent", () => {
	it("opens confirm modal before render starts", () => {
		expect(renderButtonIntent(false)).toBe("confirm");
	});

	it("opens status modal while render is in progress", () => {
		expect(renderButtonIntent(true)).toBe("status");
	});

	it("prefers logical reference id from meta when reloading project refs", () => {
		expect(logicalRefId({ id: "db-row-1", meta_json: { id: "library-img-1" } })).toBe(
			"library-img-1",
		);
		expect(logicalRefId({ id: "db-row-2", meta_json: null })).toBe("db-row-2");
	});
});
