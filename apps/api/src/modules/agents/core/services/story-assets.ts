import { promptIdsFor } from "../prompt-definitions.ts";
/* Longform-assets service — the generation engine for a long-form piece: voice +
 * measure + image each section, expand toward the target length, then assemble
 * the timeline (scenes, voiceover/music/accent overlays, chapter titles).
 * Also the single-section regenerate/improve flows.
 *
 * Pure flows over the AgentJob: every collaborator (frame gen, ref resolution,
 * retry, overlay builders, plan-state, persistence, notes, style-lock) is a
 * directly-imported leaf, so the flows take just (job, …) — no injected deps. The
 * only orchestrator dependency is type-only (AgentJob), so there is no cycle. */
import { recordGenerationBatch, recordTimelineDocument } from "../generation-state.ts";
import type { StoryApprovedSnapshot } from "@maleo/shared";
import { approvedPlanFor, NOT_APPROVED_NOTE } from "../approval-state.ts";
import { approvalFor, type StoryInputs } from "../story-inputs.ts";

import type { AgentJob, AgentAudioOverlay, AgentTextOverlay } from "../model.ts";
import type { ToolResult } from "../types.ts";
import type {
	BeatVisualIntent,
	StoryBible,
	StoryPlannedReference,
	StoryPlannedReferenceDefinition,
	TtsProviderId,
} from "@maleo/shared";
import {
	bindingIdentity,
	buildStoryBeatIntent,
	materializedEntityId,
	onlyStoredInfographicDirectionErrors,
	storyEditorialDecisionSchema,
	recordMaterializedReference,
	replaceStoryDraft,
	stableInputHash,
	storyBeatCoverageError,
	storyBeatCoverageViolations,
	storyFrameInputHash,
	storySequenceDirectionViolations,
	storySpeechInputHash,
	storyVisualInputHash,
} from "@maleo/shared";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveStockAudioCue, resolveStockAudioPool } from "@maleo/stock";
import { getContentProject } from "@maleo/db/project-detail";
import { getContentTimelineTemplate } from "@maleo/db/timeline-templates";
import {
	buildStoryAccentHits,
	buildStoryAudioOverlays,
	buildStoryMusicBed,
	buildStorySceneAccentHits,
	buildStoryScenes,
	buildStoryTitleOverlays,
	buildStoryVisualSegments,
	invalidateEstimatedVoiceWindows,
	storyTotalDurationSec,
	measureAudioDurationSec,
	narrationBoundaryAfter,
	narrationSegmentsForShots,
	placeSections,
	planNarrationSynthesis,
	splitStoryVoiceSegments,
	splitNarrationForResynthesis,
	wordBudgetForTarget,
	type StoryMusicSpan,
	type StorySection,
	type StoryVoiceSegment,
	type NarrationBoundary,
} from "../../../../lib/story.ts";
import {
	musicSpansFor,
	resolveMusicCueUrls,
	resolveMusicSpans,
} from "../../../../lib/story-music.ts";
import { probeAudioDurationSec } from "../../../../lib/audio-duration.ts";
import {
	approveCurrentStoryPlan,
	projectStoryboardSections,
} from "./storyboard-command-service.ts";
import { transcribeLocalWhisper } from "../../../../lib/local-whisper.ts";
import {
	planStorySections,
	type LockedVisualConstraints,
} from "../../../../lib/content-generator.ts";
import {
	authorStoryBeatVisuals,
	type StoryBeatVisual,
} from "../../../../lib/story/image-director.ts";
import { recordAssetProvenance } from "../../../../lib/agent-trace.ts";
import { synthesizeBilledTts } from "../../../../lib/generation/billed-tts.ts";
import { storeManagedMedia } from "../../../../lib/media-storage.ts";
import {
	generateSceneFrame,
	lockedConstraintsFor,
	projectRoster,
	resolveSceneRefImages,
	withRetry,
} from "../visual-gen.ts";
import { blockOnUnresolvedReferences, preflightProjectReferences } from "../reference-preflight.ts";
import {
	DEFAULT_TIMELINE_TEMPLATE,
	hasEnoughPovShotDiversity,
	mapWithConcurrency,
	repeatedAdjacentPovShotIndexes,
	resolveTimelineImageGuidance,
	resolveTimelineIntroTextPreset,
} from "@maleo/shared";
import { materializePlannedSections, researchForPlan } from "../evidence.ts";
import { getStoryPlan, setStoryPlan, emitPlanTable } from "../plan-state.ts";
import { persist } from "../persistence.ts";
import { authorSectionMotion, directedTextOverlays, directedTextSlots } from "./section-motion.ts";
import { emitToolCall, pushNote } from "../trace.ts";
import { ensureVisualStyle } from "../style-engine.ts";
import { canonicalReferencePrompt, upsertGeneratedReference } from "../generated-reference.ts";

export const STORY_ASSET_OPERATIONS = [
	{
		id: "operation:planning:direction",
		prompts: ["prompt:sequence:storySequenceDirectionPrompt"],
		label: "Direct story sequence",
		description:
			"Sequence direction used by the unmigrated asset refresh path; planning prompt links are derived separately from production calls.",
		source: "apps/api/src/lib/story/creative-director.ts",
	},
	{
		id: "operation:assets:references",
		prompts: [
			"prompt:references:canonicalReferencePrompt",
			"prompt:content:generateStyleBible",
			"prompt:constraints:lockedConstraintBlock",
		],
		label: "Prepare style and references",
		description:
			"Resolve approved references and style; refuse unresolved required references before paid work.",
		source: "apps/api/src/modules/agents/core/services/story-assets.ts",
		conditions: ["Materialize only approved missing reference roles."],
	},
	{
		id: "operation:assets:voice",
		label: "Generate narration",
		description:
			"Synthesize whole semantic voice files through the media worker; reuse matching input hashes.",
		source: "apps/api/src/modules/agents/core/services/story-assets.ts",
		repeat: "Per section and semantic narration segment",
		conditions: ["Skip compatible audio; regenerate stale or missing audio."],
	},
	{
		id: "operation:assets:measure",
		label: "Measure and partition",
		description:
			"Measure real audio and partition semantic voice/visual beats; captions use optional local transcription.",
		source: "apps/api/src/modules/agents/core/services/story-assets.ts",
		repeat: "Per accepted narration file",
		conditions: [
			"Re-synthesize smaller semantic units when measured voice exceeds the template limit.",
		],
	},
	{
		id: "operation:assets:visuals",
		prompts: [
			"prompt:beats:storyBeatVisualPrompt",
			"prompt:beats:closedListBlock",
			"prompt:constraints:lockedConstraintBlock",
		],
		label: "Author beat visuals",
		description:
			"Author one structured intent per measured beat using the Story Bible, approved shots, and Visual/Rules guidance.",
		source: "apps/api/src/lib/story/image-director.ts",
		repeat: "Per section; one intent per measured visual beat",
		conditions: [
			"Retry malformed or duplicate intents; never replace them with reused generic prose.",
		],
	},
	{
		id: "operation:assets:images",
		prompts: promptIdsFor("image", "codexImage"),
		label: "Compile and generate images",
		description:
			"Worker selects the provider, compiles supported reference wording, and submits images with durable identity.",
		source: "packages/media/src/generation/image-prompt.ts",
		repeat: "Per missing or stale visual beat",
		conditions: ["Reuse compatible images; retain successful assets after a sibling failure."],
	},
	{
		id: "operation:assets:timeline",
		label: "Assemble timeline",
		description:
			"Progressively assemble ready sections, semantic silence, voice, music/SFX, title and data overlays from measured timing.",
		source: "apps/api/src/modules/agents/core/services/story-assets.ts",
		output: ["timeline_document"],
	},
	{
		id: "operation:assets:extend",
		prompts: [
			"prompt:content:storyFramePrompt",
			"prompt:content:storyDraftPrompt",
			"prompt:content:storyEvidenceBlock",
			"prompt:constraints:lockedConstraintBlock",
		],
		label: "Check target duration",
		description: "Extend toward target duration within the bounded pass policy.",
		source: "apps/api/src/modules/agents/core/services/story-assets.ts",
		conditions: [
			"Only if measured output is short.",
			"Review policy proposes additions without generation; auto policy approves additions before generation.",
		],
		repeat: "At most 3 expansion passes",
	},
];

// ── Pure helpers ─────────────────────────────────────────────────────────────
function objectField(value: unknown, key: string): unknown {
	if (!value || typeof value !== "object") return undefined;
	return Object.entries(value).find(([entryKey]) => entryKey === key)?.[1];
}

// Opt-in section fan-out. Default 1 keeps the original strictly-sequential order
// (and thus the circuit-breaker's consecutive-failure semantics) unchanged; raise
// it only when the voice/image backend can serve concurrent sections.
function longformSectionConcurrency(): number {
	const raw = Number(process.env.MALEO_LONGFORM_SECTION_CONCURRENCY ?? "1");
	if (!Number.isFinite(raw)) return 1;
	return Math.max(1, Math.min(8, Math.floor(raw)));
}

/** The voice settings a synthesis call needs, taken off the job. */
interface VoiceContext {
	voice?: string;
	provider?: TtsProviderId;
	language?: string;
}

async function storyWorkspace(job: AgentJob): Promise<string | undefined> {
	return job.projectId
		? (await getContentProject(job.projectId))?.project.workspace
		: job.workspace?.trim();
}

interface StoryGenerationContext {
	sourceRevisionId: string;
	voice: VoiceContext;
	visualStyle?: string;
	bible?: StoryBible;
	direction?: AgentJob["direction"];
	locked: LockedVisualConstraints;
}

async function captureStoryGenerationContext(
	job: AgentJob,
	plan: NonNullable<ReturnType<typeof getStoryPlan>>,
	sourceRevisionId: string,
): Promise<StoryGenerationContext> {
	return {
		sourceRevisionId,
		voice: voiceCtx(job),
		visualStyle: plan.visualStyle,
		bible: plan.bible,
		direction: structuredClone(job.direction),
		locked: structuredClone(await lockedConstraintsFor(job)),
	};
}

function approvedStorySections(
	plan: NonNullable<ReturnType<typeof getStoryPlan>>,
	snapshot: StoryApprovedSnapshot,
): StorySection[] {
	return projectStoryboardSections(plan.sections, { ...plan.generationState!, draft: snapshot });
}

function withCurrentStoryDraft(job: AgentJob, generated: StorySection[]): StorySection[] {
	const state = getStoryPlan(job)?.generationState;
	return state ? projectStoryboardSections(generated, state) : generated;
}

/* `job.voiceProvider` used to be narrowed against the two provider names this
 * file knew. It is a registry id now, so there is nothing here to check it
 * against — and nothing that should. An id naming a retired provider resolves to
 * the default in `selectReadyProvider`, which is the behaviour a job stored
 * before a provider was removed needs; rejecting it here would break the job
 * instead. */
