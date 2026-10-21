/* Plan-state leaf — the single source of truth for a job's planning artifacts:
 * the style bible and the story plan. Each lives as one artifact on the job,
 * rewritten through the artifact write path (new revision, new hash); the getters
 * read it back typed and the setters persist + emit it. Domain types are imported
 * type-only, so both the orchestrator and the flow services import these directly
 * (no runtime cycle). */
import { storyPlanArtifact, styleBibleArtifact } from "@maleo/shared";
import type { AgentJob, StoryPlanContext, StoryPlanPayload } from "./model.ts";
import type { StorySection } from "../../../lib/story.ts";

import { storyPlanTableRows } from "../../../lib/story.ts";
import { saveStyleBibleReference } from "../../../lib/agent-trace.ts";
import { planVerification } from "./evidence.ts";
import { currentProducer, jobArtifactsOfKind, putJobArtifact } from "./artifact-store.ts";
import { researchRefFor } from "./research-state.ts";

// ── Style bible ─────────────────────────────────────────────────────────────

export function getStyleBible(job: AgentJob): string | undefined {
	if (job.visualStyle?.trim()) return job.visualStyle.trim();
	return jobArtifactsOfKind(job, styleBibleArtifact)[0]?.payload.visualStyle;
}

export async function setStyleBible(
	job: AgentJob,
	visualStyle: string,
	source: "generated" | "style_ref",
	refUrl?: string,
): Promise<void> {
	const clean = visualStyle.replace(/\s+/g, " ").trim().slice(0, 600);
	if (!clean) return;
	job.visualStyle = clean;
	const artifact = putJobArtifact(
		job,
		styleBibleArtifact.kind,
		{ visualStyle: clean, source, refUrl },
		currentProducer(job),
	);
	job.events.push({ kind: "artifact", artifact });
	// Generated bibles become a durable project reference (note "Style bible");
	// style_ref just points at an image the user already has in the library.
	if (source === "generated") await saveStyleBibleReference(job, clean);
}

// ── Story plan ──────────────────────────────────────────────────────────────

export function getStoryPlan(job: AgentJob): StoryPlanPayload | null {
	const plan = jobArtifactsOfKind(job, storyPlanArtifact)[0]?.payload;
	/* A copy. Generation edits sections in place as it works; those edits reach the
	 * stored plan only through `setStoryPlan`, which re-hashes — never by mutating
	 * the stored payload under its old hash. `planKind` defaults on read: a plan
	 * persisted before it existed is a story. */
	return plan ? { ...structuredClone(plan), planKind: plan.planKind ?? "story" } : null;
}

// Context fields a re-save carries forward when the caller does not restate them,
// so a section edit does not drop what the planner decided about the whole story.
const CARRIED_CONTEXT = [
	"planningBrief",
	"factual",
	"visualStyle",
	"bible",
	"engagement",
	"arc",
	"frameDegraded",
	"explainerContract",
	"povLifecycle",
	"structure",
	"language",
	"plannedReferences",
	"referenceAliases",
	"directionBlocked",
	"directionFingerprint",
	"directionInputs",
	"clarification",
	"postResearchClarification",
	"needsDirection",
	"directionErrors",
	"generationState",
] as const satisfies ReadonlyArray<keyof StoryPlanContext>;

// Rewrite the plan artifact (single source of truth) and emit it so the client
// plan view updates.
export function setStoryPlan(
	job: AgentJob,
	targetSec: number,
	sections: StorySection[],
	emit = true,
	unverified?: boolean,
	context?: Omit<StoryPlanContext, "researchKey"> & { researchKey?: string | null },
): void {
	const prev = jobArtifactsOfKind(job, storyPlanArtifact)[0]?.payload;
	const currentCitationModel = sections.some(
		(s) => s.factual !== undefined || s.citationStatus !== undefined,
	);
	const derived = planVerification(sections);
	const verificationStatus = currentCitationModel
		? derived.status
		: unverified
			? "unverified"
			: prev?.verificationStatus;
	const carried = Object.fromEntries(
		CARRIED_CONTEXT.map((key) => [key, context?.[key] ?? prev?.[key]]),
	);
	const payload: StoryPlanPayload = {
		...carried,
		targetSec,
		sections,
		unverified: currentCitationModel
			? verificationStatus === "unverified"
			: verificationStatus
				? verificationStatus === "unverified"
				: (unverified ?? prev?.unverified),
		verificationStatus,
		citationCoverage: currentCitationModel ? derived.coverage : prev?.citationCoverage,
		// `null` clears the research key; absent context keeps the previous one.
		researchKey: context ? (context.researchKey ?? undefined) : prev?.researchKey,
		planKind: context?.planKind ?? prev?.planKind ?? "story",
	};
	/* A draft (context given) is grounded in the research the run holds now; a
	 * re-save keeps the reference it had, so an edit after "research again" does
	 * not claim grounding in sources the plan was never drafted from. */
	const inputRefs = context
		? researchRefFor(job, payload.factual ? payload.researchKey : undefined)
		: (jobArtifactsOfKind(job, storyPlanArtifact)[0]?.inputRefs ?? []);
	const artifact = putJobArtifact(job, storyPlanArtifact.kind, payload, currentProducer(job), {
		inputRefs,
	});
	if (emit) job.events.push({ kind: "artifact", artifact });
}

// ── Plan table ──────────────────────────────────────────────────────────────

export function emitPlanTable(job: AgentJob, sections: StorySection[], title: string): void {
	const artifact = putJobArtifact(
		job,
		"storyboard_table",
		{ title, rows: storyPlanTableRows(sections) },
		currentProducer(job),
	);
	job.events.push({ kind: "artifact", artifact });
}
