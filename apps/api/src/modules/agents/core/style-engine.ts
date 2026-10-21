/* Style-engine leaf — lock a project-wide visual style (reuse a chosen reference
 * image, a persisted style bible, or generate + persist one with a representative
 * "style board" frame). Composed entirely of leaves (plan-state, trace, visual-gen, agent-trace,
 * generation); domain types are imported type-only from the orchestrator, so both
 * the orchestrator and the flow services import these directly (no runtime cycle). */
import type { AgentJob, AgentScene } from "./model.ts";
import type { StyleLock } from "./types.ts";
import { getStyleBible, setStyleBible, getStoryPlan, setStoryPlan } from "./plan-state.ts";
import { emitToolCall } from "./trace.ts";
import { generateSceneFrame, lockedConstraintsFor } from "./visual-gen.ts";
import { generateStyleBible } from "../../../lib/content-generator.ts";
import {
	loadLockedStyleBible,
	loadStyleBibleReference,
	saveStyleBibleReference,
} from "../../../lib/agent-trace.ts";

// Ensure a visual style is locked before frame generation. Order: a chosen global
// reference image wins; else an already-locked bible on this job; else a bible
// persisted by an earlier job on the project; else generate one (traced) + render
// a style board. Returns { ok:false } only when generation is required and fails.
export async function ensureVisualStyle(job: AgentJob, brief: string): Promise<StyleLock> {
	if (job.styleImageUrl) {
		await setStyleBible(
			job,
			"Global style reference image selected; image generation uses it as the visual lock.",
			"style_ref",
			job.styleImageUrl,
		);
		return { ok: true };
	}
	const existing = getStyleBible(job);
	if (existing) return { ok: true, visualStyle: existing };
	/* A style bible the operator edited by hand wins over generating a new one.
	 * The bible is presented as an editable Visual material, so regenerating over it
	 * would discard writing someone did deliberately. Unlocking it is an explicit
	 * action in the materials drawer. */
	const locked = await loadLockedStyleBible(job.projectId);
	if (locked) {
		await setStyleBible(job, locked, "generated");
		return { ok: true, visualStyle: getStyleBible(job) };
	}
	// Reuse the bible persisted by an earlier job on this project (Reference
	// Library note) — keeps the look consistent across sessions and lets the
	// operator edit the note to steer style.
	const persisted = await loadStyleBibleReference(job.projectId);
	if (persisted) {
		await setStyleBible(job, persisted, "generated");
		return { ok: true, visualStyle: getStyleBible(job) };
	}
	let visualStyle: string | undefined;
	// Named for what it is, because `locked` above is the hand-edited style bible
	// — a different thing entirely.
	const constraints = await lockedConstraintsFor(job);
	const { note } = await emitToolCall(job, "generate_style", { brief }, async () => {
		visualStyle = await generateStyleBible(brief, constraints);
		const preview = visualStyle.length > 160 ? `${visualStyle.slice(0, 160)}...` : visualStyle;
		return { note: `Locked visual style: ${preview}`, effect: "asset" };
	});
	if (!visualStyle?.trim()) return { ok: false, note: `Style lock failed: ${note}` };
	await setStyleBible(job, visualStyle, "generated");
	await generateStyleBoard(job, visualStyle);
	return { ok: true, visualStyle };
}

// Render the text bible as one representative "style board" frame and attach it
// to the persisted style-bible reference — a thumbnail communicates the locked
// look far faster than a 45-word directive. Best-effort: emitToolCall swallows
// generation failures, and the text bible remains the actual prompt lock.
async function generateStyleBoard(job: AgentJob, visualStyle: string): Promise<void> {
	const boardScene: AgentScene = {
		name: "Style board",
		durationSec: 0,
		shot: "Wide Shot",
		move: "Static",
		transition: "cut",
		visual:
			"Style reference board — one cohesive representative frame demonstrating exactly the visual treatment in the style bible below. No text, no labels, no watermarks.",
		voiceover: "",
	};
	await emitToolCall(job, "generate_style_board", { visualStyle }, async () => {
		// visualStyle flows through styledScene so the bible lands in the prompt
		// the same way it does for real scene frames.
		const url = await generateSceneFrame(boardScene, "1:1", undefined, visualStyle, undefined, {
			workspace: job.workspace,
			projectId: job.projectId,
		});
		await saveStyleBibleReference(job, visualStyle, url);
		return { note: "Style board image generated", thumbs: [url], effect: "asset" };
	});
}

// Research + script only — NO assets. Explicit style retry: regenerate the style
// bible for a story plan and re-persist it, keeping the existing sections.
export async function retryLongformStyle(
	job: AgentJob,
	briefOverride?: string,
): Promise<{ note: string }> {
	const plan = getStoryPlan(job);
	if (!plan) return { note: "No story plan found — create a plan first." };
	if (job.styleImageUrl)
		return {
			note: "Global style reference is already selected; style-bible generation is skipped.",
		};
	const brief = (
		briefOverride ||
		plan.planningBrief ||
		job.brief ||
		plan.sections.map((s) => `${s.title}: ${s.narration || s.visualPrompt}`).join("\n")
	).trim();
	if (!brief.trim()) return { note: "No brief found for style generation." };
	const visualStyle = await generateStyleBible(brief);
	if (!visualStyle?.trim())
		return { note: "Style retry failed: style generator returned empty output." };
	// Explicit retry = new art direction - overwrite the persisted bible.
	await saveStyleBibleReference(job, visualStyle);
	setStoryPlan(
		job,
		plan.targetSec,
		plan.sections,
		true,
		plan.factual === true && plan.sections.some((s) => s.citationStatus === "unsupported"),
		{
			planningBrief: plan.planningBrief,
			factual: plan.factual,
			researchKey: plan.researchKey,
			visualStyle,
			engagement: plan.engagement,
			planKind: plan.planKind,
			explainerContract: plan.explainerContract,
			povLifecycle: plan.povLifecycle,
			structure: plan.structure,
			language: plan.language,
			plannedReferences: plan.plannedReferences,
		},
	);
	job.events.push({ kind: "storyboard_patch" });
	return {
		note: "Style locked. Existing plan kept; approve/generate will use the new visual style.",
	};
}