function voiceCtx(job: AgentJob): VoiceContext {
	return {
		voice: job.voice || undefined,
		provider: job.voiceProvider?.trim() || undefined,
		language: job.language || undefined,
	};
}

function templateTitleOverlays(job: AgentJob, sections: StorySection[]): AgentTextOverlay[] {
	const policy = timelinePolicy(job);
	// SAFETY: buildStoryTitleOverlays returns the shared overlay shape, which the
	// api mirrors as AgentTextOverlay; the widening is the module boundary, not a
	// claim about unchecked data.
	const titles = buildStoryTitleOverlays(sections, {
		pauseSec: policy.pauseSec,
		leadInSec: policy.leadInSec,
		introPreset: policy.introPreset,
		sectionPreset: policy.sectionPreset,
		policy: policy.titlePolicy,
		durationSec: policy.titleDurationSec,
	}) as AgentTextOverlay[];
	// Directed on-screen text: a motion composition where one is resolved, else plain.
	return [...titles, ...directedTextOverlays(job, directedTextSlots(sections, policy), titles)];
}

// Whoosh/stinger cue for section entries. A selected template resolves one asset,
// reused at every section. No selected template keeps legacy cue-pool fallback;
// STORY_ACCENT_URL pins one asset for local/dev runs.
const STORY_ACCENT_CUES = [
	"subtle transition stinger",
	"whoosh transition",
	"soft swoosh accent",
	"short cinematic riser",
] as const;
async function resolveStoryAccentUrls(templateCue?: string): Promise<string[]> {
	if (templateCue === "") return [];
	const pinned = process.env.STORY_ACCENT_URL;
	if (pinned) return [pinned];
	if (templateCue) {
		const hit = await resolveStockAudioCue("accent_hit", templateCue);
		return hit?.url ? [hit.url] : [];
	}
	const pool = await resolveStockAudioPool("accent_hit", STORY_ACCENT_CUES);
	return pool.map((p) => p.url);
}

/** Planning may wait for approval. Refresh the selected global template at the
 * generation boundary, then keep that snapshot stable for the whole asset pass. */
/** Load the timeline template the project has selected now; generation holds it
 *  for the whole pass. */
export async function refreshTimelineTemplateForGeneration(job: AgentJob): Promise<void> {
	const editorState = (await getContentProject(job.projectId))?.project.editor_state_json;
	const id = objectField(editorState?.settings, "timelineTemplateId");
	if (typeof id !== "string" || !id) return;
	const template = await getContentTimelineTemplate(id);
	if (template) job.timelineTemplate = template;
}

function timelinePolicy(job: AgentJob) {
	const template = job.timelineTemplate ?? DEFAULT_TIMELINE_TEMPLATE;
	return {
		entrySfxCue: template.introEntrySfx,
		entrySfxUrl: template.introEntrySfxUrl,
		sceneEntrySfxCue: template.sceneEntrySfx,
		sceneEntrySfxUrl: template.sceneEntrySfxUrl,
		sentenceVoiceoverPauseSec: template.sentenceVoiceoverPauseSec,
		sceneVoiceoverPauseSec: template.sceneVoiceoverPauseSec,
		maxVisualBeatSec: template.maxVisualBeatSec,
		maxVoiceoverSegmentSec: template.maxVoiceoverSegmentSec,
		pauseSec: template.sectionGapSec,
		leadInSec: template.introLeadInSec,
		sfxVolume: template.introEntrySfxVolume,
		sfxOffsetSec: template.introEntrySfxOffsetSec,
		titleDurationSec: template.introTitleDurationSec,
		titlePolicy: template.sectionTitlePolicy,
		introPreset: template.introTextPreset
			? resolveTimelineIntroTextPreset(template.introTextPreset)
			: "",
		sectionPreset: template.sectionTextPreset
			? resolveTimelineIntroTextPreset(template.sectionTextPreset)
			: "",
		staticSceneMovement: template.staticSceneMovement,
		sceneTransition: template.overrideSceneTransition ? template.sceneTransition : undefined,
		music: {
			musicCue: template.musicCue,
			musicUrl: template.musicUrl,
			musicPolicy: template.musicPolicy,
			musicEmotionCues: template.musicEmotionCues,
		},
		musicVolume: template.musicVolume,
	};
}

/** Background-music spans for the sections placed so far. One helper for both the
 *  full generation pass and single-section regeneration, so a regenerated timeline
 *  resolves its beds by exactly the same rules as a full rebuild. */
async function resolveMusicBedSpans(
	policy: ReturnType<typeof timelinePolicy>,
	ready: StorySection[],
): Promise<StoryMusicSpan[]> {
	return await resolveMusicSpans(policy.music, ready, process.env.LONGFORM_MUSIC_BED_URL);
}

const IMAGE_PROMPT_PLANNING_LABEL_RE =
	/(?:Narration beat|learningObjective|coreQuestion|misconception|conceptLadder|evidenceMoment|transferTakeaway|visualGrammar|teachingMove|chapterFunction|chapterObligation|viewerRole|worldSystem|socialOrder|bodyConstraints|sensoryModel|agencyLimits|survivalGoal|coreFear|tabooCost|transformationArc|endingFate|povLifecycle|povStage|povShot|cameraRole|bodyAction|emotionalPressure|noveltyKey)/;

export function imageOnlyPrompt(prompt: string): string {
	return prompt
		.replace(
			new RegExp(
				String.raw`(?:^|\n)\s*${IMAGE_PROMPT_PLANNING_LABEL_RE.source}\s*:\s*[^\n]*`,
				"gi",
			),
			"",
		)
		.replace(new RegExp(String.raw`\s+${IMAGE_PROMPT_PLANNING_LABEL_RE.source}\s*:\s*.*$`, "i"), "")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}

function rejectRepeatedPovShots(s: StorySection): boolean {
	if (!s.povShots?.length || hasEnoughPovShotDiversity(s.povShots)) return false;
	const repeated = repeatedAdjacentPovShotIndexes(s.povShots);
	s.status = "failed";
	s.error = repeated.length
		? `POV shot diversity failed: adjacent shots repeat camera/location/action at ${repeated.map((index) => index + 1).join(", ")}.`
		: "POV shot diversity failed: section needs more camera-role or detail-focus variety.";
	return true;
}

const storySectionKey = (section: StorySection): string => section.semanticBeatId ?? section.id;

/* The subject lexicon that used to live here is gone.
 *
 * `visualMomentForSegment`, `beeVisualMoment`, `BEE_POV_RE`,
 * `enforceBeePovNoHumanObserver`, `adaptStorySubjectStyleText`,
 * `positiveHumanSubjectFragments`, `storySubjectStyleConflictDetails` and
 * `compositionVariant` encoded one project's art direction as repository code —
 * ten hardcoded bee branches, a `stickman -> bee-scale anatomy` substitution
 * table, and a six-entry canned composition rotation. Everything they expressed
 * is expressible in `direction.visual`, `direction.rules` and
 * `lockedConstraintsFor(job)`, which are per-project and operator-authored, so
 * those channels are passed into per-beat authoring instead. A model told a
 * constraint up front can satisfy it; a regex applied afterwards can only
 * overwrite words.
 *
 * The composition rotation's only real function was making reused prompts look
 * distinct to the duplicate check. With one authored visual per beat there is
 * nothing left to disguise. */

/** A beat's intent as the prose the script table and editor still read, and the
 *  text the run records for a person.
 *
 *  Not the provider prompt — that is compiled from the intent's fields, in the
 *  media worker, after provider selection. This carries only what a reviewer needs
 *  to recognise the shot, and never the story constants, which are identical on
 *  every beat and would drown the difference between one beat and the next. */
export function renderBeatIntentProse(beat: BeatVisualIntent): string {
	return [
		beat.visualMoment,
		beat.action,
		[beat.shotType, beat.cameraAngle, beat.framing].filter(Boolean).join(", "),
	]
		.map((part) => part?.trim())
		.filter(Boolean)
		.join(". ");
}

/** Where the beat before this section's first beat left things.
 *
 *  Continuity crosses the section boundary because the viewer's does: a section's
 *  opening shot that ignores how the previous one ended is the seam this closes.
 *  Absent for the first section, and for a preceding section whose beats predate
 *  structured intent. */
function precedingEndState(job: AgentJob, s: StorySection): string | undefined {
	const sections = getStoryPlan(job)?.sections ?? [];
	const at = sections.findIndex((section) => storySectionKey(section) === storySectionKey(s));
	for (let i = at - 1; i >= 0; i--) {
		const beats = sections[i]?.visualSegments;
		const endState = beats?.[beats.length - 1]?.intent?.endState?.trim();
		if (endState) return endState;
	}
	return undefined;
}

/** The four counted invariants over a section's beats, run before any provider
 *  call. Marks the section failed and retryable, naming what was violated.
 *
 *  This replaces a check that ran on the fully composed provider string, after a
 *  per-beat index label had been added, so adjacent prompts always differed and
 *  the gate never fired once across every section in the database. Comparing
 *  structured fields is what makes "identical content" detectable at all: the
 *  rendered style block is now identical on every beat by design, so a string
 *  comparison would measure mostly the constant. */
function rejectFailedCoverage(
	s: StorySection,
	beats: ReadonlyArray<{ intent: BeatVisualIntent; text?: string }>,
	bible: StoryBible | undefined,
	plannedShots: readonly string[],
	references: {
		approvedBindings?: NonNullable<BeatVisualIntent["referenceBindings"]>;
		materializedByKey?: Readonly<Record<string, string>>;
		rosterEntityIds?: readonly string[];
	} = {},
): boolean {
	const violations = storyBeatCoverageViolations({ beats, bible, plannedShots, ...references });
	if (!violations.length) return false;
	s.status = "failed";
	s.error = `${storyBeatCoverageError(violations)}; image generation skipped before provider submission.`;
	return true;
}

export function authoredBeatInputs(
	segments: NonNullable<StorySection["visualSegments"]>,
): Array<{ intent: BeatVisualIntent; text: string }> {
	const missing = segments.findIndex((segment) => !segment.intent);
	if (missing >= 0)
		throw new Error(
			`Visual beat ${missing + 1} has no authored intent; image generation skipped before provider submission.`,
		);
	return segments.map((segment) => ({ intent: segment.intent!, text: segment.text }));
}

/** Re-cut a section's beats after a pacing change.
 *
 *  Authoring is a provider call and this runs synchronously over every section,
 *  so it does not author. When the beat count is unchanged the existing authored
 *  visuals still describe these beats and are carried across; when it changes,
 *  they describe a pacing that no longer exists, so the section drops back to
 *  `pending` and `processStorySection` authors a fresh visual per beat. */
