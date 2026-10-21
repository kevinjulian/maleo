/* Stage contracts around a `call` node.
 *
 * A call that declares `contract: "plan"` runs its workflow as the plan stage:
 * writes are scoped to the contract's kinds and record the producer and the
 * context the stage began against (`withStageScope`); when the workflow
 * completes, its writes are settled complete and the contract's required outputs
 * are checked — unless the workflow ended through an `end` that declares it
 * produced nothing (planning that preserves generated work). A suspension leaves
 * its writes in progress for the resumed stage to finish.
 *
 * The plan stage also reports itself as it always has: the `plan_story` tool card
 * in chat and its trace row, opened and closed around each segment it runs. */
import { settleJobArtifacts, withStageScope } from "../artifact-store.ts";
import type { AgentJob } from "../model.ts";
import { snapshotDeclaredContext, type PipelineContextKey } from "../pipeline-context.ts";
import { runState } from "../runtime/run-state.ts";
import { PLAN_CONTRACT, type StageContract } from "../stage-contracts.ts";
import { emitToolCall } from "../trace.ts";
import { WorkflowNodeError, type EngineHost, type EngineResult } from "./engine.ts";

interface ContractSpec {
	stage: string;
	contract: StageContract;
	consumes: readonly PipelineContextKey[];
	/** The tool the stage is reported as in chat and the trace. */
	tool: string;
}

export const ENGINE_CONTRACTS: Readonly<Record<string, ContractSpec>> = {
	plan: {
		stage: "plan",
		contract: PLAN_CONTRACT,
		consumes: ["brief", "materials.story", "materials.voice", "materials.rules", "styleLock"],
		tool: "plan_story",
	},
};

export const ENGINE_CONTRACT_NAMES: readonly string[] = Object.keys(ENGINE_CONTRACTS);

function argsOf(input: unknown): Record<string, unknown> {
	const args =
		input !== null && typeof input === "object"
			? Object.getOwnPropertyDescriptor(input, "args")?.value
			: undefined;
	return args !== null && typeof args === "object" ? { ...args } : {};
}

async function settled(
	job: AgentJob,
	spec: ContractSpec,
	run: () => Promise<EngineResult>,
): Promise<EngineResult> {
	const kinds = new Set(
		[...spec.contract.requires, ...spec.contract.produces].map((entry) => entry.kind),
	);
	const revisions = new Map(job.artifacts.map((artifact) => [artifact.id, artifact.revision]));
	// Writes a suspended segment of this stage left in progress belong to it too.
	const heldOpen = new Set(
		job.artifacts
			.filter((artifact) => artifact.status === "in_progress" && kinds.has(artifact.kind))
			.map((artifact) => artifact.id),
	);
	const result = await withStageScope(
		job,
		spec.stage,
		kinds,
		snapshotDeclaredContext(job, spec.consumes),
		run,
	);
	if (result.status !== "completed") return result;
	const written = job.artifacts.filter(
		(artifact) => heldOpen.has(artifact.id) || revisions.get(artifact.id) !== artifact.revision,
	);
	settleJobArtifacts(job, new Set(written.map((artifact) => artifact.id)));
	if (result.outcome.unchanged || !result.outcome.ok) return result;
	const writtenKinds = new Set(written.map((artifact) => artifact.kind));
	const missing = spec.contract.produces
		.filter((production) => !production.optional && !writtenKinds.has(production.kind))
		.map((production) => production.kind);
	return missing.length
		? {
				status: "completed",
				outcome: {
					ok: false,
					note: `stage ${spec.stage} completed without producing ${missing.join(", ")}`,
				},
			}
		: result;
}

export function stageContracts(job: AgentJob): NonNullable<EngineHost["contract"]> {
	return async (name, _node, input, run) => {
		const spec = ENGINE_CONTRACTS[name];
		if (!spec) throw new Error(`unknown stage contract "${name}"`);
		const args = argsOf(input);
		const state = runState(job);
		state.transcript += `\nPipeline stage ${spec.stage} reads: ${spec.consumes.length ? spec.consumes.join(", ") : "nothing"}`;
		state.pendingTool = { tool: spec.tool, args };
		// The stage changes the job beyond editor commands: the run settles as generation output.
		state.jobWrites = true;
		let result: EngineResult | undefined;
		const reported = await emitToolCall(job, spec.tool, args, async () => {
			try {
				result = await settled(job, spec, run);
			} catch (error) {
				// The card names the operation's own failure, not the engine's wrapper of it.
				throw error instanceof WorkflowNodeError && error.cause instanceof Error
					? error.cause
					: error;
			}
			if (result.status === "suspended")
				return {
					note: result.question.note ?? result.question.question,
					effect: "await" as const,
					suspended: true as const,
				};
			if (result.status === "cancelled")
				return { note: "This run was stopped.", effect: "note" as const };
			if (!result.outcome.ok) throw new Error(result.outcome.note);
			return { note: result.outcome.note, effect: "patch" as const };
		});
		if (!result || !reported.ok) {
			state.pendingTool = undefined;
			return { status: "completed", outcome: { ok: false, note: reported.note } };
		}
		if (result.status !== "completed") return result;
		state.pendingTool = undefined;
		if (!result.outcome.unchanged) {
			job.events.push({ kind: "storyboard_patch" });
			state.transcript += `\nPipeline ${spec.stage}: ${spec.tool}(${JSON.stringify(args)}) -> ${result.outcome.note}`;
		}
		return result;
	};
}
