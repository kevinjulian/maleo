/* Durability of engine runs: a node interrupted after its billed model call but
 * before its checkpoint is charged once when retried, checkpointed nodes are not
 * repeated, and a suspended run resumes on the definition snapshot it started on. */
import { afterAll, afterEach, beforeEach, expect, test } from "bun:test";
import { z } from "zod";
import type { WorkflowDefinition } from "@maleo/shared";
import { closeMaleoDb } from "@maleo/db/connection";
import { listUsageRecords } from "../../../../lib/credit-service.ts";
import { resetFake, setFakeScript } from "../../../../lib/ai-provider/providers/fake/index.ts";
import { runPrompt, setTextProviderSelectionReader } from "../../../../lib/text-runner.ts";
import { directionRouterRequest } from "../../../../lib/content-generator.ts";
import type { AgentJob } from "../model.ts";
import { runFlow, startRecord, type EngineHost } from "./engine.ts";
import type { FlowRecord } from "./flow-record.ts";
import { createEngineRegistry, type EngineRegistry } from "./registry.ts";
import { defineOperation } from "./types.ts";

const ran: string[] = [];
const plain = (id: string) =>
	defineOperation({
		id,
		description: id,
		input: z.object({}),
		output: z.unknown(),
		prompts: [],
		tools: [],
		capabilities: [],
		run: async () => {
			ran.push(id);
			return { id };
		},
	});
const billed = defineOperation({
	id: "op.billed",
	description: "One metered model call.",
	input: z.object({}),
	output: z.object({ text: z.string() }),
	prompts: ["prompt:content:directionRouterPrompt"],
	tools: [],
	capabilities: ["llm:text"],
	run: async () => {
		ran.push("op.billed");
		return { text: (await runPrompt(directionRouterRequest("durability probe"))).stdout };
	},
});
const operations = [
	plain("op.frame"),
	billed,
	plain("op.after"),
	plain("op.ask"),
	plain("op.answer"),
	plain("op.new"),
];

const registryOf = (definitions: WorkflowDefinition[]): EngineRegistry =>
	createEngineRegistry({ definitions, operations, facts: [], rules: [], contracts: [] });
const step = (id: string, op: string) => ({
	type: "step" as const,
	id,
	op,
	...(op === "op.billed" ? { prompts: ["prompt:content:directionRouterPrompt"] } : {}),
});

function host(
	registry: EngineRegistry,
	save: (record: FlowRecord) => Promise<void>,
	over: Partial<EngineHost> = {},
): EngineHost {
	// SAFETY: the engine reads only id and pendingActionId of the job; these operations ignore it.
	return {
		registry,
		job: { id: "run-durable" } as AgentJob,
		toolCallId: "call-1",
		executionId: "exec-durable",
		save,
		cancelled: async () => false,
		...over,
	};
}

async function llmRows() {
	return (await listUsageRecords()).filter((record) => record.operation === "llm");
}

beforeEach(() => {
	resetFake();
	ran.length = 0;
	setTextProviderSelectionReader(() => ({ default: { providerId: "fake", model: "fake-1" } }));
	setFakeScript([{ when: (prompt) => prompt.includes("durability probe"), reply: "drafted" }]);
});
afterEach(() => {
	resetFake();
	setTextProviderSelectionReader(() => ({}));
});
afterAll(closeMaleoDb);

test("a node killed after its billed call and before its checkpoint is charged once and checkpointed nodes do not repeat", async () => {
	const registry = registryOf([
		{
			id: "w",
			root: {
				type: "sequence",
				id: "root",
				steps: [step("frame", "op.frame"), step("draft", "op.billed"), step("after", "op.after")],
			},
		},
	]);
	let saved = startRecord(registry, "w", {});
	const before = (await llmRows()).length;
	// The process dies on the save that would checkpoint the billed node.
	await expect(
		runFlow(
			host(registry, async (record) => {
				if (record.done.includes("draft")) throw new Error("process died before the checkpoint");
				saved = record;
			}),
			saved,
		),
	).rejects.toThrow("process died");
	expect(saved.done).toEqual(["frame"]);
	expect(ran).toEqual(["op.frame", "op.billed"]);

	// The durable host retries the tool call from the last saved record.
	const result = await runFlow(
		host(registry, async (record) => {
			saved = record;
		}),
		saved,
	);
	expect(result.status).toBe("completed");
	expect(ran).toEqual(["op.frame", "op.billed", "op.billed", "op.after"]);
	expect((await llmRows()).length - before).toBe(1);
});

test("a suspended run resumes on its snapshot after the registry definition changes; a new run uses the new revision", async () => {
	const original: WorkflowDefinition = {
		id: "w",
		root: {
			type: "sequence",
			id: "root",
			steps: [
				{ type: "suspend", id: "ask", kind: "questions", ask: "op.ask", onAnswer: "op.answer" },
				step("after", "op.after"),
			],
		},
	};
	const v1 = registryOf([original]);
	let saved = startRecord(v1, "w", {});
	expect(
		(
			await runFlow(
				host(v1, async (record) => {
					saved = record;
				}),
				saved,
			)
		).status,
	).toBe("suspended");

	const changed: WorkflowDefinition = {
		id: "w",
		root: {
			type: "sequence",
			id: "root",
			steps: [
				{ type: "suspend", id: "ask", kind: "questions", ask: "op.ask", onAnswer: "op.answer" },
				step("inserted", "op.new"),
				step("after", "op.after"),
			],
		},
	};
	const v2 = registryOf([changed]);
	expect(v2.get("w")!.revision).not.toBe(saved.revision);
	ran.length = 0;
	const resumed = await runFlow(
		host(
			v2,
			async (record) => {
				saved = record;
			},
			{ answer: "yes" },
		),
		saved,
	);
	expect(resumed.status).toBe("completed");
	expect(ran).toEqual(["op.answer", "op.after"]);
	expect(saved.revision).toBe(v1.get("w")!.revision);
	expect(startRecord(v2, "w", {}).revision).toBe(v2.get("w")!.revision);
});
