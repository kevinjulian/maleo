import { textSelectionSchema, type TextSelection, type CapturedTextSelection } from "@maleo/shared";
import { textEndpointIdentity } from "../../../lib/ai-provider/providers/api/discovery.ts";
import { selectReadyProvider } from "../../../lib/ai-provider/index.ts";
import { currentTextSelection } from "../../../lib/text-runner.ts";

/** Resolve only new submissions. Existing runs retain their captured choice. */
export async function resolveChatTextSelection(
	submitted?: TextSelection,
	conversation?: unknown,
): Promise<CapturedTextSelection> {
	const preference =
		submitted || conversation === undefined || conversation === null
			? undefined
			: textSelectionSchema.parse(conversation);
	const choice = submitted ?? preference ?? (await currentTextSelection()).default;
	const decision = await selectReadyProvider("text", choice ? { default: choice } : {});
	if (decision.provider.meta.id !== "api") {
		throw new Error("Choose a configured API-backed text model before sending.");
	}
	return {
		selection: textSelectionSchema.parse(decision.choice),
		endpointIdentity: textEndpointIdentity(),
	};
}
