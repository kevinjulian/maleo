import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createContentProject, setContentEditorState } from "@maleo/db/project-detail";
import { closeMaleoDb } from "@maleo/db/connection";
import { clearWorkflowRunsForTests, listWorkflowRunIds } from "@maleo/db/workflow-run-db";
import { addWorkspaceMember } from "@maleo/db/workspace-members";
import { DEFAULT_CONTENT_WORKSPACE } from "@maleo/db/schema";
import { setConfigSource } from "@maleo/shared/provider-config";
import type { Caller } from "@maleo/auth/session";
import type { AgentJob } from "../../modules/agents/core/model.ts";
import { operationsRoutes } from "../operations.ts";
import { testApp } from "../../middleware/auth-testing.ts";
import { setRunHostForTests } from "../../modules/agents/core/runtime/durable.ts";
import { clearAgentJobsForTests } from "../../modules/agents/core/session-store.ts";
import { loadRun, saveRun } from "../../modules/agents/core/run-repository.ts";
import {
	readTextProviderSelection,
	writeTextProviderSelection,
} from "../../lib/text-provider-settings.ts";
import { setTextProviderSelectionReader } from "../../lib/text-runner.ts";

const member: Caller = { userId: "selection-member", email: "member@example.com", role: "member" };
const app = testApp(operationsRoutes(), member);
const choice = { providerId: "api", model: "deepseek-flash" };
const started: AgentJob[] = [];
let values: Record<string, string>;
const endpoint = Bun.serve({
	port: 0,
	fetch: () => Response.json({ data: [{ id: "deepseek-flash" }, { id: "deepseek-v4-pro" }] }),
});

const post = (projectId: string, body: { text_selection?: unknown } = {}) =>
	app.request(`/projects/${projectId}/chat`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ instruction: "Keep this draft", ...body }),
	});
let projectId: string;
beforeEach(async () => {
	started.length = 0;
	await clearWorkflowRunsForTests();
	clearAgentJobsForTests();
	await addWorkspaceMember({
		workspace: DEFAULT_CONTENT_WORKSPACE,
		user_id: member.userId,
		role: "owner",
	});
	projectId = (await createContentProject({ title: "Selection", type: "video" })).project.id;
	values = {
		MALEO_AI_API_BASE_URL: `http://127.0.0.1:${endpoint.port}/v1`,
		MALEO_AI_API_KEY: "private-credential",
	};
	setConfigSource({ resolve: (key) => values[key] });
	await writeTextProviderSelection({ providerId: "api", model: "gpt-5.5" });
	setTextProviderSelectionReader(readTextProviderSelection);
	setRunHostForTests({
		start: async (job) => {
			started.push(job);
		},
		resume: async (job) => {
			started.push(job);
		},
	});
});
afterEach(async () => {
	setRunHostForTests(undefined);
	setTextProviderSelectionReader(() => ({}));
	setConfigSource(null);
	await writeTextProviderSelection(null);
});
afterAll(async () => {
	await endpoint.stop(true);
	await closeMaleoDb();
});

describe("chat selection boundary", () => {
	test("parked answer preserves capture after default change and refuses changed endpoint before clearing action", async () => {
		const { jobId } = await (await post(projectId, { text_selection: choice })).json();
		const job = (await loadRun(jobId))!;
		job.status = "awaiting_input";
		job.pendingActionId = "parked-action";
		job.pendingQuestion = { question: "Continue?" };
		await saveRun(job);
		clearAgentJobsForTests();
		await writeTextProviderSelection({ ...choice, model: "deepseek-v4-pro" });
		const originalUrl = values.MALEO_AI_API_BASE_URL;
		values.MALEO_AI_API_BASE_URL += "/changed";
		const answer = () =>
			app.request(`/projects/${projectId}/chat/${jobId}/answer`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ answer: "yes", action_id: "parked-action" }),
			});
		expect((await answer()).status).toBe(400);
		expect((await loadRun(jobId))?.pendingActionId).toBe("parked-action");
		values.MALEO_AI_API_BASE_URL = originalUrl;
		expect((await answer()).status).toBe(202);
		expect((await loadRun(jobId))?.textSelection?.selection).toEqual(choice);
	});
	test("member selection overrides stale application default without changing settings", async () => {
		const response = await post(projectId, { text_selection: choice });
		expect(response.status).toBe(202);
		const { jobId } = await response.json();
		const stored = await loadRun(jobId);
		expect(stored?.textSelection?.selection).toEqual(choice);
		expect(await readTextProviderSelection()).toEqual({
			default: { providerId: "api", model: "gpt-5.5" },
		});
	});
	test("omitted selection uses conversation before application default", async () => {
		await setContentEditorState(projectId, { chatModelSelection: choice });
		const response = await post(projectId);
		expect(response.status).toBe(202);
		const { jobId } = await response.json();
		expect((await loadRun(jobId))?.textSelection?.selection).toEqual(choice);
	});
	test("legacy request without preference uses valid application selection", async () => {
		await writeTextProviderSelection(choice);
		const response = await post(projectId);
		expect(response.status).toBe(202);
		expect((await loadRun((await response.json()).jobId))?.textSelection?.selection).toEqual(
			choice,
		);
	});
	test.each([
		undefined,
		{ providerId: "api", model: "stale-model" },
		{ ...choice, thinking: "max" },
		{ providerId: "unknown", model: "deepseek-flash" },
		{ ...choice, apiKey: "secret" },
		{ ...choice, model: "bad model" },
		{ ...choice, thinking: "invalid" },
	])("rejects unavailable or malformed selection %j before effects", async (text_selection) => {
		const response = await post(projectId, { text_selection });
		expect(response.status).toBe(400);
		expect(await listWorkflowRunIds(projectId)).toEqual([]);
		expect(started).toEqual([]);
	});
	test("explicit selection can repair invalid stored preference", async () => {
		await setContentEditorState(projectId, {
			chatModelSelection: { providerId: "api", model: "stale-model" },
		});
		expect((await post(projectId)).status).toBe(400);
		expect((await post(projectId, { text_selection: choice })).status).toBe(202);
	});
	test("capture survives reload, duplicate start and safe polling/history", async () => {
		const { jobId } = await (await post(projectId, { text_selection: choice })).json();
		const capture = (await loadRun(jobId))?.textSelection;
		expect(capture?.endpointIdentity).toMatch(/^[a-f0-9]{64}$/);
		clearAgentJobsForTests();
		expect((await loadRun(jobId))?.textSelection).toEqual(capture);
		const duplicate = await post(projectId, {
			text_selection: { ...choice, model: "deepseek-v4-pro" },
		});
		expect((await duplicate.json()).jobId).toBe(jobId);
		expect((await loadRun(jobId))?.textSelection).toEqual(capture);
		for (const path of [`/chat/${jobId}`, "/chat", "/runs", `/runs/${jobId}`]) {
			const response = await app.request(`/projects/${projectId}${path}`);
			expect(response.status).toBe(200);
			const body = await response.json();
			expect(
				body.textSelection ?? body.run?.textSelection ?? body.runs?.[0]?.textSelection,
			).toEqual(choice);
			expect(JSON.stringify(body)).not.toContain("private-credential");
			expect(JSON.stringify(body)).not.toContain(capture!.endpointIdentity);
		}
	});
});
