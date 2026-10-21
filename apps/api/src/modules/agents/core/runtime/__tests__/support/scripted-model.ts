/* A scripted model for agent tests: each model call returns the next scripted
 * turn, whether Mastra reads it through `doGenerate` or `doStream`. Tool order,
 * suspension and approvals are then deterministic, offline and free. */
import {
	MastraLanguageModelV2Mock,
	simulateReadableStream,
} from "@mastra/core/test-utils/llm-mock";

export const usage = { inputTokens: 10, outputTokens: 5, totalTokens: 15 };

/** The stream parts a scripted turn is made of. */
export type Part =
	| { type: "tool-call"; toolCallId: string; toolName: string; input: string }
	| { type: "text-start" | "text-end"; id: string }
	| { type: "text-delta"; id: string; delta: string }
	| { type: "finish"; finishReason: "stop" | "tool-calls"; usage: typeof usage };

/** One model turn, as a provider would return it: whole content for
 *  `doGenerate`, stream parts for `doStream`. */
export function turn(parts: Part[]) {
	const finish = parts.find((part) => part.type === "finish");
	const text = parts.flatMap((part) => (part.type === "text-delta" ? [part.delta] : [])).join("");
	return {
		parts,
		content: [
			...parts.filter((part) => part.type === "tool-call"),
			...(text ? [{ type: "text", text }] : []),
		],
		finishReason: finish?.finishReason ?? "stop",
	};
}

/** A model that answers each call with the next scripted turn, whichever way
 *  Mastra asks. (The mock's own array form is off by one: it indexes after
 *  recording the call, so the first call would get the second turn.) */
export function scriptedModel(turns: Array<ReturnType<typeof turn>>) {
	let next = 0;
	const take = () => {
		const scripted = turns[next++];
		if (!scripted) throw new Error(`scripted model has no turn ${next}`);
		return scripted;
	};
	return new MastraLanguageModelV2Mock({
		doGenerate: async () => {
			const scripted = take();
			// SAFETY: a scripted turn carries exactly the fields Mastra reads from a V2 generate result.
			return {
				content: scripted.content,
				finishReason: scripted.finishReason,
				usage,
				warnings: [],
			} as never;
		},
		// SAFETY: the scripted parts are V2 stream parts, preceded by the stream-start a provider emits.
		doStream: async () =>
			({
				stream: simulateReadableStream({
					chunks: [{ type: "stream-start", warnings: [] }, ...take().parts],
				}),
			}) as never,
	});
}

/** A turn that calls one tool. */
export const callTool = (toolName: string, input: unknown, toolCallId = `call-${toolName}`) =>
	turn([
		{ type: "tool-call", toolCallId, toolName, input: JSON.stringify(input) },
		{ type: "finish", finishReason: "tool-calls", usage },
	]);

/** A turn that answers with text. */
export const answer = (text: string) =>
	turn([
		{ type: "text-start", id: "t" },
		{ type: "text-delta", id: "t", delta: text },
		{ type: "text-end", id: "t" },
		{ type: "finish", finishReason: "stop", usage },
	]);
