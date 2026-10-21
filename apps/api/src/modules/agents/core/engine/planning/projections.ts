/* The read-only projections planning conditions may name. A definition sees the
 * run only through these: a fact is a value, a rule a yes or no. */
import { approvedPlanFor } from "../../approval-state.ts";
import { getStoryPlan } from "../../plan-state.ts";
import { runState } from "../../runtime/run-state.ts";
import { clarificationProvenance, storyClarificationEligible } from "../../story-clarification.ts";
import { planHasGeneratedWork } from "../../services/planning-steps.ts";
import type { Fact, Rule } from "../types.ts";
import { directionNeedsRouting } from "./operations.ts";

export const PLANNING_FACTS: readonly Fact[] = [
	{
		id: "run.approveAll",
		description: "The user answered Approve all earlier in this run.",
		read: ({ job }) => job.run?.approveAll === true,
	},
	{
		id: "job.styleImageUrl",
		description: "The style reference image the project selected, if any.",
		read: ({ job }) => job.styleImageUrl ?? null,
	},
	{
		id: "clarification.bypass",
		description: "How the pre-research questions were bypassed, if they were.",
		read: ({ job }) => clarificationProvenance(job)?.bypass ?? null,
	},
];

export const PLANNING_RULES: readonly Rule[] = [
	{
		id: "plan.approvedExists",
		description: "The project holds an approved story plan.",
		test: ({ job }) => {
			const plan = getStoryPlan(job);
			return Boolean(plan && approvedPlanFor(job, plan));
		},
	},
	{
		id: "direction.needsRouting",
		description: "Free-text direction is set and no explicit channel is.",
		test: ({ job }) => directionNeedsRouting(job.direction),
	},
	{
		id: "clarification.eligible",
		description: "The one pre-research question batch is still owed for this build.",
		test: ({ job }) =>
			storyClarificationEligible(job, {
				buildIntent: true,
				instruction: runState(job).instruction,
			}),
	},
	{
		id: "plan.hasGeneratedWork",
		description: "The plan already has generated or failed sections.",
		test: ({ job }) => planHasGeneratedWork(job),
	},
];
