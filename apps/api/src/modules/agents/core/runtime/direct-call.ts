/* A single-tool run's model (expose-direct-mcp-tools).
 *
 * An MCP client that knows the exact edit asks for one registry tool call. It
 * runs as an ordinary agent run in the project chat — the same tools, the same
 * preconditions and approval suspension, the same generation identity, metering,
 * settlement and durable host — whose model is this: it calls the given tool once
 * and answers with the tool's result. Nothing is decided by a model, and nothing
 * here can call another tool.
 *
 * The call lives on the run record (`run.directCall`), so a run resumed on another
 * worker after an approval gets the same model. */
import type { RequestContext } from "@mastra/core/request-context";
import { z } from "zod";
import { getAgentJob } from "../session-store.ts";
import type { ToolArgs } from "../types.ts";
import type { AgentRunContext } from "./tools/registry-tools.ts";

/** One registry tool call, as the client asked for it. */
export interface DirectCall {
	tool: string;
	args: ToolArgs;
	/** Stable for the run, so a durable retry keys the call's generations alike. */
	callId: string;
}

const usage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };

const toolMessage = z.object({ role: z.literal("tool"), content: z.array(z.unknown()) });
const toolResult = z.object({
	type: z.literal("tool-result"),
	toolCallId: z.string(),
	output: z.object({ value: z.unknown() }).optional(),
});
const noted = z.object({ note: z.string() });

/** The tool's answer to this call in the conversation so far, if it has answered. */
function resultOf(prompt: unknown, callId: string): string | undefined {
	const messages = z.array(z.unknown()).safeParse(prompt);
	for (const message of messages.success ? messages.data : []) {
		const tool = toolMessage.safeParse(message);
		for (const part of tool.success ? tool.data.content : []) {
			const result = toolResult.safeParse(part);
			if (!result.success || result.data.toolCallId !== callId) continue;
			const value = result.data.output?.value;
			const note = noted.safeParse(value);
			if (note.success) return note.data.note;
			return typeof value === "string" ? value : JSON.stringify(value ?? null);
		}
	}
	return undefined;
}

type Part =
	| { type: "stream-start"; warnings: [] }
	| { type: "tool-call"; toolCallId: string; toolName: string; input: string }
	| { type: "text-start" | "text-end"; id: string }
	| { type: "text-delta"; id: string; delta: string }
	| { type: "finish"; finishReason: "stop" | "tool-calls"; usage: typeof usage };

interface Turn {
	parts: Part[];
	text?: string;
}

function turn(call: DirectCall, prompt: unknown): Turn {
	const answered = resultOf(prompt, call.callId);
	if (answered === undefined) {
		return {
			parts: [
				{
					type: "tool-call",
					toolCallId: call.callId,
					toolName: call.tool,
					input: JSON.stringify(call.args),
				},
				{ type: "finish", finishReason: "tool-calls", usage },
			],
		};
	}
	return {
		text: answered,
		parts: [
			{ type: "text-start", id: "t" },
			{ type: "text-delta", id: "t", delta: answered },
			{ type: "text-end", id: "t" },
			{ type: "finish", finishReason: "stop", usage },
		],
	};
}

/** A language model (AI SDK v2 shape) that makes exactly the given call, then reports its result. */
export function directCallModel(call: DirectCall) {
	return {
		specificationVersion: "v2" as const,
		provider: "maleo-direct",
		modelId: "direct-call",
		supportedUrls: {},
		async doGenerate(options: { prompt: unknown }) {
			const { parts, text } = turn(call, options.prompt);
			const toolCalls = parts.filter((part) => part.type === "tool-call");
			return {
				content: [...toolCalls, ...(text ? [{ type: "text" as const, text }] : [])],
				finishReason: text ? ("stop" as const) : ("tool-calls" as const),
				usage,
				warnings: [],
			};
		},
		async doStream(options: { prompt: unknown }) {
			const { parts } = turn(call, options.prompt);
			const all: Part[] = [{ type: "stream-start", warnings: [] }, ...parts];
			return {
				stream: new ReadableStream<Part>({
					start(controller) {
						for (const part of all) controller.enqueue(part);
						controller.close();
					},
				}),
			};
		},
	};
}

/** The run's direct call, when it is a single-tool run. */
export async function directCallFor(
	requestContext: RequestContext<AgentRunContext> | undefined,
): Promise<DirectCall | undefined> {
	const runId = requestContext?.get("runId");
	if (!runId) return undefined;
	return (await getAgentJob(runId))?.run?.directCall;
}
