/* Every pipeline this product runs, in one place.
 *
 * A **pipeline** is a named stage order — `["plan", "scaffold"]`. It is declared
 * once, here, and is the same on every run.
 *
 * A **profile** (`FormatProfile`) is one run's instance of a pipeline: its stage
 * order plus the format facts that vary per run — target duration, unit
 * granularity, whether narration leads. `pipelineProfile()` below turns the first
 * into the second. The profile is what gets persisted on the run, which is why the
 * two names both survive: `run.profile` lives in job snapshots that predate this
 * file, so the field keeps its name while the declaration gets the accurate one.
 *
 * Before this file, a pipeline's stage order was a literal written at the call site
 * that ran it — four of them, each beside the stage bodies it had to agree with.
 * The three builders that looked authoritative were not: every caller overrode
 * their `stages`, and `videoProfile`'s default listed `motion` and `audio`, ids no
 * call site has ever registered. A declaration nothing reads cannot be wrong, which
 * is why it stayed wrong.
 *
 * These are the orders that actually run. Read top to bottom, this is what the
 * product does. */
import { pipelineArtifactKinds } from "@maleo/shared";
import {
	StageRegistrationError,
	type ContentType,
	type FormatProfile,
	type StageId,
	type StageRegistry,
	type UnitGranularity,
} from "./pipeline.ts";
import {
	APPLY_CONTRACT,
	FINALIZE_CONTRACT,
	PLAN_CONTRACT,
	STORY_SCAFFOLD_CONTRACT,
	validateTopology,
	type StageContract,
} from "./stage-contracts.ts";

interface PipelineShape {
	contentType: ContentType;
	narrationFirst: boolean;
	stages: readonly StageId[];
	/** The contract each stage in this pipeline implements. */
	contracts: Partial<Record<StageId, StageContract>>;
	/** Artifact kinds the pipeline starts from, supplied by an earlier run. */
	initialInputs: readonly string[];
}

/* `storyPlan` and `storyGenerate` are the two halves of a narrated video build,
 * split by the approval gate. Planning parks at `scaffold`; generating resumes
 * there. They are separate pipelines rather than one, because a resumed run must not
 * re-run the planning it already committed. */
const PIPELINES = {
	storyPlan: {
		contentType: "video",
		narrationFirst: true,
		stages: ["plan", "scaffold"],
		contracts: { plan: PLAN_CONTRACT, scaffold: STORY_SCAFFOLD_CONTRACT },
		initialInputs: [],
	},
	/* Generation resumes a plan an earlier run drafted and saved. */
	storyGenerate: {
		contentType: "video",
		narrationFirst: true,
		stages: ["scaffold"],
		contracts: { scaffold: STORY_SCAFFOLD_CONTRACT },
		initialInputs: ["story_plan"],
	},
	/* Applying an approved edit to existing work. Its content type comes from the
	 * project, so unit granularity and `narrationFirst` are supplied per run. */
	edit: {
		contentType: "video",
		narrationFirst: true,
		stages: ["apply", "finalize"],
		contracts: { apply: APPLY_CONTRACT, finalize: FINALIZE_CONTRACT },
		initialInputs: [],
	},
} as const satisfies Record<string, PipelineShape>;

export type PipelineName = keyof typeof PIPELINES;

export interface PipelineInput {
	targetSec?: number;
	/** Edit runs only: the project's content type decides unit granularity. */
	contentType?: ContentType;
	/** Video only. A non-narrated video plans in beats rather than sections. */
	narrated?: boolean;
}

const GRANULARITY_BY_CONTENT: Record<ContentType, UnitGranularity> = {
	image: "slide",
	text: "post",
	video: "section",
};

/** Instantiate a declared pipeline for one run: stage order plus format facts. */
export function pipelineProfile(name: PipelineName, input: PipelineInput = {}): FormatProfile {
	const shape = PIPELINES[name];
	const contentType = input.contentType ?? shape.contentType;
	const narrated = input.narrated ?? shape.narrationFirst;
	const granularity =
		contentType === "video"
			? // A non-narrated video is planned in beats; a narrated one in sections.
				narrated
				? "section"
				: "beat"
			: GRANULARITY_BY_CONTENT[contentType];
	return {
		contentType,
		targetSec: input.targetSec,
		granularity,
		narrationFirst: contentType === "video" ? narrated : false,
		/* No profile has ever asked for grounding up front. The frame decides inside
		 * the plan stage, and this flag only ever raises that decision — see
		 * `FormatProfile.researchFirst`. */
		researchFirst: false,
		stages: [...shape.stages],
	};
}

/** The stage order a pipeline declares, for validating a registry against it. */
export function pipelineStages(name: PipelineName): readonly StageId[] {
	return PIPELINES[name].stages;
}

/* Assert a registry implements everything its profile declares.
 *
 * `runPipeline` only resolves from the cursor onward, because a resumed run
 * registers just the stages it still owes. That is right for a resume and too weak
 * for a fresh start: a profile whose later stages are unimplemented would run, park
 * at its gate, and fail only once the operator approved — after the work that
 * mattered had already been paid for. A run starting from the top checks the whole
 * order here instead. */
export function assertRegistryCoversPipeline(
	registry: StageRegistry<never> | { get(id: StageId): unknown },
	name: PipelineName,
): void {
	const missing = PIPELINES[name].stages.filter((id) => !registry.get(id));
	if (missing.length) {
		throw new StageRegistrationError(
			`pipeline profile ${name} declares stage(s) ${missing.join(", ")} that nothing implements`,
		);
	}
}

export const PIPELINE_NAMES = [
	"storyPlan",
	"storyGenerate",
	"edit",
] as const satisfies readonly PipelineName[];

/* Listing the names by hand rather than asserting over `Object.keys` keeps the
 * assertion out, but it can go stale. This fails to compile if a profile is added
 * above without being listed here. */
type UnlistedPipeline = Exclude<PipelineName, (typeof PIPELINE_NAMES)[number]>;
const _everyPipelineIsListed: UnlistedPipeline extends never ? true : never = true;
void _everyPipelineIsListed;

/** Each pipeline's stages with the contract they implement, in order. */
export function pipelineContracts(
	name: PipelineName,
): Array<{ id: StageId; contract: StageContract }> {
	const shape: PipelineShape = PIPELINES[name];
	return shape.stages.map((id) => {
		const contract = shape.contracts[id];
		if (!contract)
			throw new StageRegistrationError(
				`pipeline profile ${name} declares stage ${id} with no contract`,
			);
		return { id, contract };
	});
}

/* Every declared pipeline's topology, checked when the definitions load: an
 * impossible pipeline fails here, before any run starts or anything is spent. */
for (const name of PIPELINE_NAMES) {
	validateTopology(
		name,
		pipelineContracts(name),
		PIPELINES[name].initialInputs,
		(kind) => pipelineArtifactKinds.get(kind)?.schemaVersion,
	);
}
