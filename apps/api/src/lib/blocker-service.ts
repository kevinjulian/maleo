/* The project's open blockers, and the acknowledgements that quiet them.
 *
 * Derivation is pure and lives in `@maleo/shared`; this reads the two places the
 * conditions are recorded — the latest run's delivery check and the project
 * document's story plan — and writes acknowledgements back as an artifact on the
 * document. Nothing is cached: a blocker is open exactly while its condition is,
 * which is what lets one disappear after an edit made anywhere else. */
import { getContentProject } from "@maleo/db/project-detail";
import { addContentStoryboard } from "@maleo/db/storyboards";
import { listWorkflowRunsForProject } from "@maleo/db/workflow-run-db";
import {
	BLOCKER_CHOICES,
	openBlockers,
	readStoryboardDocument,
	writeStoryboardDocument,
	artifactsOfKind,
	blockerAcknowledgementsArtifact,
	documentArtifacts,
	pipelineArtifactKinds,
	storyPlanArtifactOf,
	writeArtifact,
	type OpenBlocker,
} from "@maleo/shared";
import type { OutcomeEvaluation } from "@maleo/shared/agent-wire";
import { repairStoryboardDirection } from "./storyboard-authoring.ts";

/* The newest delivery check this project has, from any run.
 *
 * Deliberately not "the active run": a check usually lands on a run that has
 * already finished, and the whole point of reading blockers from state is that
 * they outlive the run that reported them. */
async function latestEvaluation(projectId: string): Promise<OutcomeEvaluation | undefined> {
	for (const row of await listWorkflowRunsForProject(projectId, 10)) {
		// SAFETY: the snapshot is this package's own persisted AgentJob; only the one
		// field is read, and a row without it is skipped by the guard below.
		const snapshot = row.snapshot as { outcomeEvaluation?: OutcomeEvaluation } | null;
		if (snapshot?.outcomeEvaluation) return snapshot.outcomeEvaluation;
	}
	return undefined;
}

async function documentOf(projectId: string) {
	const detail = await getContentProject(projectId);
	if (!detail) return null;
	const doc = readStoryboardDocument(detail.storyboards[0]?.storyboard_json).doc;
	const artifacts = documentArtifacts(doc.artifacts);
	const plan = storyPlanArtifactOf(artifacts)?.payload;
	const acknowledged =
		artifactsOfKind(artifacts, blockerAcknowledgementsArtifact)[0]?.payload.ids ?? [];
	return { doc, artifacts, plan, acknowledged };
}

export interface ProjectBlockers {
	/** Still open, and still worth clearing. */
	blockers: OpenBlocker[];
	/* Answered "leave as is", and still true of the project.
	 *
	 * Reported rather than forgotten: the delivery check still counts them, so a
	 * score that says "2 blockers" while the batch shows one has to be able to
	 * explain the difference. */
	acknowledged: OpenBlocker[];
}

/** What blocks this project right now, and what was knowingly left. */
export async function projectBlockers(projectId: string): Promise<ProjectBlockers | null> {
	const state = await documentOf(projectId);
	if (!state) return null;
	const input = { findings: (await latestEvaluation(projectId))?.findings, plan: state.plan };
	const blockers = openBlockers({ ...input, acknowledged: state.acknowledged });
	const open = new Set(blockers.map((blocker) => blocker.id));
	return { blockers, acknowledged: openBlockers(input).filter((blocker) => !open.has(blocker.id)) };
}

/** Every blocker open for this project right now. */
export async function projectOpenBlockers(projectId: string): Promise<OpenBlocker[] | null> {
	return (await projectBlockers(projectId))?.blockers ?? null;
}

/** Record blockers the operator chose to leave as is. Ids encode their condition,
 *  so a changed condition reopens without anything expiring these. */
export async function acknowledgeBlockers(
	projectId: string,
	ids: readonly string[],
): Promise<OpenBlocker[] | null> {
	const state = await documentOf(projectId);
	if (!state) return null;
	if (ids.length === 0) return projectOpenBlockers(projectId);
	const merged = [...new Set([...state.acknowledged, ...ids])];
	// An operator decision, made in the editor outside any run.
	const { artifacts } = writeArtifact(pipelineArtifactKinds, state.artifacts, {
		kind: blockerAcknowledgementsArtifact.kind,
		payload: { ids: merged },
		producer: { type: "editor" },
		projectId,
	});
	const saved = await addContentStoryboard({
		project_id: projectId,
		status: "storyboard",
		storyboard_json: writeStoryboardDocument({ ...state.doc, artifacts }),
	});
	if (!saved) return null;
	return projectOpenBlockers(projectId);
}

/* ── Answering the batch ── */

/** One operator answer: the blocker, and what they chose for it. */
export interface BlockerAnswer {
	id: string;
	/** An option id from the blocker's question, or free-form text. */
	choice?: string;
	otherText?: string;
}

export type BlockerResolution =
	| {
			ok: true;
			blockers: OpenBlocker[];
			/* What the operator asked for that only a run can do: a fix command, or
			 * their own words. Returned rather than run here — this is a state route,
			 * and starting a run is the chat's job. */
			instructions: string[];
			/** Blockers whose remedy is somewhere else in the app. */
			navigate: OpenBlocker[];
			/** Remedies that were attempted and did not clear their blocker. */
			failed: Array<{ id: string; message: string }>;
	  }
	| { ok: false; reason: "not_found" }
	| { ok: false; reason: "incomplete"; missing: string[] };

/* Apply what the operator chose, one blocker at a time.
 *
 * Independently, and in the order presented: a remedy that throws leaves its own
 * blocker open and is reported, while every other choice is still applied. The
 * batch is all-or-nothing about being ANSWERED — a missing answer is refused
 * before anything runs — and deliberately not all-or-nothing about succeeding,
 * because "fix three things, one fails, lose the other two" is the failure this
 * whole change exists to end. */
export async function resolveBlockers(
	projectId: string,
	answers: readonly BlockerAnswer[],
): Promise<BlockerResolution> {
	const open = await projectOpenBlockers(projectId);
	if (!open) return { ok: false, reason: "not_found" };
	const answered = new Map(answers.map((answer) => [answer.id, answer]));
	const missing = open.filter((blocker) => !answered.has(blocker.id)).map((blocker) => blocker.id);
	if (missing.length) return { ok: false, reason: "incomplete", missing };

	const instructions: string[] = [];
	const navigate: OpenBlocker[] = [];
	const acknowledge: string[] = [];
	const failed: Array<{ id: string; message: string }> = [];
	for (const blocker of open) {
		const answer = answered.get(blocker.id)!;
		if (answer.otherText?.trim()) {
			instructions.push(answer.otherText.trim());
			continue;
		}
		if (answer.choice === BLOCKER_CHOICES.leave) {
			acknowledge.push(blocker.id);
			continue;
		}
		if (answer.choice !== BLOCKER_CHOICES.remedy || !blocker.remedy) continue;
		if (blocker.remedy.kind === "command") {
			instructions.push(blocker.remedy.command);
			continue;
		}
		if (blocker.remedy.kind === "navigate") {
			navigate.push(blocker);
			continue;
		}
		try {
			await repairStoryboardDirection(projectId);
		} catch (err) {
			failed.push({ id: blocker.id, message: err instanceof Error ? err.message : String(err) });
		}
	}
	if (acknowledge.length) await acknowledgeBlockers(projectId, acknowledge);
	const remaining = await projectOpenBlockers(projectId);
	return { ok: true, blockers: remaining ?? [], instructions, navigate, failed };
}
