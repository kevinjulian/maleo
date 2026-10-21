/* The one way a run's artifacts are read and changed.
 *
 * Every producer — a pipeline stage, a tool, a service a tool calls — writes
 * through `putJobArtifact`, which validates the payload against its kind, advances
 * the revision and re-hashes (`writeArtifact` in `@maleo/shared`). Nothing
 * assigns into `job.artifacts` directly, so no artifact can carry a hash that
 * disagrees with its payload.
 *
 * While a pipeline stage commits, the run is scoped to that stage's contract
 * (`withStageScope`): reading or writing an artifact kind the stage did not
 * declare throws. A stage therefore cannot reach another stage's output through
 * the job — it gets what it requires from the runner, and sees only what its
 * contract names. Persistence is run infrastructure, not a stage, and keeps
 * reading the whole list. */
import { AsyncLocalStorage } from "node:async_hooks";
import {
	pipelineArtifactKinds,
	writeArtifact,
	type ArtifactContextSnapshot,
	type ArtifactKind,
	type ArtifactProducer,
	type ArtifactRef,
	type ArtifactStatus,
	type PipelineArtifact,
} from "@maleo/shared";
import type { AgentJob } from "./model.ts";

export function stageProducer(job: Pick<AgentJob, "id">, stage: string): ArtifactProducer {
	return { type: "stage", stage, runId: job.id };
}

export function toolProducer(job: Pick<AgentJob, "id">, tool: string): ArtifactProducer {
	return { type: "tool", tool, runId: job.id };
}

/* ── Stage scope ───────────────────────────────────────────────────────────── */

export class ArtifactScopeError extends Error {}

/** Anything holding a run's artifacts: a job, or a runner context. */
export interface ArtifactRun {
	artifacts: PipelineArtifact[];
}

interface StageScope {
	job: ArtifactRun;
	stage: string;
	kinds: ReadonlySet<string>;
	/** The stage's declared context as it was when the stage began. */
	context?: ArtifactContextSnapshot;
}

/* Bound to the commit's async context, not to the job object: a request polling
 * the same in-memory job while a stage commits is not that stage, and reads the
 * whole run. */
const stageScope = new AsyncLocalStorage<StageScope>();

function scopeOf(job: ArtifactRun): StageScope | undefined {
	const scope = stageScope.getStore();
	return scope?.job === job ? scope : undefined;
}

/** Run one stage's commit scoped to its artifact kinds. */
export function withStageScope<T>(
	job: ArtifactRun,
	stage: string,
	kinds: Iterable<string>,
	context: ArtifactContextSnapshot | undefined,
	commit: () => Promise<T>,
): Promise<T> {
	const active = scopeOf(job);
	if (active)
		throw new ArtifactScopeError(
			`stage ${stage} started while stage ${active.stage} is still committing`,
		);
	return stageScope.run({ job, stage, kinds: new Set(kinds), context }, commit);
}

function assertInScope(job: ArtifactRun, kind: string, access: "read" | "write"): void {
	const scope = scopeOf(job);
	if (scope && !scope.kinds.has(kind)) {
		throw new ArtifactScopeError(
			`stage ${scope.stage} may not ${access} ${kind}: it is not in the stage's contract`,
		);
	}
}

/* ── Reads ─────────────────────────────────────────────────────────────────── */

/** The run's artifacts of one kind, narrowed to its payload. */
export function jobArtifactsOfKind<TPayload>(
	job: Pick<AgentJob, "artifacts">,
	kind: ArtifactKind<TPayload>,
): Array<PipelineArtifact<TPayload>> {
	assertInScope(job, kind.kind, "read");
	return job.artifacts.filter(
		(artifact): artifact is PipelineArtifact<TPayload> => artifact.kind === kind.kind,
	);
}

/** One artifact by id, for resolving a reference. */
export function jobArtifactById(
	job: Pick<AgentJob, "artifacts">,
	id: string,
): PipelineArtifact | undefined {
	const artifact = job.artifacts.find((candidate) => candidate.id === id);
	if (artifact) assertInScope(job, artifact.kind, "read");
	return artifact;
}

/* ── Writes ────────────────────────────────────────────────────────────────── */

export function putJobArtifact(
	job: Pick<AgentJob, "projectId" | "artifacts">,
	kind: string,
	payload: unknown,
	producer: ArtifactProducer,
	options: { id?: string; status?: ArtifactStatus; inputRefs?: ArtifactRef[] } = {},
): PipelineArtifact {
	assertInScope(job, kind, "write");
	/* Inside a stage commit a write is progress until the stage completes: saved,
	 * reusable by this stage on re-entry, not ready for any other. The runner marks
	 * it complete with the cursor advance. */
	const scope = scopeOf(job);
	const status = options.status ?? (scope ? "in_progress" : "complete");
	// A write inside a stage records the context that stage began against.
	const context = scope?.context;
	const written = writeArtifact(pipelineArtifactKinds, job.artifacts, {
		kind,
		payload,
		producer,
		projectId: job.projectId,
		...options,
		status,
		...(context ? { context } : {}),
	});
	job.artifacts = written.artifacts;
	return written.artifact;
}

/** Drop every artifact of one kind — the only removal a run makes. */
export function dropJobArtifacts(job: Pick<AgentJob, "artifacts">, kind: string): void {
	assertInScope(job, kind, "write");
	job.artifacts = job.artifacts.filter((artifact) => artifact.kind !== kind);
}

/** Mark artifacts complete — the stage that wrote them completed (or failed and
 *  its writes are the project's latest state), or the run that left them in
 *  progress is gone. Status is lifecycle, not content: payload, hash and revision
 *  are unchanged. Without `ids`, every in-progress artifact the run holds. */
export function settleJobArtifacts(job: ArtifactRun, ids?: ReadonlySet<string>): void {
	job.artifacts = job.artifacts.map((artifact) =>
		artifact.status === "in_progress" && (!ids || ids.has(artifact.id))
			? { ...artifact, status: "complete" as const }
			: artifact,
	);
}

/** Who is producing right now. Inside a stage commit it is that stage, exactly;
 *  otherwise the tool the run is executing, or the run's own bookkeeping between
 *  steps, attributed as `agent`. */
export function currentProducer(job: Pick<AgentJob, "id" | "run" | "artifacts">): ArtifactProducer {
	const scope = scopeOf(job);
	if (scope) return stageProducer(job, scope.stage);
	return toolProducer(job, job.run?.pendingTool?.tool ?? "agent");
}

/** Take over an artifact as saved elsewhere (the Storyboard view's edit of the
 *  plan) — unchanged, keeping its revision and hash — in place of this run's
 *  artifact of the same kind. */
export function adoptJobArtifact(
	job: Pick<AgentJob, "artifacts">,
	artifact: PipelineArtifact,
): void {
	assertInScope(job, artifact.kind, "write");
	const index = job.artifacts.findIndex((existing) => existing.kind === artifact.kind);
	job.artifacts =
		index === -1
			? [...job.artifacts, artifact]
			: job.artifacts.map((existing, i) => (i === index ? artifact : existing));
}
