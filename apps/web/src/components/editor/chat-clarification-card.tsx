import { Input } from "@design-system/components/input.tsx";
/* The pre-research story clarification card.
 *
 * One batch is one card, one set of single-choice groups, and ONE submission —
 * the server accepts nothing partial, so the card must not send anything
 * partial. Native radios and a real fieldset/legend do the accessibility work:
 * arrow keys traverse a group, Tab moves between groups, and the legend names
 * the decision. Nothing here reimplements what the platform already gives.
 *
 * Pending selections survive a reload through `localStorage`, keyed by the
 * batch id. That is a per-viewer convenience, never the answer: the answer is
 * only what the submit sends and the server accepts. */
import { useEffect, useMemo, useRef, useState } from "react";
import type { JSX } from "react";
import { ICON, Ic } from "@design-system/icons/index.tsx";
import { BLOCKER_RESOLUTION_PURPOSE } from "@maleo/shared";
import type { StoryClarificationBatch, StoryClarificationSubmission } from "@maleo/shared";

/** Marks the free-form choice inside a group, so one radio name covers both the
 *  options and Other without a second control deciding which wins. */
const OTHER = "__other__";

type Draft = { choice: Record<string, string>; other: Record<string, string> };

const EMPTY_DRAFT: Draft = { choice: {}, other: {} };

/* Every batch's draft lives under ONE key, capped.
 *
 * A key per batch never shrinks: a card that is superseded rather than submitted
 * clears nothing, so an abandoned batch leaves its draft behind forever. Keeping
 * the drafts in one bounded map fixes that without clearing a locked card's
 * selections, which are what keeps its answers readable after a reload. */
const DRAFTS_KEY = "maleo.clarification.drafts";
const MAX_DRAFTS = 5;

function readDrafts(): Record<string, Draft> {
	try {
		const raw = window.localStorage.getItem(DRAFTS_KEY);
		if (!raw) return {};
		// SAFETY: every field read below is defaulted, so a value of any other shape
		// — a map written by an older card, or storage a user edited — degrades to an
		// empty draft instead of throwing or rendering an answer nobody chose.
		const parsed = JSON.parse(raw) as Record<string, Partial<Draft> | undefined>;
		return Object.fromEntries(
			Object.entries(parsed ?? {}).map(([id, draft]) => [
				id,
				{ choice: draft?.choice ?? {}, other: draft?.other ?? {} },
			]),
		);
	} catch {
		return {};
	}
}

function writeDrafts(next: Record<string, Draft>): void {
	try {
		window.localStorage.setItem(DRAFTS_KEY, JSON.stringify(next));
	} catch {
		/* a viewer with site data blocked simply keeps no draft */
	}
}

function readDraft(batchId: string): Draft {
	return readDrafts()[batchId] ?? EMPTY_DRAFT;
}

function writeDraft(batchId: string, draft: Draft): void {
	const existing = readDrafts();
	// Delete before re-adding so the touched batch moves to the end of the
	// insertion order, and the entry dropped by the cap is the least recent.
	delete existing[batchId];
	const entries = [...Object.entries(existing), [batchId, draft] as const].slice(-MAX_DRAFTS);
	writeDrafts(Object.fromEntries(entries));
}

function clearDraft(batchId: string): void {
	const existing = readDrafts();
	if (!(batchId in existing)) return;
	delete existing[batchId];
	writeDrafts(existing);
}

/** Which questions still have no usable answer. Other with blank text is not an
 *  answer — it is an unanswered question wearing an answer's shape. */
function missingAnswers(batch: StoryClarificationBatch, draft: Draft): string[] {
	return batch.questions
		.filter((question) => {
			const choice = draft.choice[question.id];
			if (!choice) return true;
			if (choice !== OTHER) return false;
			return !(draft.other[question.id] ?? "").trim();
		})
		.map((question) => question.id);
}

