/* Every open blocker, pinned above the composer, answered in one submit.
 *
 * Blockers used to hang off the run that reported them, and chat gives actions
 * only to its newest run — so answering one turned the card holding the rest into
 * history, and a failed run showed its blockers with no control at all. This card
 * is fed by current project state instead, which is why it survives a run
 * starting, finishing or failing.
 *
 * It is the clarification card, not a second widget: the batch contract already
 * holds N decisions, recommends one option each, and refuses a partial answer.
 * What differs is that this one does not park anything — the composer stays
 * usable while it is open, and every blocker carries "Leave as is". */
import { useState } from "react";
import type { JSX } from "react";
import { ClarificationCard } from "./chat-clarification-card.tsx";
import type {
	OpenBlocker,
	StoryClarificationBatch,
	StoryClarificationSubmission,
} from "@maleo/shared";
import type { BlockerAnswer, BlockerResolution } from "@api/blockers.ts";

export interface BlockerBatchProps {
	/** Absent once every blocker is answered — what was left as is is still said. */
	batch: StoryClarificationBatch | null;
	blockers: readonly OpenBlocker[];
	/** Left as is. Named because the delivery check still counts them, so the
	 *  score and this card would otherwise disagree with nothing to explain it. */
	acknowledged: readonly OpenBlocker[];
	busy: boolean;
	onResolve: (answers: BlockerAnswer[]) => Promise<BlockerResolution | null>;
	/** Run what only a run can do, as one instruction. */
	onRun: (instruction: string) => void;
}

/* Where an operator-only blocker is actually cleared.
 *
 * A link rather than a callback: the reference library is a route, and a plain
 * anchor reaches it from wherever chat is mounted without threading a navigate
 * handler through every host that renders this panel. */
const REFERENCES_PATH = "/library/references";

function answersOf(submission: StoryClarificationSubmission): BlockerAnswer[] {
	return (submission.answers ?? []).map((answer) => ({
		id: answer.questionId,
		choice: answer.optionId,
		otherText: answer.otherText,
	}));
}

export function BlockerBatch({
	batch,
	blockers,
	acknowledged,
	busy,
	onResolve,
	onRun,
}: BlockerBatchProps): JSX.Element {
	const [submitting, setSubmitting] = useState(false);
	const [failed, setFailed] = useState<string[]>([]);
	return (
		<section className="fc-pinned fc-blockers" aria-label="Open blockers" tabIndex={-1}>
			{batch && (
				<ClarificationCard
					batch={batch}
					locked={false}
					busy={busy || submitting}
					onSubmit={(submission) => {
						setSubmitting(true);
						setFailed([]);
						void onResolve(answersOf(submission))
							.then((result) => {
								if (!result) return;
								setFailed(result.failed.map((entry) => entry.message));
								// One instruction, so three answered blockers cost one run
								// rather than three.
								if (result.instructions.length) onRun(result.instructions.join(" "));
							})
							.finally(() => setSubmitting(false));
					}}
				/>
			)}
			{failed.map((message) => (
				<div key={message} className="fc-output-finding err">
					{message}
				</div>
			))}
			{acknowledged.length > 0 && (
				<div className="fc-output-muted">
					{acknowledged.length} left as {acknowledged.length === 1 ? "it is" : "they are"} — still
					counted by the delivery check, and back if{" "}
					{acknowledged.length === 1 ? "it changes" : "they change"}.
				</div>
			)}
			{blockers.some((blocker) => blocker.remedy?.kind === "navigate") && (
				<a className="fc-output-link" href={REFERENCES_PATH}>
					Open the reference library ↗
				</a>
			)}
		</section>
	);
}
