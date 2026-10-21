/* What each stage requires and produces, as artifact kinds.
 *
 * Declared once per stage kind, here, with no runtime dependencies, so both the
 * stage factories (`pipeline-stages.ts`) and the pipeline table
 * (`pipeline-definitions.ts`) read the same object: a stage cannot claim one
 * contract while its pipeline is validated against another.
 *
 * A requirement names the schema version it was written against. If a kind's
 * schema moves on, every pipeline that requires the old version fails at load,
 * before any stage runs, instead of a stage reading a payload it no longer
 * understands.
 *
 * Outputs were measured, not guessed: each declaration below is what the stage's
 * commit actually writes across the agent test suites. An optional output is one
 * the stage writes only in some runs — research only for a grounded brief, a
 * timeline only when a section came out ready. */
import type { StageId } from "./pipeline.ts";

export interface ArtifactRequirement {
	kind: string;
	/** The payload schema version this stage was written against. */
	schemaVersion: number;
	/** Read when the run holds it; its absence is not a failure. Topology does not
	 *  demand an earlier producer for it. */
	optional?: true;
	/** What to tell the operator when a required artifact is missing — the next
	 *  step, not the contract. */
	whenMissing?: string;
}

export interface ArtifactProduction {
	kind: string;
	/** Written only in some runs; absence is not a failure. */
	optional?: true;
}

export interface StageContract {
	requires: readonly ArtifactRequirement[];
	produces: readonly ArtifactProduction[];
}

/** Narrated video planning: frames, grounds and scripts the plan. Research runs
 *  inside this stage, so it is produced here, not required. */
export const PLAN_CONTRACT: StageContract = {
	requires: [],
	produces: [
		{ kind: "story_plan" },
		{ kind: "storyboard_table" },
		{ kind: "research_bundle", optional: true },
	],
};

/** Narrated video generation: approves the plan, generates its assets and writes
 *  the timeline. It rewrites the plan as sections settle. */
export const STORY_SCAFFOLD_CONTRACT: StageContract = {
	requires: [
		{
			kind: "story_plan",
			schemaVersion: 1,
			whenMissing: "No story plan yet — run plan_story first.",
		},
		/* A grounded plan's research: direction is refreshed against it before
		 * approval, and sections added to reach the target duration are drafted
		 * from it. */
		{ kind: "research_bundle", schemaVersion: 1, optional: true },
	],
	produces: [
		{ kind: "approved_plan" },
		{ kind: "generation_batch" },
		{ kind: "story_plan" },
		{ kind: "storyboard_table", optional: true },
		{ kind: "timeline_document", optional: true },
		{ kind: "style_bible", optional: true },
	],
};

/** Applying an approved edit to the project's work: a video section rewrites the plan. */
export const APPLY_CONTRACT: StageContract = {
	/* What an edit changes, resolved by the runner — whichever one the project
	 * holds — and a grounded plan's research, which a section edit redrafts against. */
	requires: [
		{ kind: "story_plan", schemaVersion: 1, optional: true },
		{ kind: "research_bundle", schemaVersion: 1, optional: true },
	],
	produces: [
		{ kind: "story_plan", optional: true },
		{ kind: "storyboard_table", optional: true },
	],
};

/** The artifact kind each edit tool changes. Scene edits change the timeline,
 *  which is the document rather than an artifact, so they name none. */
export const EDIT_TARGET_KIND: Readonly<Record<string, string>> = {
	update_section: "story_plan",
};

export const FINALIZE_CONTRACT: StageContract = { requires: [], produces: [] };

export class StageTopologyError extends Error {}

/* A pipeline's topology is valid when every kind a stage requires is produced by
 * an earlier stage or supplied as an initial input, and every requirement's
 * schema version is the version the kind is at now. Checked for every declared
 * pipeline when the definitions load. */
export function validateTopology(
	pipeline: string,
	stages: ReadonlyArray<{ id: StageId; contract: StageContract }>,
	initialInputs: readonly string[],
	schemaVersionOf: (kind: string) => number | undefined,
): void {
	const available = new Set(initialInputs);
	for (const { id, contract } of stages) {
		for (const requirement of contract.requires) {
			if (!available.has(requirement.kind)) {
				if (requirement.optional) continue;
				throw new StageTopologyError(
					`pipeline ${pipeline}: stage ${id} requires ${requirement.kind}, which no earlier stage produces and no initial input supplies`,
				);
			}
			const current = schemaVersionOf(requirement.kind);
			if (current !== requirement.schemaVersion) {
				throw new StageTopologyError(
					`pipeline ${pipeline}: stage ${id} requires ${requirement.kind}@${requirement.schemaVersion}, but the kind is at ${current ?? "no version"}`,
				);
			}
		}
		for (const production of contract.produces) available.add(production.kind);
	}
}
