import type { PipelineContextKey } from "./pipeline-context.ts";
import { stageFailure } from "./stage-failure.ts";
import {
	isArtifactReady,
	pipelineArtifactKinds,
	type ArtifactContextSnapshot,
	type PipelineArtifact,
	type StageFailure,
	type StageResult,
} from "@maleo/shared";
import type { StageContract } from "./stage-contracts.ts";
import { withStageScope, settleJobArtifacts, type ArtifactRun } from "./artifact-store.ts";

export type ContentType = "video" | "image" | "text";
/* Research is not a stage today, despite `research` being in this union.
 *
 * It runs inside the plan stage, between the frame and the skeleton, because only
 * the frame knows whether the brief needs grounding and what to ask. Re-retrieval
 * during a revision goes through `researchAgain` directly (`approval.ts:290`), not
 * through the pipeline: no run is ever parked at `cursor: "research"`, and nothing
 * registers a stage for it.
 *
 * `research`, `motion` and `audio` are ids no pipeline implements. They are kept in
 * the union only because parked runs persist their cursor and profile, so removing
 * an id is a data migration rather than an edit. */
/* `apply` is the edit flow's own stage: applying an approved edit to existing work.
 * It used to borrow whichever stage slot happened to park — the edit pipeline was
 * written as `["scaffold", "finalize"]` so the runner would gate it — which left a
 * registration that could not say what it was until the run had already parked.
 *
 * Runs parked before `apply` existed still carry `cursor: "scaffold"`, so the edit
 * pipeline registers its stage under both ids. See `pipeline-definitions.ts`. */
export type StageId =
	| "research"
	| "plan"
	| "scaffold"
	| "visuals"
	| "motion"
	| "audio"
	| "apply"
	| "finalize";
export type UnitGranularity = "beat" | "section" | "slide" | "post";
export type PipelineMode = "manual" | "auto";
export type PipelineStatus = "running" | "awaiting_approval" | "done" | "error";
export type Operation = "create" | "update" | "delete";
export type ApprovalChoice = "approve" | "approve_all" | "reject";
export type UnitStatus = "draft" | "proposed" | "approved" | "generating" | "ready" | "failed";

export interface PipelineUnit {
	id: string;
	granularity: UnitGranularity;
	status: UnitStatus;
	title?: string;
	sourceId?: string;
}

export interface UnitLifecycle {
	schemaVersion: 1;
	units: PipelineUnit[];
}

/* One run's instance of a pipeline: the stage order it will run, plus the format
 * facts that vary per run. Declared pipelines live in `pipeline-definitions.ts`;
 * this is what one of them becomes when a run starts, and what the run persists. */
export interface FormatProfile {
	contentType: ContentType;
	targetSec?: number;
	granularity: UnitGranularity;
	narrationFirst: boolean;
	/* An explicit demand for grounding, read by planning as `requireGrounding`. It
	 * only ever raises: it can turn research on when the frame did not ask for it,
	 * and can never turn the frame's decision off. It is NOT derived from
	 * `narrated` — a narrated video is not thereby a factual one, and deriving it
	 * that way would override the frame on every narrated build. */
	researchFirst: boolean;
	stages: StageId[];
}

/* What a gate holds while it waits. An edit to existing work carries the edit the
 * operator reviewed, which is applied — not redrafted — once approved; every other
 * gate carries nothing beyond its summary. Typed, so resuming reads it by kind
 * rather than probing an untyped object for a `tool` field. */
export type DraftPayload =
	| { kind: "gate" }
	| { kind: "edit"; tool: string; args: Record<string, unknown> };

export interface Draft {
	operation: Operation;
	targetsExisting: boolean;
	summary: string;
	payload: DraftPayload;
}

/** A gate for an edit to existing work, carrying the edit the operator reviews. */
export type EditDraft = Draft & { payload: Extract<DraftPayload, { kind: "edit" }> };

