/* The project's open blockers: what still stands in the way, and the answers to
 * it. A read of current state, so it works with no run in flight. */
import { getOrNull, post } from "./client.ts";
import { BASE } from "./base.ts";
import type { OpenBlocker, StoryClarificationBatch } from "@maleo/shared";

export interface BlockerState {
	blockers: OpenBlocker[];
	/** Left as is, and still true — the delivery check still counts these. */
	acknowledged: OpenBlocker[];
	batch: StoryClarificationBatch | null;
}

export interface BlockerAnswer {
	id: string;
	choice?: string;
	otherText?: string;
}

export interface BlockerResolution {
	ok: true;
	blockers: OpenBlocker[];
	/** What only a run can carry out — sent to chat as one instruction. */
	instructions: string[];
	/** Blockers whose remedy lives elsewhere in the app. */
	navigate: OpenBlocker[];
	failed: Array<{ id: string; message: string }>;
}

export async function getProjectBlockers(projectId: string): Promise<BlockerState | null> {
	return await getOrNull<BlockerState>(`${BASE}/projects/${projectId}/blockers`);
}

export async function resolveProjectBlockers(
	projectId: string,
	answers: BlockerAnswer[],
): Promise<BlockerResolution> {
	return await post<BlockerResolution>(`${BASE}/projects/${projectId}/blockers/resolve`, {
		answers,
	});
}