function toSubmission(
	batch: StoryClarificationBatch,
	draft: Draft,
	bestJudgment: boolean,
): StoryClarificationSubmission {
	const answers = batch.questions.flatMap<
		NonNullable<StoryClarificationSubmission["answers"]>[number]
	>((question) => {
		const choice = draft.choice[question.id];
		if (!choice) return [];
		if (choice === OTHER) {
			const text = (draft.other[question.id] ?? "").trim();
			return text ? [{ questionId: question.id, otherText: text }] : [];
		}
		return [{ questionId: question.id, optionId: choice }];
	});
	return {
		batchId: batch.id,
		...(bestJudgment ? { bestJudgment: true } : {}),
		...(answers.length ? { answers } : {}),
	};
}

export interface ClarificationCardProps {
	batch: StoryClarificationBatch;
	/** The server accepted an answer, or the card was superseded. Either way its
	 *  controls close while the chosen answers stay readable. */
	locked: boolean;
	busy: boolean;
	onSubmit: (submission: StoryClarificationSubmission) => void;
}

export function ClarificationCard({
	batch,
	locked,
	busy,
	onSubmit,
}: ClarificationCardProps): JSX.Element {
	const [draft, setDraft] = useState<Draft>(() => readDraft(batch.id));
	/** The same card, serving the second purpose: one question per open blocker. */
	const blockers = batch.purpose === BLOCKER_RESOLUTION_PURPOSE;
	const [missing, setMissing] = useState<string[]>([]);
	const groupRefs = useRef<Record<string, HTMLInputElement | null>>({});
	const firstRadio = useRef<HTMLInputElement | null>(null);

	/* Focus enters the batch when it appears, so a keyboard user is not left
	 * hunting for a card that just took over the conversation — unless the user is
	 * already typing. A run parks while the composer holds a half-written thought,
	 * and yanking the caret out of it mid-sentence loses that thought to fix a
	 * discoverability problem the card does not have while someone is typing. */
	useEffect(() => {
		if (locked) return;
		const active = document.activeElement;
		const typing =
			active instanceof HTMLElement &&
			(active.isContentEditable ||
				active.tagName === "INPUT" ||
				active.tagName === "TEXTAREA" ||
				active.tagName === "SELECT");
		if (!typing) firstRadio.current?.focus();
	}, [locked]);

	useEffect(() => {
		if (!locked) writeDraft(batch.id, draft);
	}, [batch.id, draft, locked]);

	const missingSet = useMemo(() => new Set(missing), [missing]);
	const disabled = locked || busy;

	const choose = (questionId: string, value: string): void => {
		setDraft((prev) => ({ ...prev, choice: { ...prev.choice, [questionId]: value } }));
		setMissing((prev) => prev.filter((id) => id !== questionId));
	};
	const setOther = (questionId: string, text: string): void => {
		setDraft((prev) => ({
			...prev,
			other: { ...prev.other, [questionId]: text },
			// Typing IS the choice — a typed answer nobody selected would be dropped.
			choice: { ...prev.choice, [questionId]: OTHER },
		}));
		setMissing((prev) => (text.trim() ? prev.filter((id) => id !== questionId) : prev));
	};

	const submit = (): void => {
		const gaps = missingAnswers(batch, draft);
		if (gaps.length) {
			setMissing(gaps);
			// Move focus to the first group that still needs an answer rather than
			// leaving the feedback to be discovered by scrolling.
			groupRefs.current[gaps[0]!]?.focus();
			return;
		}
		clearDraft(batch.id);
		onSubmit(toSubmission(batch, draft, false));
	};

	const delegate = (): void => {
		setMissing([]);
		clearDraft(batch.id);
		onSubmit(toSubmission(batch, draft, true));
	};

	return (
		<div className="fc-ask fc-clarify">
			<div className="fc-ask-q">
				{Ic.info(ICON.sm)}
				<span>
					{locked
						? "Answered."
						: batch.intro?.trim() || "A few decisions before I plan this story."}
				</span>
			</div>
			{batch.questions.map((question, questionIndex) => {
				const groupId = `${batch.id}-${question.id}`;
				const invalid = missingSet.has(question.id);
				const chosen = draft.choice[question.id];
				return (
					<fieldset
						key={question.id}
						className={`fc-clarify-group${invalid ? " fc-clarify-invalid" : ""}`}
						aria-describedby={invalid ? `${groupId}-error` : undefined}
					>
						<legend className="fc-clarify-legend">
							<span className="fc-clarify-header">{question.header}</span>
							<span className="fc-clarify-question">{question.question}</span>
						</legend>
						{question.options.map((option, optionIndex) => {
							const id = `${groupId}-${option.id}`;
							return (
								<label key={option.id} className="fc-clarify-opt" htmlFor={id}>
									<input
										ref={(node) => {
											if (optionIndex === 0) groupRefs.current[question.id] = node;
											if (questionIndex === 0 && optionIndex === 0) firstRadio.current = node;
										}}
										id={id}
										type="radio"
										name={groupId}
										value={option.id}
										checked={chosen === option.id}
										disabled={disabled}
										onChange={() => choose(question.id, option.id)}
									/>
									<span className="fc-clarify-opt-body">
										<span className="fc-clarify-opt-label">
											{option.label}
											{option.recommended && <span className="fc-clarify-rec">Recommended</span>}
										</span>
										<span className="fc-clarify-opt-desc">{option.description}</span>
										{/* A post-research option rests on retrieved sources, and the
										    user cannot judge the choice without seeing which. Every
										    source here has already been resolved against the held
										    research bundle server-side, so these are links to pages
										    the run actually read. */}
										{option.sources?.length ? (
											<span className="fc-clarify-opt-sources">
												{option.sources.map((source) => (
													<a
														key={source.url}
														className="fc-clarify-opt-source"
														href={source.url}
														target="_blank"
														rel="noreferrer noopener"
														// The label is the row; the link should not steal its click.
														onClick={(event) => event.stopPropagation()}
													>
														{source.title}
													</a>
												))}
											</span>
										) : null}
									</span>
								</label>
							);
						})}
						{question.allowOther !== false && (
							/* A div, not a label: the text input is a control of its own, and a
							 * label wrapping a second interactive element is a shape that only
							 * works because activation does not forward through one. The radio
							 * gets its own label; the input gets its own accessible name. */
							<div className="fc-clarify-opt">
								<input
									id={`${groupId}-other`}
									type="radio"
									name={groupId}
									value={OTHER}
									checked={chosen === OTHER}
									disabled={disabled}
									onChange={() => choose(question.id, OTHER)}
								/>
								<span className="fc-clarify-opt-body">
									<label className="fc-clarify-opt-label" htmlFor={`${groupId}-other`}>
										Something else
									</label>
									<Input
										type="text"
										className="fc-clarify-other"
										aria-label={`Your own answer for ${question.header}`}
										placeholder="Describe it in your own words"
										value={draft.other[question.id] ?? ""}
										disabled={disabled}
										/* Typing selects Other; merely TABBING THROUGH the field does not.
										 * Selecting on focus made keyboard traversal silently replace a
										 * chosen option with an empty Other — an answer the server then
										 * rejects, for a choice the user never made. */
										onChange={(event) => setOther(question.id, event.target.value)}
									/>
								</span>
							</div>
						)}
						{invalid && (
							<p id={`${groupId}-error`} className="fc-clarify-error" role="alert">
								Choose an option, or describe your own answer.
							</p>
						)}
					</fieldset>
				);
			})}
			{!locked && (
				<div className="fc-clarify-actions">
					<button type="button" className="fc-approval-approve" disabled={busy} onClick={submit}>
						{Ic.info(ICON.sm)} {blockers ? "Apply these answers" : "Use these answers"}
					</button>
					{/* Delegation answers an editorial fork, and does not answer a
					 * blocker — each blocker carries its own "Leave as is", and the
					 * server refuses a delegated blocker submission. */}
					{!blockers && (
						<button type="button" className="fc-approval-reject" disabled={busy} onClick={delegate}>
							Use your best judgment
						</button>
					)}
				</div>
			)}
		</div>
	);
}