export interface Stage<TCtx = unknown> {
	id: StageId;
	costsAssets: boolean;
	/* What this stage reads. Declared here because a stage's inputs are part of its
	 * definition, not of the call that happens to run it. See `pipeline-context.ts`
	 * for why the key set is closed and why declaring is not yet enforcing. */
	consumes: readonly PipelineContextKey[];
	/* The artifact kinds this stage reads and writes. Mandatory: a stage that does
	 * not say what it needs and makes cannot be placed in a pipeline. See
	 * `stage-contracts.ts`. */
	requires: StageContract["requires"];
	produces: StageContract["produces"];
	/* Settle the external context this stage reads before it is fingerprinted —
	 * generation reloads the selected timeline template here, so the snapshot
	 * records the template the pass will actually hold. */
	begin?: (ctx: TCtx) => Promise<void>;
	produce: (ctx: TCtx) => Promise<Draft>;
	/* Commits with the artifacts it requires, resolved by the runner, and reports
	 * whether it completed. What it produced is not its own claim: the runner reads
	 * it from what the stage wrote. */
	commit: (ctx: TCtx, draft: Draft, inputs: StageInputs) => Promise<StageCommitResult>;
}

/** The artifacts a stage requires, resolved and checked before it runs. */
export interface StageInputs {
	/** The required artifact of this kind, if the stage's contract names it. */
	get(kind: string): PipelineArtifact | undefined;
}

/** What a commit reports. The runner turns it into a `StageResult`. */
export type StageCommitResult =
	| { status: "completed"; note?: string }
	| { status: "failed"; error: StageFailure }
	/* The stage parked part-way, waiting on the user (a post-research question).
	 * Its writes stay in progress: nothing downstream consumes them, and the stage
	 * re-entered with the answer reuses them. */
	| { status: "suspended"; note: string };

/** What the runner needs of a run: its artifacts. */
export type ArtifactHolder = ArtifactRun;

/* One implementation per stage id.
 *
 * Before this existed, `scaffold` had four bodies — one per call site — and the
 * order they ran in was a literal written beside them. Both halves could drift from
 * each other silently, and a profile could name a stage that nothing implemented
 * (the old `videoProfile` default listed `motion` and `audio`, which no call site
 * ever registered) without anything failing, because nothing read it.
 *
 * Registration is therefore the point where both mistakes are caught: a stage id
 * implemented twice, and a pipeline naming an id nothing implements. Neither
 * reaches a run. */
export class StageRegistrationError extends Error {}

export interface StageRegistry<TCtx = unknown> {
	get(id: StageId): Stage<TCtx> | undefined;
	/** Resolve a stage order, failing on the first id nothing implements. */
	resolve(order: readonly StageId[]): Array<Stage<TCtx>>;
	readonly ids: readonly StageId[];
}

export function createStageRegistry<TCtx>(stages: ReadonlyArray<Stage<TCtx>>): StageRegistry<TCtx> {
	const byId = new Map<StageId, Stage<TCtx>>();
	for (const stage of stages) {
		if (byId.has(stage.id))
			throw new StageRegistrationError(`pipeline stage ${stage.id} registered more than once`);
		if (!Array.isArray(stage.requires) || !Array.isArray(stage.produces)) {
			throw new StageRegistrationError(
				`pipeline stage ${stage.id} does not declare what it requires and produces`,
			);
		}
		byId.set(stage.id, stage);
	}
	return {
		get: (id) => byId.get(id),
		ids: [...byId.keys()],
		resolve(order) {
			const missing = order.filter((id) => !byId.has(id));
			if (missing.length)
				throw new StageRegistrationError(`pipeline stage ${missing[0]} not registered`);
			return order.map((id) => byId.get(id)!);
		},
	};
}

export interface PipelineRun {
	profile: FormatProfile;
	cursor: StageId;
	mode: PipelineMode;
	status: PipelineStatus;
	currentDraft?: Draft;
}

export type PipelineResult =
	/* `notes` are what the stages committed in this call reported, in order, and
	 * `results` the stage results the runner built from them. A run that parks
	 * reports nothing, because nothing committed. */
	| { status: "done"; run: PipelineRun; notes: string[]; results: StageResult[] }
	| { status: "awaiting_approval"; run: PipelineRun; stage: StageId; draft: Draft }
	/* A stage failed: the run stops at it. `notes` ends with the failure message. */
	| {
			status: "failed";
			run: PipelineRun;
			stage: StageId;
			error: StageFailure;
			notes: string[];
			results: StageResult[];
	  }
	/* A stage parked for the user: the run stays at it, its writes in progress. */
	| { status: "suspended"; run: PipelineRun; stage: StageId; note: string };

