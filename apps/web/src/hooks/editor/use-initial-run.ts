/* The one-time initial agent run, and retrying it.
 *
 * It fires exactly once per runKey. The ref guard is what makes that true under
 * React StrictMode's double-invoke and across a remount; the server dedups a
 * second running job for the same project as well, so this is belt and braces
 * for a run that costs real money.
 *
 * Success is decided from the final job the run returns rather than from a
 * state read, which would race the ref-mirror effects. A non-"done" status or
 * an empty result is a failure the user can retry — even when partial content
 * was persisted.
 *
 * Retry re-fires the same instruction WITHOUT creating a new project: bumping
 * the runKey is the whole mechanism.
 *
 * Split out of `create-content.tsx`.
 */
import { useEffect, useRef } from "react";
import type { Dispatch, SetStateAction } from "react";
import { agentRunSucceeded } from "@models/core/cc-helpers.ts";
import type { ContentChat } from "./use-chat-session.ts";

export interface PendingInitialRun {
	runKey: number;
	instruction: string;
}

export interface InitialRunInput {
	pendingInitial: PendingInitialRun | null;
	setPendingInitial: Dispatch<SetStateAction<PendingInitialRun | null>>;
	projectId: string | null;
	chat: ContentChat;
	setAgentFailed: Dispatch<SetStateAction<boolean>>;
	/** Used when there is no pending run to re-fire — the brief starts one. */
	generateStoryboardFromBrief: () => Promise<void>;
}

export interface InitialRun {
	retryInitial: () => void;
	/** Reset by the flow's own reset, so a new project can run again. */
	lastInitKey: React.MutableRefObject<number>;
}

export function useInitialRun({
	pendingInitial,
	setPendingInitial,
	projectId,
	chat,
	setAgentFailed,
	generateStoryboardFromBrief,
}: InitialRunInput): InitialRun {
	// Fire the one-time initial run exactly once per runKey. runKey guards against
	// React StrictMode double-invoke / remount; the server also dedups a second
	// running job for the same project.
	const lastInitKey = useRef<number>(-1);
	useEffect(() => {
		if (!pendingInitial) return;
		if (lastInitKey.current === pendingInitial.runKey) return;
		lastInitKey.current = pendingInitial.runKey;
		const instruction = pendingInitial.instruction;
		void chat.start(instruction).then((job) => {
			// Decide success from the final job the run returns — not a state read that
			// races the ref-mirror effects. A non-"done" status (error) or empty result
			// is a failure the user can retry, even if partial content was persisted.
			if (!agentRunSucceeded(job)) setAgentFailed(true);
		});
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [pendingInitial, projectId]);

	// Retry: re-fire the same initial instruction WITHOUT creating a new project.
	const retryInitial = (): void => {
		setAgentFailed(false);
		if (!pendingInitial) {
			void generateStoryboardFromBrief();
			return;
		}
		setPendingInitial({
			runKey: pendingInitial.runKey + 1,
			instruction: pendingInitial.instruction,
		});
	};
	return { retryInitial, lastInitKey };
}
