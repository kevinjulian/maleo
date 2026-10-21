/* What still blocks this project, read from the project rather than the chat log.
 *
 * Blockers used to live in the transcript, attached to the run that reported
 * them. Chat gives actions only to its newest run, so fixing one blocker started
 * a run, turned the card holding the others into history, and left them as dead
 * text — and a run that failed showed its blockers with no remedy at all. They
 * are a property of the project right now, not an event, so they are derived
 * here on every read: a blocker whose condition is gone disappears without a run,
 * and one whose condition holds survives however many runs happened since.
 *
 * Ids encode the condition. That is what lets a card track answers across reads,
 * and what makes acknowledgement safe: "leave as is" stores an id, and a changed
 * condition produces a different id, so the blocker comes back on its own. */
import type { OutcomeFinding } from "./agent-wire.ts";

/** What can be offered for a blocker. `navigate` exists because some blockers
 *  are not ours to fix: a required reference with no roster entity is cleared by
 *  the operator adding one, and offering "apply fix" for it would be a lie. */
export type BlockerRemedy =
	| { kind: "command"; label: string; command: string }
	| { kind: "redirect"; label: string }
	| { kind: "navigate"; label: string; target: "references" };

export type BlockerSource = "outcome_finding" | "story_direction";

export interface OpenBlocker {
	id: string;
	source: BlockerSource;
	message: string;
	/** Absent when nothing can be offered but leaving it as is. */
	remedy?: BlockerRemedy;
}

export interface OpenBlockerInput {
	findings?: readonly OutcomeFinding[];
	plan?: {
		needsDirection?: boolean;
		directionBlocked?: boolean;
		directionErrors?: readonly string[];
	};
	/** Blocker ids the operator chose to leave as is. */
	acknowledged?: readonly string[];
}

/* FNV-1a over the condition text. Not a security hash — an id that is stable for
 * the same condition and different for a changed one, with no dependency. */
function conditionId(source: BlockerSource, condition: string): string {
	let hash = 0x811c9dc5;
	for (let index = 0; index < condition.length; index += 1) {
		hash ^= condition.charCodeAt(index);
		hash = Math.imul(hash, 0x01000193) >>> 0;
	}
	return `${source}:${hash.toString(16).padStart(8, "0")}`;
}

function directionBlocker(message: string, operatorOnly: boolean): OpenBlocker {
	return {
		id: conditionId("story_direction", `${operatorOnly ? "operator" : "stale"}|${message}`),
		source: "story_direction",
		message,
		remedy: operatorOnly
			? { kind: "navigate", label: "Add the missing reference", target: "references" }
			: { kind: "redirect", label: "Re-run direction" },
	};
}

function findingBlocker(finding: OutcomeFinding): OpenBlocker {
	return {
		id: conditionId(
			"outcome_finding",
			`${finding.requirementId}|${finding.message}|${finding.fix?.command ?? ""}`,
		),
		source: "outcome_finding",
		message: finding.message,
		remedy: finding.fix
			? { kind: "command", label: "Apply the fix", command: finding.fix.command }
			: undefined,
	};
}

/** Every blocker that is open now, newest condition first within each source. */
export function openBlockers(input: OpenBlockerInput): OpenBlocker[] {
	const acknowledged = new Set(input.acknowledged ?? []);
	const fromPlan = input.plan?.needsDirection
		? (input.plan.directionErrors ?? []).map((message) =>
				directionBlocker(message, input.plan?.directionBlocked === true),
			)
		: [];
	const fromFindings = (input.findings ?? [])
		.filter((finding) => finding.severity === "blocker")
		.map(findingBlocker);
	const seen = new Set<string>();
	return [...fromPlan, ...fromFindings].filter((blocker) => {
		if (acknowledged.has(blocker.id) || seen.has(blocker.id)) return false;
		seen.add(blocker.id);
		return true;
	});
}

/* ── The batch a card renders ── */

/** The option ids a blocker question uses. They are the answer vocabulary, so
 *  they are fixed rather than generated: the submit maps each one to an action. */
export const BLOCKER_CHOICES = { remedy: "remedy", leave: "leave" } as const;

const SOURCE_HEADER: Record<BlockerSource, string> = {
	outcome_finding: "Delivery check",
	story_direction: "Story direction",
};

const REMEDY_DESCRIPTION: Record<BlockerRemedy["kind"], string> = {
	command: "Runs the fix and re-checks.",
	redirect: "Re-runs direction over the current plan.",
	navigate: "Opens where you can clear it, and leaves this open.",
};

/** One blocker as one single-choice question. */
export function blockerQuestion(blocker: OpenBlocker) {
	const leave = {
		id: BLOCKER_CHOICES.leave,
		label: "Leave as is",
		value: "leave as is",
		description: "Keeps it as it is and stops asking until it changes.",
		...(blocker.remedy ? {} : { recommended: true }),
	};
	return {
		id: blocker.id,
		header: SOURCE_HEADER[blocker.source],
		question: blocker.message.slice(0, 400),
		options: blocker.remedy
			? [
					{
						id: BLOCKER_CHOICES.remedy,
						label: blocker.remedy.label,
						value: blocker.remedy.kind,
						description: REMEDY_DESCRIPTION[blocker.remedy.kind],
						recommended: true,
					},
					leave,
				]
			: [leave],
	};
}

/* One id for one open set.
 *
 * It changes whenever the set does, so a card answering a superseded set is
 * refused by the batch-id check the submission contract already performs — no
 * second staleness mechanism. Hashed rather than concatenated, because the ids
 * of three blockers do not fit in a batch id. */
export function blockerBatchId(blockers: readonly OpenBlocker[]): string {
	return `blockers-${conditionId("outcome_finding", blockers.map((blocker) => blocker.id).join("|")).split(":")[1]}`;
}

/** Every open blocker as one batch, or null when nothing is open. */
export function blockerBatch(blockers: readonly OpenBlocker[]) {
	if (blockers.length === 0) return null;
	return {
		id: blockerBatchId(blockers),
		stage: "pre_generation" as const,
		purpose: "blocker" as const,
		questions: blockers.map(blockerQuestion),
		intro:
			blockers.length === 1
				? "One thing is still blocking this project."
				: `${blockers.length} things are still blocking this project.`,
	};
}