export function needsGate(
	stage: Pick<Stage, "costsAssets">,
	draft: Pick<Draft, "operation" | "targetsExisting">,
	run: Pick<PipelineRun, "mode">,
): boolean {
	if (draft.operation !== "create" && draft.targetsExisting) return true;
	if (run.mode === "auto") return false;
	return stage.costsAssets;
}

export function applyApprovalChoice(run: PipelineRun, choice: ApprovalChoice): PipelineRun {
	if (choice === "reject") return { ...run, status: "awaiting_approval" };
	return { ...run, mode: choice === "approve_all" ? "auto" : run.mode, status: "running" };
}

/* Told which stage is about to run and what it declared it reads.
 *
 * Declared context is static, so a reader can get it from `pipeline-stages.ts`. It
 * is reported per run as well because the useful question during an incident is not
 * "what does this stage read" but "what did the stage that just ran believe it
 * read" — the answer that makes a wrong declaration visible instead of theoretical. */
export type StageObserver = (entry: {
	stage: StageId;
	consumes: readonly PipelineContextKey[];
}) => void;

/* The artifacts a stage requires, by kind, each the run's latest of that kind.
 * A required kind that is missing, not ready, or at another schema version fails
 * the stage before it runs; an optional one is passed when present. */
function resolveStageInputs(
	ctx: ArtifactHolder,
	stage: Pick<Stage, "id" | "requires">,
): { ok: true; inputs: StageInputs } | { ok: false; error: StageFailure } {
	const byKind = new Map<string, PipelineArtifact>();
	for (const requirement of stage.requires) {
		const artifact = ctx.artifacts
			.filter((candidate) => candidate.kind === requirement.kind)
			.at(-1);
		if (!artifact) {
			if (requirement.optional) continue;
			return {
				ok: false,
				error: stageFailure(
					"missing_input",
					requirement.whenMissing ??
						`stage ${stage.id} requires ${requirement.kind}, which this run does not hold`,
				),
			};
		}
		/* A stage re-entered after a crash may pick up what it was producing itself;
		 * any other in-progress artifact is not ready. */
		const ownProgress =
			artifact.status === "in_progress" &&
			artifact.producer.type === "stage" &&
			artifact.producer.stage === stage.id;
		if (
			artifact.schemaVersion !== requirement.schemaVersion ||
			!(ownProgress || isArtifactReady(pipelineArtifactKinds, artifact))
		) {
			return {
				ok: false,
				error: stageFailure(
					"input_not_ready",
					`stage ${stage.id} requires a ready ${requirement.kind}@${requirement.schemaVersion}; this run holds ${artifact.status} @${artifact.schemaVersion}`,
				),
			};
		}
		byKind.set(requirement.kind, artifact);
	}
	return { ok: true, inputs: { get: (kind) => byKind.get(kind) } };
}

/* A completed commit's outputs are what the stage wrote, and they must match its
 * declaration: an undeclared kind cannot be written at all (the scope refuses it),
 * and a declared, non-optional kind the stage did not write fails it. */
function stageResultOf(
	stage: Pick<Stage, "id" | "produces">,
	committed: StageCommitResult,
	written: PipelineArtifact[],
): StageResult {
	if (committed.status === "failed") return { status: "failed", error: committed.error };
	const writtenKinds = new Set(written.map((artifact) => artifact.kind));
	const missing = stage.produces
		.filter((production) => !production.optional && !writtenKinds.has(production.kind))
		.map((production) => production.kind);
	if (missing.length) {
		return {
			status: "failed",
			error: stageFailure(
				"missing_output",
				`stage ${stage.id} completed without producing ${missing.join(", ")}`,
			),
		};
	}
	return { status: "completed", outputs: written };
}

