import { afterEach, beforeEach, describe, expect, test } from "vite-plus/test";
import { loadStoryboardAuthoring, submitStoryboardCommand } from "./storyboard-authoring.ts";

const realFetch = globalThis.fetch;
let reply: () => Response;
let calls: Array<{ url: string; init?: RequestInit }> = [];

const state = {
	planId: "plan-a",
	draft: {
		revisionId: "rev-a",
		sections: [
			{
				id: "section-a",
				title: "Opening",
				beats: [{ id: "beat-a", title: "Hook", narration: "Words", visualPrompt: "Wide" }],
			},
		],
	},
};
const generatedByBeatId = {
	"beat-a": [{ semanticBeatId: "beat-a", imageUrls: ["generated.png"] }],
};

function response(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json" },
	});
}

beforeEach(() => {
	calls = [];
	reply = () => response({ state, legacy: false, generatedByBeatId });
	globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
		calls.push({ url: String(input), init });
		return Promise.resolve(reply());
	}) as typeof fetch;
});

afterEach(() => {
	globalThis.fetch = realFetch;
});

describe("storyboard authoring client", () => {
	test("decodes current snapshot", async () => {
		expect(await loadStoryboardAuthoring("project-a")).toEqual({
			state,
			legacy: false,
			generatedByBeatId,
			references: {},
		});
		expect(calls[0]?.url).toContain("/api/operations/projects/project-a/storyboard-authoring");
	});

	test("decodes successful command response", async () => {
		reply = () =>
			response(
				{
					ok: true,
					state: { ...state, draft: { ...state.draft, revisionId: "rev-b" } },
					legacy: false,
					generatedByBeatId,
				},
				201,
			);
		const result = await submitStoryboardCommand("project-a", "rev-a", {
			type: "lock_beat",
			beatId: "beat-a",
		});
		expect(result).toMatchObject({ ok: true, state: { draft: { revisionId: "rev-b" } } });
		expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({
			expectedRevisionId: "rev-a",
			command: { type: "lock_beat", beatId: "beat-a" },
		});
	});

	test("returns typed conflict instead of throwing", async () => {
		reply = () =>
			response(
				{
					ok: false,
					reason: "conflict",
					message: "reload",
					state,
					legacy: false,
					generatedByBeatId,
				},
				409,
			);
		expect(
			await submitStoryboardCommand("project-a", "old", { type: "lock_beat", beatId: "beat-a" }),
		).toMatchObject({ ok: false, reason: "conflict", state: { draft: { revisionId: "rev-a" } } });
	});
});
