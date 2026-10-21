/* The one decision a parked run is waiting on, pinned above the composer.
 *
 * Pinned so it cannot scroll away while the user reads, and the latest one only:
 * an older question that a newer one superseded stays in the transcript as
 * history. Finite choices are buttons; a free-text question offers `Reply`,
 * which puts the composer into an explicit `Replying to` mode — without that
 * mode, composer text never reaches the parked run. Stop is always here. */
import type { JSX } from "react";
import { ICON, Ic } from "@design-system/icons/index.tsx";
import { Button } from "@design-system/components/button.tsx";
import { ClarificationCard } from "./chat-clarification-card.tsx";
import { approvalLabel } from "./chat-output-cards.tsx";
import type { StoryClarificationSubmission } from "@maleo/shared";
import type { ChatLogMessage } from "@models/chat/chat-log.ts";

export interface PinnedDecisionProps {
	message: ChatLogMessage;
	busy: boolean;
	replying: boolean;
	onChoose: (value: string) => void;
	onSubmitBatch: (submission: StoryClarificationSubmission) => void;
	onReply: () => void;
	onStop?: () => void;
	/** Offered while the decision approves a story plan. */
	onOpenStoryboard?: () => void;
}

export function PinnedDecision({
	message,
	busy,
	replying,
	onChoose,
	onSubmitBatch,
	onReply,
	onStop,
	onOpenStoryboard,
}: PinnedDecisionProps): JSX.Element | null {
	const question = message.question;
	if (!question) return null;
	const stop = onStop && (
		<Button variant="secondary" size="sm" onClick={onStop}>
			Stop
		</Button>
	);
	// A batch owns its own submit row; Stop sits beneath it.
	if (question.batch) {
		return (
			<section className="fc-pinned" aria-label="Decision needed" tabIndex={-1}>
				<ClarificationCard
					batch={question.batch}
					locked={Boolean(question.answered)}
					busy={busy}
					onSubmit={onSubmitBatch}
				/>
				{stop && <div className="fc-pinned-actions">{stop}</div>}
			</section>
		);
	}
	return (
		<section className="fc-pinned fc-ask" aria-label="Decision needed" tabIndex={-1}>
			<div className="fc-ask-q" id={`q-${message.id}`}>
				{Ic.info(ICON.sm)} {question.question}
			</div>
			{question.freeText && replying && (
				<div className="fc-ask-hint">
					Reply with the change — the plan keeps its structure and sources.
				</div>
			)}
			<div className="fc-ask-opts" role="group" aria-labelledby={`q-${message.id}`}>
				{question.options?.map((option) => (
					<Button
						key={option.value}
						variant="secondary"
						size="sm"
						className="fc-ask-opt"
						disabled={busy}
						onClick={() => onChoose(option.value)}
					>
						{approvalLabel(option.label, option.value)}
					</Button>
				))}
				{question.freeText && (
					<Button
						variant="secondary"
						size="sm"
						className="fc-ask-opt"
						aria-pressed={replying}
						disabled={busy}
						onClick={onReply}
					>
						Reply
					</Button>
				)}
				{onOpenStoryboard && (
					<Button variant="secondary" size="sm" className="fc-ask-opt" onClick={onOpenStoryboard}>
						Open in Storyboard
					</Button>
				)}
				{onStop && (
					<Button variant="secondary" size="sm" className="fc-ask-opt fc-ask-stop" onClick={onStop}>
						Stop
					</Button>
				)}
			</div>
		</section>
	);
}