export async function runPipeline<TCtx extends ArtifactHolder>(
	ctx: TCtx,
	registry: StageRegistry<TCtx>,
	run: PipelineRun,
	observe?: StageObserver,
	/** Fingerprints a stage's declared context when it begins; its artifacts record it. */
	snapshot?: (ctx: TCtx, keys: readonly PipelineContextKey[]) => ArtifactContextSnapshot,
): Promise<PipelineResult> {
	const order = run.profile.stages;
	let cursorIndex = Math.max(0, order.indexOf(run.cursor));
	/* Resolve every stage this call will run, before running any of them: a missing
	 * stage used to surface only when the cursor reached it, which could be after
	 * earlier stages had committed and spent credits.
	 *
	 * Only from the cursor onward. A run resumed after approval carries the profile
	 * it started with, but registers just the stages still owed — the ones already
	 * committed are deliberately absent, so demanding the whole order would reject
	 * every resumed run. Checking that a pipeline names only registered stages is a
	 * property of the pipeline, and belongs where pipelines are declared. */
	const pending = registry.resolve(order.slice(cursorIndex));
	const notes: string[] = [];
	const results: StageResult[] = [];
	let nextRun: PipelineRun = { ...run, status: "running" };

	for (let pendingIndex = 0; cursorIndex < order.length; cursorIndex++, pendingIndex++) {
		const stageId = order[cursorIndex]!;
		const stage = pending[pendingIndex]!;
		observe?.({ stage: stageId, consumes: stage.consumes });
		const approvedDraft = nextRun.currentDraft;
		const draft = approvedDraft ?? (await stage.produce(ctx));
		if (!approvedDraft && needsGate(stage, draft, nextRun)) {
			nextRun = { ...nextRun, cursor: stageId, status: "awaiting_approval", currentDraft: draft };
			return { status: "awaiting_approval", run: nextRun, stage: stageId, draft };
		}
		const resolved = resolveStageInputs(ctx, stage);
		let committed: StageCommitResult;
		let written: PipelineArtifact[] = [];
		if (!resolved.ok) {
			committed = { status: "failed", error: resolved.error };
		} else {
			await stage.begin?.(ctx);
			const context = snapshot?.(ctx, stage.consumes);
			const revisions = new Map(ctx.artifacts.map((artifact) => [artifact.id, artifact.revision]));
			const kinds = [...stage.requires, ...stage.produces].map((entry) => entry.kind);
			committed = await withStageScope(ctx, stageId, kinds, context, () =>
				stage.commit(ctx, draft, resolved.inputs),
			);
			if (committed.status === "suspended") {
				return {
					status: "suspended",
					run: { ...nextRun, cursor: stageId, status: "running", currentDraft: undefined },
					stage: stageId,
					note: committed.note,
				};
			}
			written = ctx.artifacts.filter(
				(artifact) => revisions.get(artifact.id) !== artifact.revision,
			);
			/* The commit returned: its writes are complete in the same step that
			 * advances (or, on failure, holds) the cursor, so the next snapshot carries
			 * both. Only a crash inside the commit leaves them in progress. */
			settleJobArtifacts(ctx, new Set(written.map((artifact) => artifact.id)));
			written = ctx.artifacts.filter((artifact) =>
				written.some((entry) => entry.id === artifact.id),
			);
		}
		const result = stageResultOf(stage, committed, written);
		results.push(result);
		if (result.status === "failed") {
			notes.push(result.error.message);
			const failedRun: PipelineRun = {
				...nextRun,
				cursor: stageId,
				status: "error",
				currentDraft: undefined,
			};
			return {
				status: "failed",
				run: failedRun,
				stage: stageId,
				error: result.error,
				notes,
				results,
			};
		}
		if (committed.status === "completed" && committed.note) notes.push(committed.note);
		const nextStage = order[cursorIndex + 1];
		nextRun = {
			...nextRun,
			cursor: nextStage ?? stageId,
			status: nextStage ? "running" : "done",
			currentDraft: undefined,
		};
	}

	return {
		status: "done",
		run: { ...nextRun, status: "done", currentDraft: undefined },
		notes,
		results,
	};
}