function reflowSectionPacing(s: StorySection, policy: ReturnType<typeof timelinePolicy>): void {
	if (!s.audioUrl || !s.audioDurationSec) return;
	const sourceSegments = s.voiceSegments?.length
		? s.voiceSegments
		: [
				{
					text: s.narration,
					audioUrl: s.audioUrl,
					audioDurationSec: s.audioDurationSec,
					sourceDurationSec: s.audioDurationSec,
					mediaStartSec: 0,
					pauseAfterSec: 0,
					captionWords: s.captionWords,
				},
			];
	s.voiceSegments = splitStoryVoiceSegments(
		sourceSegments,
		policy.maxVoiceoverSegmentSec,
		policy.sceneVoiceoverPauseSec,
		policy.sentenceVoiceoverPauseSec,
	);
	s.sceneVoiceoverPauseSec = policy.sceneVoiceoverPauseSec;
	s.audioDurationSec = s.voiceSegments.reduce(
		(sum, segment) => sum + segment.audioDurationSec + Math.max(0, segment.pauseAfterSec ?? 0),
		0,
	);
	const beats = buildStoryVisualSegments(s.voiceSegments, policy.maxVisualBeatSec);
	/* A beat whose text survived the re-cut keeps its authored visual and the
	 * provenance that says what it was authored from — source beat, revision,
	 * input hash — so `processStorySection` can reuse it on a hash match instead
	 * of paying to author it again. Matching on text, not count: a pacing change
	 * that moves a boundary keeps the count but changes what the beat says. */
	const previous = s.visualSegments ?? [];
	const carried =
		beats.length === previous.length &&
		beats.every((beat, index) => beat.text === previous[index]!.text);
	s.visualSegments = carried
		? beats.map((beat, index) => {
				const { visualPrompt, intent, sourceBeatId, sourceRevisionId, inputHash } =
					previous[index]!;
				return {
					...beat,
					visualPrompt,
					...(intent ? { intent } : {}),
					sourceBeatId,
					sourceRevisionId,
					inputHash,
				};
			})
		: beats;
	const imageCount = s.imageUrls?.length ?? (s.imageUrl ? 1 : 0);
	if (
		imageCount < s.visualSegments.length ||
		s.visualSegments.some((beat) => !beat.visualPrompt.trim())
	)
		s.status = "pending";
}

async function resolveTemplateSfxUrls(exactUrl: string, cue: string): Promise<string[]> {
	return exactUrl ? [exactUrl] : resolveStoryAccentUrls(cue);
}

type DirectedAccentMap = Map<string, { cue: string; url: string }>;
type AccentPlacementPolicy = Pick<
	ReturnType<typeof timelinePolicy>,
	"entrySfxCue" | "pauseSec" | "leadInSec" | "sfxOffsetSec" | "sfxVolume"
>;

/** Undefined means legacy/template behavior. Map means sequence direction owns
 * section accents; missing entries are intentional silence. Exact template URL
 * remains authoritative. */
async function resolveDirectedAccents(
	sections: readonly StorySection[],
	policy: ReturnType<typeof timelinePolicy>,
): Promise<DirectedAccentMap | undefined> {
	if (policy.entrySfxUrl || !sections.some((section) => section.editorial)) return undefined;
	const entries = await Promise.all(
		sections.map(async (section) => {
			const cue = section.editorial?.sfxCue;
			if (!cue) return undefined;
			const hit = await resolveStockAudioCue("accent_hit", cue);
			return hit?.url ? ([storySectionKey(section), { cue, url: hit.url }] as const) : undefined;
		}),
	);
	return new Map(entries.filter((entry): entry is NonNullable<typeof entry> => Boolean(entry)));
}

export function plannedStoryAccentHits(
	sections: StorySection[],
	policy: AccentPlacementPolicy,
	templateUrls: string[],
	directed: DirectedAccentMap | undefined,
): AgentAudioOverlay[] {
	if (!directed)
		return buildStoryAccentHits(sections, templateUrls, {
			includeFirst: Boolean(policy.entrySfxCue),
			pauseSec: policy.pauseSec,
			leadInSec: policy.leadInSec,
			offsetSec: policy.sfxOffsetSec,
			volume: policy.sfxVolume,
		});
	const placeholder = directed.values().next().value?.url;
	if (!placeholder) return [];
	return buildStoryAccentHits(sections, placeholder, {
		includeFirst: true,
		pauseSec: policy.pauseSec,
		leadInSec: policy.leadInSec,
		offsetSec: policy.sfxOffsetSec,
		volume: policy.sfxVolume,
	}).flatMap((overlay, index) => {
		const resolved = directed.get(storySectionKey(sections[index]!));
		return resolved
			? [{ ...overlay, kind: "sfx" as const, content: resolved.cue, url: resolved.url }]
			: [];
	});
}

// Honest verdict against the ±5% tolerance — never report an out-of-tolerance
// result as a plain "Built story".
function longformResultNote(
	sectionCount: number,
	totalSec: number,
	target: number,
	failed: number,
): string {
	const lo = target * 0.95,
		hi = target * 1.05;
	const t = Math.round(totalSec),
		tg = Math.round(target);
	const verdict =
		totalSec < lo
			? `${Math.round(target - totalSec)}s UNDER target (couldn't reach length in 3 passes — edit/add sections)`
			: totalSec > hi
				? `${Math.round(totalSec - target)}s OVER target (sections run long — shorten narration)`
				: "within ±5% of target";
	return `Story: ${sectionCount} sections, ${t}s vs ${tg}s — ${verdict}${failed ? `; ${failed} section(s) failed (retry to fill)` : ""}.`;
}

