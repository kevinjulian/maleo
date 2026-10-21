/* The agent run loop: start a run, poll it, answer its questions, resume or cancel
 * it, and re-attach to one already in flight after a reload. */
import { get, getOrNull, post } from "./client.ts";
import type { ChatAgentContext } from "@models/agent/agent-context.ts";
// Re-exported so this module stays the import site its consumers already use.
export type { ChatAgentContext };
import type {
	ChatContextEnvelope,
	CaptionSet,
	ContentType,
	StoryClarificationSubmission,
} from "@maleo/shared";
import { BASE } from "./base.ts";
import type {
	AgentJobScene,
	AgentJobState,
	AgentPostOut,
	AgentSlideOut,
} from "@models/agent/agent-wire.ts";

// Structured setup context — passed alongside the brief so the agent gets the
// wizard choices as real fields, not appended fake user prose.

/* What a chat command sends.
 *
 * Two parts, deliberately. The DOCUMENT — scenes, slides, posts, clips — is what
 * the run edits, and it belongs in the request proper. The CONTEXT — brief,
 * direction, materials, and the project's shape and voice settings — is what the
 * run is governed by, and it lives inside the envelope, where one schema
 * validates the whole combination.
 *
 * Those settings used to be eleven loose top-level fields plus a `context` bag.
 * Nothing checked them together, so what a run had been told was discoverable
 * only by reading the call site that sent it. */
export interface StartChatAgentInput {
	projectId: string;
	instruction: string;
	contentType: ContentType;
	scenes?: AgentJobScene[];
	slides?: AgentSlideOut[];
	posts?: AgentPostOut[];
	clips?: unknown[];
	captionSet?: CaptionSet;
	/** Resolved server-side against the project's own entities. */
	styleImageUrl?: string;
	envelope?: ChatContextEnvelope;
}

// Start a server-side agent run; returns a job id to poll.
export async function startChatAgent(input: StartChatAgentInput): Promise<{ jobId: string }> {
	return post<{ jobId: string }>(`${BASE}/projects/${input.projectId}/chat`, {
		instruction: input.instruction,
		content_type: input.contentType,
		scenes: input.scenes ?? [],
		slides: input.slides,
		posts: input.posts,
		clips: input.clips,
		captionSet: input.captionSet,
		style_image_url: input.styleImageUrl,
		envelope: input.envelope,
	});
}

export async function pollChatAgent(projectId: string, jobId: string): Promise<AgentJobState> {
	return get<AgentJobState>(`${BASE}/projects/${projectId}/chat/${jobId}`);
}

// Resume a run interrupted by a server/Inngest restart — re-drives it from the
// persisted cursor. For interrupted (error) or orphaned-running runs; a run
// parked on a question resumes via answerChatAgent instead.
export async function resumeChatRun(
	projectId: string,
	jobId: string,
): Promise<{ jobId: string; status: string }> {
	return post<{ jobId: string; status: string }>(
		`${BASE}/projects/${projectId}/chat/${jobId}/resume`,
	);
}

/* Answer an ask_user question — resumes the suspended run with the user's reply.
 *
 * `batchAnswer` is the structured submission a pre-research clarification card
 * sends. It travels beside the string, not instead of it: every other gate still
 * answers with text, and the server validates a batch submission before it
 * releases anything. */
export async function answerChatAgent(
	projectId: string,
	jobId: string,
	answer: string,
	actionId?: string,
	batchAnswer?: StoryClarificationSubmission,
): Promise<{ jobId: string }> {
	return post<{ jobId: string }>(`${BASE}/projects/${projectId}/chat/${jobId}/answer`, {
		answer,
		action_id: actionId,
		batch_answer: batchAnswer,
	});
}

export async function cancelChatRun(
	projectId: string,
	jobId: string,
): Promise<{ jobId: string; status: string }> {
	return post<{ jobId: string; status: string }>(
		`${BASE}/projects/${projectId}/chat/${jobId}/cancel`,
	);
}

// Resume a run after reload: the project's current running job (if any), so a
// reload during generation re-attaches to the same run instead of starting a
// second one. Returns null when nothing is running.
// A server error is NOT an answer to "is a run already in flight?". This used to
// return null for any failed response, which reads as "nothing is running" and
// invites the caller to start a second run; `getOrNull` reserves null for 404.
export async function getCurrentChatJob(
	projectId: string,
): Promise<(AgentJobState & { jobId: string }) | null> {
	const data = await getOrNull<{ job: null } | (AgentJobState & { jobId: string })>(
		`${BASE}/projects/${projectId}/chat`,
	);
	if (!data || (data as { job?: null }).job === null) return null;
	return data as AgentJobState & { jobId: string };
}