function unique(values: readonly string[]): string[] {
	return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function materializedRefMap(
	refs: readonly StoryPlannedReference[] | undefined,
): Map<string, string> {
	const map = new Map<string, string>();
	for (const ref of refs ?? []) {
		if (ref.entityId && ref.status === "materialized") map.set(ref.key, ref.entityId);
	}
	return map;
}

function resolvedBeatReferenceIds(
	s: StorySection,
	index: number,
	plan: NonNullable<ReturnType<typeof getStoryPlan>>,
): string[] | undefined {
	const bindings = s.visualSegments?.[index]?.intent?.referenceBindings;
	if (bindings !== undefined) {
		return unique(
			bindings.flatMap((binding) => {
				if (binding.entityId) return [binding.entityId];
				const entityId = plan.generationState
					? materializedEntityId(plan.generationState, binding.plannedKey!)
					: undefined;
				return entityId ? [entityId] : [];
			}),
		);
	}
	return s.visualRefIds?.[index]?.length ? s.visualRefIds[index] : s.refIds;
}

/* What the frame digest records for a beat's references.
 *
 * The logical identity, never the entity a planned key resolved to: the approved
 * decision is "this beat shows THAT subject", and materializing — or
 * re-materializing after a failure — must not read as a different frame and
 * regenerate imagery the operator already approved and paid for. Legacy beats
 * without bindings keep hashing their resolved ids, which is all they have. */
function beatReferenceHashInput(s: StorySection, index: number): string[] | undefined {
	const bindings = s.visualSegments?.[index]?.intent?.referenceBindings;
	if (bindings !== undefined) return unique(bindings.map(bindingIdentity));
	return s.visualRefIds?.[index]?.length ? s.visualRefIds[index] : s.refIds;
}

function sectionsWithMaterializedRefs(
	sections: StorySection[],
	byKey: ReadonlyMap<string, string>,
): StorySection[] {
	const resolveKeys = (keys: readonly string[] | undefined): string[] =>
		unique((keys ?? []).map((key) => byKey.get(key) ?? ""));
	return sections.map((section) => {
		const refIds = resolveKeys(section.refKeys);
		const visualRefIds = section.visualRefKeys?.map(resolveKeys);
		return {
			...section,
			...(refIds.length ? { refIds } : {}),
			...(visualRefIds?.some((ids) => ids.length > 0) ? { visualRefIds } : {}),
		};
	});
}

async function materializeStoryReferences(
	job: AgentJob,
	plan: NonNullable<ReturnType<typeof getStoryPlan>>,
	snapshot: StoryApprovedSnapshot | undefined,
	toolCallId?: string,
): Promise<{ sections: StorySection[]; plannedReferences?: StoryPlannedReference[] }> {
	const directed = snapshot?.referenceAliases !== undefined;
	const definitions: readonly StoryPlannedReferenceDefinition[] = directed
		? (snapshot.plannedReferences ?? [])
		: (plan.plannedReferences ?? []);
	if (!definitions.length)
		return { sections: plan.sections, plannedReferences: plan.plannedReferences };
	let generationState = plan.generationState;
	const nextRefs: StoryPlannedReference[] = [];
	const failures: string[] = [];
	let changed = false;
	for (const ref of definitions) {
		const legacy = directed
			? undefined
			: plan.plannedReferences?.find((candidate) => candidate.key === ref.key);
		const existingEntityId =
			directed && generationState
				? materializedEntityId(generationState, ref.key)
				: legacy?.entityId;
		if (existingEntityId && (directed || legacy?.status === "materialized")) {
			if (legacy) nextRefs.push(legacy);
			continue;
		}
		if (ref.role === "product") {
			const error = "Product references must be user-selected or uploaded before generation.";
			if (legacy) nextRefs.push({ ...legacy, status: "failed" as const, error });
			failures.push(`${ref.label}: ${error}`);
			changed = true;
			continue;
		}
		try {
			pushNote(job, "References", `Creating ${ref.label}…`);
			const prompt = canonicalReferencePrompt(ref);
			const url = await withRetry(
				async () =>
					await generateSceneFrame(
						{
							name: ref.label,
							durationSec: 4,
							shot: "Reference",
							move: "Static",
							transition: "fade",
							visual: prompt,
							voiceover: "",
						},
						"1:1",
						job.styleImageUrl,
						plan.visualStyle,
						undefined,
						{ workspace: await storyWorkspace(job), projectId: job.projectId },
					),
			);
			const { entity } = await upsertGeneratedReference({
				projectId: job.projectId,
				key: ref.key,
				role: ref.role,
				label: ref.label,
				description: ref.description,
				canonicalImageUrl: url,
				visibilityMode: ref.visibilityMode,
				purpose: "story-reference",
			});
			/* Materialized, whatever the role.
			 *
			 * Character and location refs used to land on `status: "generated"` and a
			 * preflight below then refused to render until they were "approved" — but
			 * NOTHING in this repository could grant that approval. No route, no tool,
			 * no UI action wrote `materialized`; the only writer was this line. Worse,
			 * a retry did not skip them (only `materialized` refs are skipped), so
			 * every attempt regenerated the image, re-stamped `generated`, and threw
			 * again: an unclearable gate that spent an image generation per try.
			 *
			 * `generation-cast-selection` describes no such step. It says the preflight
			 * SHALL materialize every missing planned cast reference and that image
			 * generation receives entity ids — which is what this now does, for props
			 * and cast alike. If eyeballing generated cast art before use is wanted, it
			 * needs an affordance designed for it, not a throw with no exit. */
			if (directed)
				generationState = recordMaterializedReference(generationState!, ref.key, entity.id);
			else
				nextRefs.push({
					...legacy!,
					entityId: entity.id,
					status: "materialized" as const,
					error: undefined,
				});
			job.events.push({ kind: "asset_created", assetType: "image", url });
			if (toolCallId)
				await recordAssetProvenance(job, toolCallId, {
					assetType: "image",
					url,
					ref: `story-reference:${ref.key}`,
					prompt,
					model: job.styleImageUrl ? "image-service+styleref" : "image-service",
				});
			changed = true;
		} catch (err) {
			const error = err instanceof Error ? err.message : String(err);
			if (legacy) nextRefs.push({ ...legacy, status: "failed" as const, error });
			failures.push(`${ref.label}: ${error}`);
			changed = true;
		}
	}
	const byKey = directed
		? new Map(
				definitions.flatMap((ref) => {
					const entityId = generationState
						? materializedEntityId(generationState, ref.key)
						: undefined;
					return entityId ? [[ref.key, entityId] as const] : [];
				}),
			)
		: materializedRefMap(nextRefs);
	const sections = sectionsWithMaterializedRefs(plan.sections, byKey);
	if (changed || directed) {
		setStoryPlan(
			job,
			plan.targetSec,
			sections,
			true,
			plan.factual === true && sections.some((s) => s.citationStatus === "unsupported"),
			{
				...plan,
				plannedReferences: directed ? plan.plannedReferences : nextRefs,
				generationState,
			},
		);
		await persist(job);
	}
	if (failures.length > 0) {
		throw new Error(`Story reference materialization failed — ${failures.join("; ")}`);
	}
	/* No approval gate here. A preflight may only block on something the operator
	 * can actually resolve — a failed materialization is retryable and reported
	 * above; a reference awaiting an approval that no surface can give is not. */
	return { sections, plannedReferences: directed ? plan.plannedReferences : nextRefs };
}

// ── Per-beat visual authoring ───────────────────────────────────────────────

/** The planned shots as authoring INTENT: what the operator approved the section
 *  should show. They stay visible in plan review and are never the provider-facing
 *  prompt.
 *
 *  The POV grammar used to be flattened into a parenthetical here and appended to
 *  each shot's prose. It no longer is: `povShot` travels to authoring on the beat
 *  it belongs to, and reaches the provider through `composition`. Flattening
 *  structured data to prose and then parsing intent back out of it was the round
 *  trip this change exists to remove. */
function plannedShotIntent(s: StorySection): string[] {
	return [
		...new Set(
			[
				s.editorial?.visualConcept,
				...(s.visualPrompts?.length ? s.visualPrompts : [s.visualPrompt]),
			]
				.filter((prompt): prompt is string => Boolean(prompt))
				.map(imageOnlyPrompt),
		),
	];
}

async function authorSectionBeatVisuals(
	job: AgentJob,
	s: StorySection,
	beats: readonly NonNullable<StorySection["visualSegments"]>[number][],
	context: StoryGenerationContext,
	previousEndState: string | undefined,
): Promise<StoryBeatVisual[]> {
	const plannedShots = plannedShotIntent(s);
	const approvedBindings = [
		...new Map(
			(s.editorial?.shots ?? [])
				.flatMap((shot) => shot.bindings)
				.map((binding) => [bindingIdentity(binding), binding]),
		).values(),
	];
	let authored: StoryBeatVisual[] | undefined;
	const { note } = await emitToolCall(
		job,
		"author_beat_visuals",
		{
			sectionId: s.sectionId ?? s.id,
			title: s.title,
			beats: beats.length,
			plannedShots: plannedShots.length,
		},
		async () => {
			authored = await authorStoryBeatVisuals(
				{ title: s.title, narration: s.narration },
				beats.map((beat) => ({
					text: beat.text,
					durationSec: beat.durationSec,
					povShot: beat.povShot,
				})),
				{
					plannedShots,
					...(s.editorial?.shots ? { approvedBindings } : {}),
					editorial: s.editorial,
					locked: context.locked,
					visual: context.direction?.visual,
					rules: context.direction?.rules,
					style: context.visualStyle,
					bible: context.bible,
					previousEndState,
					language: context.voice.language,
				},
			);
			return {
				note: `Authored ${authored.length} visual${authored.length === 1 ? "" : "s"} for "${s.title}" across ${beats.length} measured beat${beats.length === 1 ? "" : "s"}.`,
			};
		},
	);
	if (!authored) throw new Error(note.replace(/^error:\s*/, ""));
	return authored;
}

// ── Section worker ──────────────────────────────────────────────────────────

// Voice → measure REAL duration → image. A section is "ready" ONLY when BOTH
// audio is measured AND an image exists; an image (or audio) failure marks the
// section "failed" (kept + retryable) and excludes it from the timeline until it
// succeeds. Retries reuse whatever already succeeded (no re-voicing for an
// image-only retry). Timing is exact (WAV header, else ffprobe). Persisted live.
async function processStorySection(
	job: AgentJob,
	s: StorySection,
	label: string,
	toolCallId: string | undefined,
	captured: StoryGenerationContext,
): Promise<void> {
	// The plan generation is settling — this pass's own output in progress.
	const activePlan = getStoryPlan(job);
	if (!activePlan) throw new Error("Story generation requires approved revision provenance.");
	const context = captured;
	const proseOnlyBeat =
		s.visualSegments?.findIndex((segment) => segment.visualPrompt.trim() && !segment.intent) ?? -1;
	if (proseOnlyBeat >= 0) {
		s.status = "failed";
		s.error = `Visual beat ${proseOnlyBeat + 1} has no authored intent; image generation skipped before provider submission.`;
		pushNote(job, label, s.error);
		return;
	}
	const approvedBindings = s.editorial?.shots
		? [
				...new Map(
					s.editorial.shots
						.flatMap((shot) => shot.bindings)
						.map((binding) => [bindingIdentity(binding), binding]),
				).values(),
			]
		: undefined;
	const referenceCoverage = approvedBindings
		? {
				approvedBindings,
				materializedByKey: activePlan?.generationState?.materialization?.byKey ?? {},
				rosterEntityIds: (await projectRoster(job.projectId)).map((entry) => entry.id),
			}
		: {};
	const detached = storyBeatCoverageViolations({ beats: [], ...referenceCoverage }).filter(
		(violation) => violation.invariant === "reference_detached",
	);
	if (detached.length) {
		s.status = "failed";
		s.error = `${storyBeatCoverageError(detached)}; revise story plan before generation.`;
		pushNote(job, label, s.error);
		return;
	}
	const { voice, provider, language } = context.voice;
	const basePrompts = (s.visualPrompts?.length ? s.visualPrompts : [s.visualPrompt]).map(
		imageOnlyPrompt,
	);
	const policy = timelinePolicy(job);
	const visualStyle = context.visualStyle;
	const sourceBeatId = s.semanticBeatId ?? s.id;
	const sourceRevisionId = context.sourceRevisionId;
	const speechHash = storySpeechInputHash({
		narration: s.narration,
		voice,
		provider,
		language,
		delivery: context.direction?.voice,
	});
	const editorialDirection = s.editorial ? JSON.stringify(s.editorial) : undefined;
	const visualHash = storyVisualInputHash({
		speechHash,
		visualPrompt: s.visualPrompt,
		plannedShots: basePrompts,
		referenceIds: s.refIds,
		style: visualStyle,
		visualDirection: context.direction?.visual,
		rules: context.direction?.rules,
		editorialDirection,
	});
	if (rejectRepeatedPovShots(s)) {
		pushNote(job, label, s.error ?? "POV shot diversity failed before image generation");
		return;
	}
	// Audio (skip if already measured — e.g. retrying only a failed image).
	if (!s.audioDurationSec || s.speechInputHash !== speechHash) {
		s.status = "voicing";
		const tempDir = await mkdtemp(join(tmpdir(), "maleo-story-audio-"));
		try {
			const workspace = await storyWorkspace(job);
			if (!workspace) throw new Error("story voiceover has no owning workspace");
			const texts = narrationSegmentsForShots(s.narration, basePrompts.length, s.shotCues);
			const segments: StoryVoiceSegment[] = [];
			const synthesizeSemanticUnit = async (
				text: string,
				depth = 0,
			): Promise<Array<{ segment: StoryVoiceSegment; boundaryAfter: NarrationBoundary }>> => {
				pushNote(job, label, `voiceover${depth ? " retry" : ""}…`);
				const { bytes, ext } = await withRetry(
					async () => await synthesizeBilledTts({ text, voice, provider, language, workspace }),
				);
				const name = `tts-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.${ext}`;
				const path = join(tempDir, name);
				await Bun.write(path, bytes);
				let durationSec = measureAudioDurationSec(bytes, ext);
				if (durationSec == null) durationSec = await probeAudioDurationSec(path);
				if (durationSec == null) {
					throw new Error("could not measure audio duration");
				}
				if (durationSec > policy.maxVoiceoverSegmentSec + 0.01) {
					const children =
						depth < 8
							? splitNarrationForResynthesis(text, durationSec, policy.maxVoiceoverSegmentSec)
							: [];
					if (children.length > 1) {
						pushNote(
							job,
							label,
							`${durationSec.toFixed(1)}s voiceover exceeds ${policy.maxVoiceoverSegmentSec.toFixed(1)}s — re-synthesizing ${children.length} semantic parts`,
						);
						const results: Array<{ segment: StoryVoiceSegment; boundaryAfter: NarrationBoundary }> =
							[];
						for (const child of children)
							results.push(...(await synthesizeSemanticUnit(child.text, depth + 1)));
						return results;
					}
					pushNote(
						job,
						label,
						`${durationSec.toFixed(1)}s voiceover cannot split further — kept whole and flagged`,
					);
				}
				let captionWords: StoryVoiceSegment["captionWords"];
				let captionProvenance: import("@maleo/shared").CaptionProvenance = {
					origin: "estimated",
					wordTimingOrigin: "estimated",
				};
				try {
					pushNote(job, label, "captions…");
					const aligned = await transcribeLocalWhisper({
						audioPath: path,
						language: job.language || "id",
						text,
					});
					if (aligned?.words.length) {
						captionWords = aligned.words;
						captionProvenance = {
							origin: "script-assisted",
							wordTimingOrigin: "script-assisted",
							engine: "whisper.cpp",
							model: aligned.model,
						};
					}
				} catch (err) {
					pushNote(
						job,
						label,
						`captions estimated — ${err instanceof Error ? err.message : String(err)}`,
					);
				}
				const contentType =
					ext === "mp3" ? "audio/mpeg" : ext === "m4a" ? "audio/mp4" : `audio/${ext}`;
				const audioUrl = await storeManagedMedia({
					workspace,
					project: job.projectId,
					kind: "audio",
					body: bytes,
					contentType,
					filename: `${s.id}-voice.${ext}`,
				});
				(job.generatedCaptionSources ??= {})[audioUrl] = {
					language: job.language || "id",
					provenance: captionProvenance,
				};
				job.events.push({ kind: "asset_created", assetType: "audio", url: audioUrl });
				if (toolCallId)
					await recordAssetProvenance(job, toolCallId, {
						assetType: "audio",
						url: audioUrl,
						ref: `${s.id}:voice`,
						prompt: text,
						model: voice ?? provider,
					});
				return [
					{
						segment: {
							text,
							audioUrl,
							audioDurationSec: durationSec,
							sourceDurationSec: durationSec,
							mediaStartSec: 0,
							pauseAfterSec: 0,
							captionWords,
							sourceBeatId,
							sourceRevisionId,
							inputHash: speechHash,
						},
						boundaryAfter: narrationBoundaryAfter(text),
					},
				];
			};
			for (let segmentIndex = 0; segmentIndex < texts.length; segmentIndex++) {
				const text = texts[segmentIndex]!;
				const plannedUnits = planNarrationSynthesis(text, policy.maxVoiceoverSegmentSec);
				const group: Array<{ segment: StoryVoiceSegment; boundaryAfter: NarrationBoundary }> = [];
				for (const unit of plannedUnits) group.push(...(await synthesizeSemanticUnit(unit.text)));
				for (let unitIndex = 0; unitIndex < group.length; unitIndex++) {
					const accepted = group[unitIndex]!;
					accepted.segment.pauseAfterSec =
						unitIndex < group.length - 1
							? accepted.boundaryAfter === "sentence"
								? policy.sentenceVoiceoverPauseSec
								: 0
							: segmentIndex < texts.length - 1
								? policy.sceneVoiceoverPauseSec
								: 0;
					segments.push(accepted.segment);
				}
			}
			const scenePause = Math.max(0, policy.sceneVoiceoverPauseSec);
			s.voiceSegments = segments;
			s.sceneVoiceoverPauseSec = scenePause;
			s.audioUrl = segments[0]?.audioUrl;
			s.audioDurationSec = segments.reduce(
				(sum, segment) => sum + segment.audioDurationSec + Math.max(0, segment.pauseAfterSec ?? 0),
				0,
			);
			s.speechInputHash = speechHash;
			s.captionSourceBeatId = sourceBeatId;
			s.captionSourceRevisionId = sourceRevisionId;
			s.captionInputHash = speechHash;
			s.error = undefined;
		} catch (err) {
			s.status = "failed";
			s.error = err instanceof Error ? err.message : String(err);
			pushNote(job, label, `voiceover failed — kept (retryable): ${s.error}`);
			return;
		} finally {
			await rm(tempDir, { recursive: true, force: true });
		}
	}
	if (s.voiceSegments?.length) {
		s.voiceSegments = splitStoryVoiceSegments(
			s.voiceSegments,
			policy.maxVoiceoverSegmentSec,
			policy.sceneVoiceoverPauseSec,
			policy.sentenceVoiceoverPauseSec,
		);
		s.audioUrl = s.voiceSegments[0]?.audioUrl;
		s.audioDurationSec = s.voiceSegments.reduce(
			(sum, segment) => sum + segment.audioDurationSec + Math.max(0, segment.pauseAfterSec ?? 0),
			0,
		);
		/* Beats first, visuals second. The beat count comes out of MEASURED audio at
		 * the template's `maxVisualBeatSec`, so it is an input to authoring — never a
		 * plan-time prediction that a smaller set of planned prompts then has to be
		 * spread across. Already-authored beats survive an image-only retry: the
		 * visuals still describe these beats, and re-authoring would repaint prompts
		 * for images that already exist. */
		const previous = s.visualSegments ?? [];
		const beats = buildStoryVisualSegments(s.voiceSegments, policy.maxVisualBeatSec);
		/* Reuse is decided by the input hash and the source beat, never by the
		 * approved revision: the revision is not a provider input, so a new revision
		 * that left this section's inputs alone must not repaint it. A reused beat
		 * keeps the revision it was authored under — that is where it came from. */
		const reusable =
			previous.length === beats.length &&
			previous.every(
				(beat) =>
					beat.intent &&
					beat.visualPrompt.trim() &&
					beat.inputHash === visualHash &&
					beat.sourceBeatId === sourceBeatId,
			);
		if (reusable) {
			s.visualSegments = beats.map((beat, index) => ({
				...beat,
				visualPrompt: previous[index]!.visualPrompt,
				...(previous[index]!.intent ? { intent: previous[index]!.intent } : {}),
				sourceBeatId,
				sourceRevisionId: previous[index]!.sourceRevisionId,
				inputHash: visualHash,
			}));
		} else {
			let authored: StoryBeatVisual[];
			try {
				authored = await authorSectionBeatVisuals(
					job,
					s,
					beats,
					context,
					precedingEndState(job, s),
				);
				/* The single authoring retry the coverage requirement has always
				 * specified and this pipeline never performed. It belongs here rather
				 * than at the pre-submission gate below because this is the only place
				 * a second pass is possible at all — by the gate the beats are already
				 * written, and reused beats have no authoring call to repeat.
				 * The gate stays the final guard; it now sees a section that had its
				 * retry. */
				const coverageInputs = (visuals: StoryBeatVisual[]) =>
					beats.map((beat, index) => ({ intent: visuals[index]!, text: beat.text }));
				if (
					storyBeatCoverageViolations({
						beats: coverageInputs(authored),
						bible: context.bible,
						plannedShots: basePrompts,
						...referenceCoverage,
					}).length > 0
				) {
					pushNote(job, label, "beat coverage violated — re-authoring once");
					authored = await authorSectionBeatVisuals(
						job,
						s,
						beats,
						context,
						precedingEndState(job, s),
					);
				}
			} catch (err) {
				// Loud, never silent. The alternative this replaced — reusing a planned
				// prompt across beats — shipped the same image twice and reported success.
				s.status = "failed";
				s.error = `Visual authoring failed — ${err instanceof Error ? err.message : String(err)}`;
				pushNote(job, label, `visual authoring failed — section kept (retryable): ${s.error}`);
				return;
			}
			/* `visualPrompt` is kept as the rendered mirror the script table and editor
			 * read; `intent` is what compilation uses. Writing both means a beat stays
			 * legible wherever prose was expected without the prose being what reaches
			 * the provider. */
			s.visualSegments = beats.map((beat, index) => ({
				...beat,
				visualPrompt: renderBeatIntentProse(authored[index]!),
				intent: authored[index]!,
				sourceBeatId,
				sourceRevisionId,
				inputHash: visualHash,
			}));
		}
		s.visualInputHash = visualHash;
	}
	if (!s.narration.trim()) {
		const previous = s.visualSegments ?? [];
		const reusable =
			previous.length === basePrompts.length &&
			previous.every(
				(beat) =>
					beat.intent && beat.inputHash === visualHash && beat.sourceBeatId === sourceBeatId,
			);
		if (!reusable) {
			const beats = basePrompts.map((prompt, index) => ({
				text: "",
				visualPrompt: prompt,
				durationSec: s.estimatedDurationSec ?? 0,
				voiceSegmentIndex: index,
			}));
			try {
				const authored = await authorSectionBeatVisuals(
					job,
					s,
					beats,
					context,
					precedingEndState(job, s),
				);
				s.visualSegments = beats.map((beat, index) => ({
					...beat,
					visualPrompt: renderBeatIntentProse(authored[index]!),
					intent: authored[index]!,
					sourceBeatId,
					sourceRevisionId,
					inputHash: visualHash,
				}));
			} catch (err) {
				s.status = "failed";
				s.error = `Visual authoring failed — ${err instanceof Error ? err.message : String(err)}`;
				pushNote(job, label, s.error);
				return;
			}
		}
	}
	// Images (a section needs at least one). A section can carry multiple ordered
	// shots that swap under its single voiceover; generate each missing one. The first
	// image is required — without it the section fails (kept, retryable). Later shots
	// degrade gracefully: if one fails after at least one succeeded, the section stays
	// ready with fewer images rather than dropping out of the timeline entirely.
	// Inject the project's style bible into every shot prompt so the look stays
	// consistent across sections (when no style reference image was chosen).
	const guidance = job.timelineTemplate?.imageGuidancePrompt
		? resolveTimelineImageGuidance(job.timelineTemplate.imageGuidancePrompt, {
				projectBrief: job.brief,
				sectionTitle: s.title,
				sectionNarration: s.narration,
			})
		: "";
	/* The VISUAL channel rides every image prompt (the "applied to every clip"
	 * effect, delivered through its own channel instead of the content brief), and
	 * Rules ride with it as hard constraints. `visualPromptLayers` owns the order so
	 * this stage and the shortform one cannot drift apart; the template guidance and
	 * style bible append after, being the project's own look rather than direction. */
	// The roster resolves `@mention` syntax in Visual materials, so the provider
	// prompt names a reference the way the reference map does instead of carrying
	// the editor's `@` through to an image model.
	const roster = await projectRoster(job.projectId);
	const beatSegments: NonNullable<StorySection["visualSegments"]> = s.visualSegments?.length
		? s.visualSegments
		: basePrompts.map((prompt) => ({
				text: s.narration,
				visualPrompt: prompt,
				durationSec: s.audioDurationSec ?? 0,
				voiceSegmentIndex: 0,
			}));
	/* One compiled intent per beat, from the Story Bible and the beat's fields.
	 *
	 * `finalPrompts` remains alongside it as the recorded, human-readable prompt —
	 * asset provenance and the run notes are read by people, and an intent object
	 * is not. The provider receives the intent; the ledger records the prose. */
	const bible = context.bible;
	let beatIntentInputs: ReturnType<typeof authoredBeatInputs>;
	try {
		beatIntentInputs = authoredBeatInputs(beatSegments);
	} catch (err) {
		s.status = "failed";
		s.error = err instanceof Error ? err.message : String(err);
		pushNote(job, label, s.error);
		return;
	}
	const beatIntents = beatIntentInputs.map((input) =>
		buildStoryBeatIntent({
			bible,
			beat: input.intent,
			aspect: job.aspect,
			visual: context.direction?.visual,
			rules: context.direction?.rules,
			guidance,
			roster,
		}),
	);
	/* What the RUN RECORDS for a person to read. Not the provider's prompt: that is
	 * compiled from the intent in the media worker, after provider selection, which
	 * is why the API cannot know its final text. Recording the beat's own mirror is
	 * honest about that; recording a composed string the provider never sees was
	 * not. */
	const finalPrompts = beatIntentInputs.map((input) => renderBeatIntentProse(input.intent));
	const frameReferenceIds = finalPrompts.map((_prompt, index) =>
		resolvedBeatReferenceIds(s, index, activePlan),
	);
	/* Hashed by logical identity, generated with resolved entity ids: the same beat
	 * must digest identically before and after its planned key materializes. */
	const frameReferenceHashIds = finalPrompts.map((_prompt, index) =>
		beatReferenceHashInput(s, index),
	);
	const frameHashes = finalPrompts.map((authoredVisual, index) =>
		storyFrameInputHash({
			speechHash,
			visualPrompt: s.visualPrompt,
			plannedShots: basePrompts,
			referenceIds: frameReferenceHashIds[index],
			style: visualStyle,
			visualDirection: context.direction?.visual,
			rules: context.direction?.rules,
			editorialDirection,
			authoredVisual,
		}),
	);
	const priorUrls = s.imageUrls?.length ? [...s.imageUrls] : s.imageUrl ? [s.imageUrl] : [];
	// Same rule as authored visuals: hash and source beat, not revision. Reused
	// frames keep the revision they were generated under.
	const reusableFrames =
		priorUrls.length === frameHashes.length &&
		frameHashes.every(
			(hash, index) =>
				s.imageInputHashes?.[index] === hash && s.imageSourceBeatIds?.[index] === sourceBeatId,
		);
	if (
		!reusableFrames &&
		rejectFailedCoverage(s, beatIntentInputs, bible, basePrompts, referenceCoverage)
	) {
		pushNote(job, label, s.error ?? "Beat coverage check failed");
		return;
	}
	const urls = reusableFrames ? priorUrls : [];
	if (urls.length < finalPrompts.length) {
		s.status = "imaging";
		for (let k = urls.length; k < finalPrompts.length; k++) {
			try {
				pushNote(
					job,
					label,
					finalPrompts.length > 1 ? `image ${k + 1}/${finalPrompts.length}…` : "image…",
				);
				const visualSegment = s.visualSegments?.[k];
				const voiceSegment = visualSegment
					? s.voiceSegments?.[visualSegment.voiceSegmentIndex]
					: s.voiceSegments?.[k];
				const beatIntent = beatIntents[k]!;
				const frameScene = {
					name: k === 0 ? s.title : `${s.title} · shot ${k + 1}`,
					durationSec:
						visualSegment?.durationSec ?? voiceSegment?.audioDurationSec ?? s.audioDurationSec!,
					// The camera the beat asked for. `"Medium Shot"` was hardcoded here,
					// so every story frame claimed the same distance from its subject no
					// matter what the planner's POV grammar said.
					shot: beatIntent.composition?.shotType || "Medium Shot",
					move: "Static",
					transition: "fade",
					visual: finalPrompts[k]!,
					voiceover: visualSegment?.text ?? voiceSegment?.text ?? s.narration,
					refIds: frameReferenceIds[k],
				};
				const refImgs = await resolveSceneRefImages(job, frameScene);
				const url = await withRetry(
					async () =>
						await generateSceneFrame(
							frameScene,
							job.aspect,
							job.styleImageUrl,
							undefined,
							refImgs,
							{ workspace: await storyWorkspace(job), projectId: job.projectId },
							{ intent: beatIntent },
						),
				);
				if (!url) throw new Error("image generation returned no url");
				urls.push(url);
				job.events.push({ kind: "asset_created", assetType: "image", url });
				if (toolCallId)
					await recordAssetProvenance(job, toolCallId, {
						assetType: "image",
						url,
						ref: `${s.id}:shot-${k + 1}`,
						prompt: finalPrompts[k]!,
						model: job.styleImageUrl ? "image-service+styleref" : "image-service",
					});
			} catch (err) {
				const msg = `image: ${err instanceof Error ? err.message : String(err)}`;
				if (urls.length === 0) {
					s.status = "failed";
					s.error = msg;
					pushNote(
						job,
						label,
						`image failed — section kept out of the timeline until it succeeds (retryable): ${msg}`,
					);
					return;
				}
				// Have at least one image: keep the section, stop adding shots.
				pushNote(job, label, `shot ${k + 1} failed — using ${urls.length} image(s): ${msg}`);
				break;
			}
		}
		s.imageUrls = urls;
		s.imageUrl = urls[0];
		s.imageSourceBeatIds = urls.map(() => sourceBeatId);
		s.imageSourceRevisionIds = urls.map(() => sourceRevisionId);
		s.imageInputHashes = frameHashes.slice(0, urls.length);
		s.frameSourceBeatId = sourceBeatId;
		s.frameSourceRevisionId = sourceRevisionId;
		s.frameInputHash = stableInputHash(["story-section-frames-v1", ...frameHashes]);
	}
	s.status = "ready";
	s.error = undefined;
}

// ── Single-section flows ────────────────────────────────────────────────────

// Re-voice + re-image ONE section, then reassemble so the downstream timeline
// resyncs from the new measured audio. Keeps every other ready section.
export async function regenerateLongformSectionFlow(
	job: AgentJob,
	index: number,
	inputs: StoryInputs,
	toolCallId?: string,
): Promise<{ note: string }> {
	const plan = inputs.plan;
	if (!plan) return { note: "No story plan yet — run plan_story first." };
	const approved = approvalFor(inputs, plan);
	if (!approved) throw new Error("Story generation requires approved revision provenance.");
	const i = Math.round(index);
	const s = plan.sections[i];
	if (!s) return { note: `No section at index ${index}.` };
	// A FAILED section is a retry: keep whatever already succeeded (don't throw away
	// valid audio just because the image failed) — processStorySection regenerates
	// only the missing piece. Any other status is a deliberate redo: clear both.
	if (s.status === "failed") {
		s.error = undefined;
		s.startSec = undefined;
	} else {
		s.audioUrl = undefined;
		s.audioDurationSec = undefined;
		s.voiceSegments = undefined;
		s.visualSegments = undefined;
		s.sceneVoiceoverPauseSec = undefined;
		s.captionWords = undefined;
		s.imageUrl = undefined;
		s.imageUrls = undefined;
		s.error = undefined;
		s.startSec = undefined;
	}
	s.status = "pending";
	setStoryPlan(job, plan.targetSec, plan.sections, false);
	await processStorySection(
		job,
		s,
		`Regenerate ${i + 1}: ${s.title}`,
		toolCallId,
		await captureStoryGenerationContext(job, plan, approved.payload.revisionId),
	);
	setStoryPlan(job, plan.targetSec, plan.sections);
	// Reassemble timeline from measured audio (resyncs all downstream starts).
	const ready = plan.sections.filter((x) => x.status === "ready");
	const policy = timelinePolicy(job);
	const placed = placeSections(ready, policy.pauseSec, policy.leadInSec);
	const byId = new Map(placed.map((x) => [storySectionKey(x), x]));
	const merged = plan.sections.map(
		(x) => byId.get(storySectionKey(x)) ?? { ...x, startSec: undefined },
	);
	setStoryPlan(job, plan.targetSec, merged); // persist resynced startSec
	const scenes = buildStoryScenes(ready, policy.pauseSec, policy.leadInSec, {
		staticMovement: policy.staticSceneMovement,
		transition: policy.sceneTransition,
	});
	job.scenes = scenes;
	const musicSpans = await resolveMusicBedSpans(policy, ready);
	const accentUrls = await resolveTemplateSfxUrls(policy.entrySfxUrl, policy.entrySfxCue);
	const sceneAccentUrls = await resolveTemplateSfxUrls(
		policy.sceneEntrySfxUrl,
		policy.sceneEntrySfxCue,
	);
	const directedAccents = await resolveDirectedAccents(ready, policy);
	const audioOverlays: AgentAudioOverlay[] = [
		...buildStoryAudioOverlays(ready, voiceCtx(job).voice, 1000, policy.pauseSec, policy.leadInSec),
		...buildStoryMusicBed(ready, musicSpans, {
			pauseSec: policy.pauseSec,
			leadInSec: policy.leadInSec,
			volume: policy.musicVolume,
		}),
		...plannedStoryAccentHits(ready, policy, accentUrls, directedAccents),
		...buildStorySceneAccentHits(
			scenes,
			policy.sceneEntrySfxUrl || !directedAccents ? sceneAccentUrls[0] : undefined,
			{ label: `Scene entry: ${policy.sceneEntrySfxCue}`, volume: policy.sfxVolume },
		),
	];
	job.audioOverlays = audioOverlays;
	job.textOverlays = templateTitleOverlays(job, ready);
	const totalSec = storyTotalDurationSec(ready, policy.pauseSec, policy.leadInSec);
	emitPlanTable(job, merged, `Story · ${Math.round(totalSec)}s · ${scenes.length} sections`);
	job.events.push({ kind: "storyboard_patch" });
	const regenerated = plan.sections.find(
		(section) => storySectionKey(section) === storySectionKey(s),
	);
	const done = regenerated?.status === "ready";
	return {
		note: done
			? `Regenerated section ${i + 1}; timeline resynced (${Math.round(totalSec)}s).`
			: `Section ${i + 1} regeneration failed (kept, retryable).`,
	};
}

export async function improveStorySectionFlow(
	job: AgentJob,
	index: number,
	inputs: StoryInputs,
	toolCallId?: string,
): Promise<{ note: string }> {
	const plan = inputs.plan;
	if (!plan) return { note: "No story plan yet — run plan_story first." };
	const i = Math.round(index);
	const s = plan.sections[i];
	if (!s) return { note: `No section at index ${index}.` };
	if (s.status === "failed" || !s.audioDurationSec || !s.imageUrl) {
		return regenerateLongformSectionFlow(job, i, inputs, toolCallId);
	}
	const prompts = (
		s.visualSegments?.length
			? s.visualSegments.map((segment) => segment.visualPrompt)
			: s.visualPrompts?.length
				? s.visualPrompts
				: [s.visualPrompt]
	).map(imageOnlyPrompt);
	const existing = s.imageUrls?.length ? [...s.imageUrls] : [s.imageUrl];
	const visualStyle = plan.visualStyle;
	const guidance = job.timelineTemplate?.imageGuidancePrompt
		? resolveTimelineImageGuidance(job.timelineTemplate.imageGuidancePrompt, {
				projectBrief: job.brief,
				sectionTitle: s.title,
				sectionNarration: s.narration,
			})
		: "";
	const styledPrompt = (p: string, oldUrl?: string): string =>
		[
			"Improve this section using the existing clip as continuity reference.",
			"Keep the same subject, timeline timing, and story intent; make the frame more engaging, clearer, and more dynamic.",
			oldUrl ? `Existing clip/reference: ${oldUrl}` : "",
			guidance ? `Timeline guidance: ${guidance}` : "",
			visualStyle ? `Style: ${visualStyle}` : "",
			`Visual: ${p}`,
		]
			.filter(Boolean)
			.join("\n");
	const nextUrls: string[] = [];
	let made = 0;
	s.status = "imaging";
	setStoryPlan(job, plan.targetSec, plan.sections, false);
	for (let k = 0; k < prompts.length; k++) {
		const oldUrl = existing[k] ?? existing[0];
		try {
			pushNote(
				job,
				`Improve ${i + 1}: ${s.title}`,
				prompts.length > 1 ? `image ${k + 1}/${prompts.length}…` : "image…",
			);
			const prompt = styledPrompt(prompts[k]!, oldUrl);
			const styleRef = oldUrl ?? job.styleImageUrl;
			const visualSegment = s.visualSegments?.[k];
			const refIds = resolvedBeatReferenceIds(s, k, plan);
			const refImgs = await resolveSceneRefImages(job, {
				name: k === 0 ? s.title : `${s.title} · shot ${k + 1}`,
				durationSec: visualSegment?.durationSec ?? s.audioDurationSec!,
				shot: "Medium Shot",
				move: "Static",
				transition: "fade",
				visual: prompt,
				voiceover: visualSegment?.text ?? s.narration,
				refIds,
			});
			const url = await withRetry(
				async () =>
					await generateSceneFrame(
						{
							name: k === 0 ? s.title : `${s.title} · shot ${k + 1}`,
							durationSec: visualSegment?.durationSec ?? s.audioDurationSec!,
							shot: "Medium Shot",
							move: "Static",
							transition: "fade",
							visual: prompt,
							voiceover: visualSegment?.text ?? s.narration,
							refIds,
						},
						job.aspect,
						styleRef,
						undefined,
						refImgs,
						{ workspace: await storyWorkspace(job), projectId: job.projectId },
					),
			);
			if (!url) throw new Error("image generation returned no url");
			nextUrls.push(url);
			made++;
			job.events.push({ kind: "asset_created", assetType: "image", url });
			if (toolCallId)
				await recordAssetProvenance(job, toolCallId, {
					assetType: "image",
					url,
					ref: `${s.id}:improve-shot-${k + 1}`,
					prompt,
					model: styleRef ? "image-service+styleref" : "image-service",
				});
		} catch (err) {
			pushNote(
				job,
				`Improve ${i + 1}: ${s.title}`,
				`image improve failed — kept existing clip: ${err instanceof Error ? err.message : String(err)}`,
			);
			nextUrls.push(oldUrl!);
		}
	}
	s.imageUrls = nextUrls.length ? nextUrls : existing;
	s.imageUrl = s.imageUrls[0];
	s.status = "ready";
	s.error = undefined;
	setStoryPlan(job, plan.targetSec, plan.sections);
	const ready = plan.sections.filter((x) => x.status === "ready");
	const policy = timelinePolicy(job);
	const placed = placeSections(ready, policy.pauseSec, policy.leadInSec);
	const byId = new Map(placed.map((x) => [storySectionKey(x), x]));
	const merged = plan.sections.map(
		(x) => byId.get(storySectionKey(x)) ?? { ...x, startSec: undefined },
	);
	setStoryPlan(job, plan.targetSec, merged);
	const scenes = buildStoryScenes(ready, policy.pauseSec, policy.leadInSec, {
		staticMovement: policy.staticSceneMovement,
		transition: policy.sceneTransition,
	});
	job.scenes = scenes;
	const musicSpans = await resolveMusicBedSpans(policy, ready);
	const accentUrls = await resolveTemplateSfxUrls(policy.entrySfxUrl, policy.entrySfxCue);
	const sceneAccentUrls = await resolveTemplateSfxUrls(
		policy.sceneEntrySfxUrl,
		policy.sceneEntrySfxCue,
	);
	const directedAccents = await resolveDirectedAccents(ready, policy);
	const audioOverlays: AgentAudioOverlay[] = [
		...buildStoryAudioOverlays(ready, voiceCtx(job).voice, 1000, policy.pauseSec, policy.leadInSec),
		...buildStoryMusicBed(ready, musicSpans, {
			pauseSec: policy.pauseSec,
			leadInSec: policy.leadInSec,
			volume: policy.musicVolume,
		}),
		...plannedStoryAccentHits(ready, policy, accentUrls, directedAccents),
		...buildStorySceneAccentHits(
			scenes,
			policy.sceneEntrySfxUrl || !directedAccents ? sceneAccentUrls[0] : undefined,
			{ label: `Scene entry: ${policy.sceneEntrySfxCue}`, volume: policy.sfxVolume },
		),
	];
	job.audioOverlays = audioOverlays;
	job.textOverlays = templateTitleOverlays(job, ready);
	const totalSec = storyTotalDurationSec(ready, policy.pauseSec, policy.leadInSec);
	emitPlanTable(job, merged, `Story · ${Math.round(totalSec)}s · ${scenes.length} sections`);
	job.events.push({ kind: "storyboard_patch" });
	return {
		note: made
			? `Improved section ${i + 1} using the existing clip as reference; timeline kept (${Math.round(totalSec)}s).`
			: `Could not improve section ${i + 1}; kept the existing clip.`,
	};
}

// ── Full-plan asset generation ──────────────────────────────────────────────

/** Plans stored before infographics were removed may hold an `infographic`
 * presentation and a motion graphic. Reading each beat through the schema maps
 * it to `narrative` and drops the graphic; narration, evidence, timing and
 * visual concepts stay unchanged. */
export function normalizeStoredInfographicDirection(
	sections: readonly StorySection[],
): StorySection[] {
	return sections.map((section) => {
		// SAFETY: a stored section may carry the removed key; widening to name it
		// claims nothing about the section's other fields.
		const { motionGraphic: _motionGraphic, ...rest } = section as StorySection & {
			motionGraphic?: unknown;
		};
		if (!rest.editorial) return rest;
		const read = storyEditorialDecisionSchema.safeParse(rest.editorial);
		return read.success ? { ...rest, editorial: read.data } : rest;
	});
}

// Generate assets for the approved plan: recheck every section and voice/measure/
// image only what is missing or stale against the approved inputs, expand toward
// the target within ±5% (max 3 passes, never silently short), then assemble the
// timeline from measured audio. Resumable: finished sections whose input hashes
// still match cost no provider call.
export async function generateStoryAssetsFlow(
	job: AgentJob,
	inputs: StoryInputs,
	toolCallId?: string,
): Promise<ToolResult> {
	let plan = inputs.plan;
	if (!plan) return { note: "No story plan yet — run plan_story first." };
	await refreshTimelineTemplateForGeneration(job);
	if (plan.needsDirection && onlyStoredInfographicDirectionErrors(plan.directionErrors)) {
		const normalized = normalizeStoredInfographicDirection(plan.sections);
		const violations = storySequenceDirectionViolations(
			normalized.map((section) => ({
				id: section.semanticBeatId ?? section.sectionId ?? section.id ?? "",
				editorial: section.editorial,
			})),
			{ requireDirection: true },
		);
		if (!violations.length) {
			setStoryPlan(job, plan.targetSec, normalized, true, undefined, {
				...plan,
				needsDirection: false,
				directionErrors: [],
			});
			plan = getStoryPlan(job)!;
		}
	}
	if (plan.needsDirection)
		return {
			note: `Story sequence direction needs review before approval or asset generation${plan.directionErrors?.[0] ? `: ${plan.directionErrors[0]}` : "."}`,
		};
	// Generation consumes the approved-plan artifact, never the live draft.
	const approved = approvalFor(inputs, plan);
	const approvedSnapshot = approved?.payload;
	if (!approved || !approvedSnapshot) return { note: NOT_APPROVED_NOTE };
	let sections = approvedStorySections(plan, approvedSnapshot);
	sections = normalizeStoredInfographicDirection(sections);
	const target = plan.targetSec;
	const planningBrief = plan.planningBrief ?? job.brief;
	if (!job.styleImageUrl && !plan.visualStyle) {
		const styleLock = await ensureVisualStyle(
			job,
			planningBrief || sections.map((s) => s.title).join("; "),
		);
		if (!styleLock.ok)
			return {
				note: `${styleLock.note ?? "Style lock failed."} Choose a global style reference or retry style generation before generating assets.`,
			};
		setStoryPlan(
			job,
			target,
			sections,
			true,
			plan.factual === true && sections.some((s) => s.citationStatus === "unsupported"),
			{
				planningBrief: plan.planningBrief,
				factual: plan.factual,
				researchKey: plan.researchKey,
				visualStyle: styleLock.visualStyle,
				engagement: plan.engagement,
				planKind: plan.planKind,
				explainerContract: plan.explainerContract,
				povLifecycle: plan.povLifecycle,
				structure: plan.structure,
				language: plan.language,
				plannedReferences: plan.plannedReferences,
			},
		);
	}
	try {
		const current = getStoryPlan(job) ?? plan;
		({ sections } = await materializeStoryReferences(
			job,
			{ ...plan, sections, visualStyle: current.visualStyle },
			approvedSnapshot,
			toolCallId,
		));
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		job.events.push({ kind: "error", message });
		return { note: message };
	}
	// Ahead of the voicing below: a longform run is the most expensive thing here,
	// and a cast it cannot render is a reason not to start it rather than a reason
	// to report afterwards. Run after story-reference materialization so generated
	// story refs are part of the roster check.
	const preflight = await preflightProjectReferences(job);
	if (!preflight.ok) return { note: blockOnUnresolvedReferences(job, preflight) };
	/* A plan persisted before the frame recorded a grounding decision carries no
	 * flag. It is treated as ungrounded — which is the state it is actually in —
	 * rather than re-deciding from the brief's words, which is the guess this
	 * pipeline no longer makes anywhere. */
	const factualPlan = plan.factual ?? false;
	const generationContext = await captureStoryGenerationContext(
		job,
		{ ...plan, sections, visualStyle: getStoryPlan(job)?.visualStyle ?? plan.visualStyle },
		approvedSnapshot.revisionId,
	);
	const lo = target * 0.95;
	const policy = timelinePolicy(job);
	// Background-music cues + boundary accent stinger for the whole piece, resolved
	// once up front (the resolver also caches). Covering every section, not just the
	// ready ones, keeps the synchronous assembleTimeline below off the network as
	// later sections land. An unresolved cue leaves its stretch silent.
	const musicCueUrls = await resolveMusicCueUrls(
		policy.music,
		sections,
		process.env.LONGFORM_MUSIC_BED_URL,
	);
	for (const section of sections) {
		if (invalidateEstimatedVoiceWindows(section))
			pushNote(
				job,
				section.title,
				"legacy estimated voice cuts found — re-voicing with whole semantic files",
			);
		else reflowSectionPacing(section, policy);
	}
	const accentUrls = await resolveTemplateSfxUrls(policy.entrySfxUrl, policy.entrySfxCue);
	const sceneAccentUrls = await resolveTemplateSfxUrls(
		policy.sceneEntrySfxUrl,
		policy.sceneEntrySfxCue,
	);
	const directedAccents = await resolveDirectedAccents(sections, policy);

	// Circuit breaker: when the voice/image backend is DOWN (vs a transient blip),
	// every section fails — and with per-asset retries that grind is slow enough to
	// look like an infinite "Revising…". After this many consecutive failures, stop
	// the whole run and report honestly instead of marching through every remaining
	// section (and expansion). A single success resets the counter.
	const CIRCUIT_FAIL_THRESHOLD = 3;
	let consecutiveFails = 0;
	let circuitTripped = false;

	// Rebuild the timeline (scenes + voiceover overlays) from the sections that are
	// ready SO FAR, and merge their resynced starts back into the full plan. Called
	// after each section completes so the editor fills progressively rather than only
	// at the very end. Returns the current measured total.
	const assembleTimeline = (emit = false): number => {
		const ready = sections.filter((s) => s.status === "ready");
		const placed = placeSections(ready, policy.pauseSec, policy.leadInSec);
		const byId = new Map(placed.map((s) => [storySectionKey(s), s]));
		const merged = sections.map(
			(s) => byId.get(storySectionKey(s)) ?? { ...s, startSec: undefined },
		);
		setStoryPlan(job, target, withCurrentStoryDraft(job, merged), emit);
		job.scenes = buildStoryScenes(ready, policy.pauseSec, policy.leadInSec, {
			staticMovement: policy.staticSceneMovement,
			transition: policy.sceneTransition,
		});
		const audioOverlays: AgentAudioOverlay[] = [
			...buildStoryAudioOverlays(
				ready,
				voiceCtx(job).voice,
				1000,
				policy.pauseSec,
				policy.leadInSec,
			),
			...buildStoryMusicBed(ready, musicSpansFor(policy.music, ready, musicCueUrls), {
				pauseSec: policy.pauseSec,
				leadInSec: policy.leadInSec,
				volume: policy.musicVolume,
			}),
			...plannedStoryAccentHits(ready, policy, accentUrls, directedAccents),
			...buildStorySceneAccentHits(
				job.scenes,
				policy.sceneEntrySfxUrl || !directedAccents ? sceneAccentUrls[0] : undefined,
				{ label: `Scene entry: ${policy.sceneEntrySfxCue}`, volume: policy.sfxVolume },
			),
		];
		job.audioOverlays = audioOverlays;
		// One animated title card per section boundary (chapter beats).
		job.textOverlays = templateTitleOverlays(job, ready);
		return storyTotalDurationSec(ready, policy.pauseSec, policy.leadInSec);
	};

	const runPending = async (
		subset: StorySection[],
		tag: string,
		context = generationContext,
	): Promise<void> => {
		// Recheck every section: exact hashes below reuse compatible outputs without
		// provider calls and regenerate only stale dependencies.
		const labelIndex = new Map<StorySection, number>(subset.map((s, i) => [s, i]));
		const pending = subset;
		// Bounded fan-out (default 1 = the original in-order sequential run). Post-frame
		// side effects (assembleTimeline / setStoryPlan / persist) are synchronous, so
		// a section that finishes runs its whole settle block atomically before another
		// worker's settle interleaves — no lock needed on the single-threaded loop.
		await mapWithConcurrency(pending, longformSectionConcurrency(), async (s) => {
			if (circuitTripped) return; // breaker already open — drain fast, launch no real work
			const i = labelIndex.get(s) ?? 0;
			await processStorySection(
				job,
				s,
				`${tag} ${i + 1}/${subset.length}: ${s.title}`,
				toolCallId,
				context,
			);
			if (s.status === "failed") {
				consecutiveFails++;
				if (consecutiveFails >= CIRCUIT_FAIL_THRESHOLD) {
					circuitTripped = true;
					pushNote(
						job,
						"Generation",
						`Stopped after ${consecutiveFails} sections failed in a row — the voice/image backend looks unavailable. Fix it and retry; any ready sections are kept.`,
					);
				}
			} else {
				consecutiveFails = 0;
			}
			// Section just became ready → grow the timeline now and tell the client to
			// refresh, so images/voiceovers appear in the editor as they finish. Either
			// way emit the plan so the card's per-section status updates live.
			// SAFETY: processStorySection mutates s.status in place, so the narrowed
			// type TS inferred at the top of this block is already stale; re-reading it
			// as the field's declared type is what makes the fresh value visible.
			if ((s.status as StorySection["status"]) === "ready") {
				assembleTimeline(true);
				job.events.push({ kind: "storyboard_patch" });
			} else {
				setStoryPlan(job, target, withCurrentStoryDraft(job, sections), true);
			}
			await persist(job); // live status + reload-safe
		});
	};

	/* Every section, not only the unfinished ones. A section marked ready can still
	 * be stale — an approved edit changed its narration or visual — and nothing
	 * else notices: `processStorySection` compares each stored input hash against
	 * the approved inputs, regenerates only what moved, and makes no provider call
	 * for a section whose hashes all match. Selecting by status alone left edited
	 * sections silently unregenerated. */
	await runPending(sections, "Section");
	let reviewExtensionPending = false;

	// Timeline length counts only fully-ready sections (audio + image).
	const readyTotal = (): number =>
		storyTotalDurationSec(
			sections.filter((s) => s.status === "ready"),
			policy.pauseSec,
			policy.leadInSec,
		);
	// Expansion to tolerance — never finish silently below 95% of target. Capped at
	// 3 passes. Skip entirely if the backend tripped the breaker or nothing is ready
	// (adding more sections to a down backend just prolongs a doomed run).
	for (let pass = 0; pass < 3 && !circuitTripped && readyTotal() > 0 && readyTotal() < lo; pass++) {
		const have = Math.round(readyTotal());
		pushNote(
			job,
			"Extending",
			`Measured ${have}s of ~${Math.round(target)}s — adding sections (pass ${pass + 1}/3)…`,
		);
		let more;
		try {
			const avoid = sections.map((s) => s.title).join("; ");
			const research = researchForPlan(inputs.research, plan);
			const evidence = research?.sources.length
				? {
						sources: research.sources.map((s) => ({
							url: s.url,
							title: s.title,
							excerpt: s.excerpt,
						})),
					}
				: undefined;
			({ sections: more } = await planStorySections(
				`${planningBrief}\n\nAlready covered (do NOT repeat): ${avoid}. Add deeper / follow-on sections to reach the target length.`,
				target - have,
				{
					wordBudget: wordBudgetForTarget(target - have),
					research: evidence,
					locked: await lockedConstraintsFor(job),
				},
			));
		} catch (err) {
			pushNote(
				job,
				"Extending",
				`expansion skipped: ${err instanceof Error ? err.message : String(err)}`,
			);
			break;
		}
		const research = researchForPlan(inputs.research, plan);
		const evidence = research?.sources.length
			? {
					sources: research.sources.map((s) => ({
						url: s.url,
						title: s.title,
						excerpt: s.excerpt,
					})),
				}
			: undefined;
		const extra = materializePlannedSections(more, sections.length, evidence, factualPlan);
		const extended = [...sections, ...extra];
		const current = getStoryPlan(job) ?? plan;
		const currentState = current.generationState!;
		const nextState = replaceStoryDraft(currentState, extended);
		setStoryPlan(job, target, extended, false, undefined, {
			...current,
			generationState: nextState,
		});
		if (approvedSnapshot.extensionPolicy === "review_additions") {
			sections = extended;
			reviewExtensionPending = true;
			await persist(job);
			break;
		}
		/* An extension can be refused — direction may have gone stale, or stopped on
		 * something only the operator can supply. Asserting non-null here threw
		 * `null is not an object` in the middle of a paid run; the additions simply
		 * stay unapproved and the already-generated sections stand. */
		const extension = await approveCurrentStoryPlan(
			job,
			"implicit_extension",
			"auto_approve_additions",
			approvedSnapshot.revisionId,
		);
		if (!extension.ok) {
			pushNote(
				job,
				"Story",
				`Extra sections were not approved — ${extension.message}. The approved sections are unaffected.`,
			);
			sections = extended;
			reviewExtensionPending = true;
			await persist(job);
			break;
		}
		const extensionPlan = getStoryPlan(job)!;
		sections = extensionPlan.sections;
		const addedSectionIds = new Set(extra.map((section) => section.sectionId ?? section.id));
		const approvedExtra = sections.filter((section) =>
			addedSectionIds.has(section.sectionId ?? section.id),
		);
		await runPending(
			approvedExtra,
			"Extra",
			await captureStoryGenerationContext(
				job,
				extensionPlan,
				extension.state.approvedSnapshot!.revisionId,
			),
		);
		if (extra.length === 0) break;
	}

	// Recovery pass: if some sections succeeded but others failed, the backend
	// demonstrably works now — failures were transient (flaky/down-then-recovered
	// mid-run). Re-run the failed ones once so an early outage doesn't permanently
	// drop them from the timeline (the symptom: "only the last section survived").
	if (!circuitTripped) {
		const anyReady = sections.some((s) => s.status === "ready");
		const failedSubset = sections.filter((s) => s.status === "failed");
		if (anyReady && failedSubset.length > 0) {
			pushNote(
				job,
				"Retry",
				`Backend recovered — re-running ${failedSubset.length} failed section(s).`,
			);
			consecutiveFails = 0;
			await runPending(failedSubset, "Retry");
		}
	}

	// Final assembly from all ready sections (same builder used progressively above),
	// then emit the plan table with the canonical statuses + resynced starts.
	let totalSec = assembleTimeline(true);
	// Motion for directed on-screen text, authored once the timing is final; any
	// section that gained a composition is placed by assembling again.
	const motionSlots = directedTextSlots(
		sections.filter((s) => s.status === "ready"),
		timelinePolicy(job),
	);
	if (await authorSectionMotion(job, motionSlots)) totalSec = assembleTimeline(true);
	const scenes = job.scenes;
	/* What this pass produced, against the approval it consumed — an extension
	 * approved mid-pass is the approval the plan now holds. Recorded whether or not
	 * anything came out ready: the failures are part of the record. */
	const generated = getStoryPlan(job);
	const batch = recordGenerationBatch(
		job,
		approvedPlanFor(job, generated) ?? approved,
		generated?.sections ?? sections,
	);
	if (scenes.length === 0) {
		return {
			note: circuitTripped
				? "Stopped early — the voice/image backend is unavailable (every section failed). Plan kept; fix the backend and retry."
				: "No sections are ready (voiceover/image generation unavailable). Plan kept — fix TTS/image config and retry.",
		};
	}
	recordTimelineDocument(job, batch, totalSec);
	const finalPlan = getStoryPlan(job);
	if (finalPlan)
		emitPlanTable(
			job,
			finalPlan.sections,
			`Story · ${Math.round(totalSec)}s · ${scenes.length} sections`,
		);
	job.events.push({ kind: "storyboard_patch" });
	const baseNote = longformResultNote(
		scenes.length,
		totalSec,
		target,
		sections.filter((s) => s.status === "failed").length,
	);
	const reviewNote = reviewExtensionPending
		? " Drafted duration additions; approve revised plan before generating their assets."
		: "";
	return {
		note: `${circuitTripped ? `${baseNote} Stopped early — backend looked unavailable after repeated failures; retry once it's back.` : baseNote}${reviewNote}`,
		thumbs: scenes.flatMap((scene) => (scene.image ? [scene.image] : [])),
		artifacts: [
			...scenes.flatMap((scene, index) =>
				scene.image
					? [{ kind: "image" as const, url: scene.image, logicalRef: `scene:${index}:visual` }]
					: [],
			),
			...job.audioOverlays.flatMap((clip, index) =>
				clip.url
					? [{ kind: "audio" as const, url: clip.url, logicalRef: `audio:${clip.id ?? index}` }]
					: [],
			),
		],
	};
}
