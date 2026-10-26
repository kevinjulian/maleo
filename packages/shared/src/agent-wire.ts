import type { AudioAnimation } from "./clip-animation.ts";
import type { SourceAudioSettings } from "./processed-audio.ts";
import type {
	ClipLayout,
	ClipTextStyle,
	TemplateParams,
	SceneVisualClip,
} from "./timeline-model.ts";
/* The agent run contract — the wire format between the agent and the editor.
 *
 * This file is the ONE declaration of what a run sends. It used to be two: the
 * server's `apps/api/src/lib/agent/model.ts` and the browser's copy in
 * `create-content/api.ts`, each maintained by hand, with nothing forcing them to
 * agree. They mostly did — but `AgentAudioOverlay.originalDur` and `mediaStartSec`
 * were declared and sent by the server and absent from the client's copy, so the
 * editor's merge dropped them silently.
 *
 * Types only, no runtime: importing this pulls in no code and can never cycle.
 * The server's `AgentJob` (its in-flight run state) is NOT here — that is the
 * agent's private business, not part of the contract. */
import type { SceneInformation, SectionTransition } from "./video-blueprint.ts";
import type {
	ExplainerContract,
	ExplainerTeachingMove,
	PovLifecycle,
	PovShot,
	PovStage,
	StoryEngagement,
	StoryPlannedReference,
	StoryStructure,
	VideoPlanKind,
} from "./story-plan.ts";
import type { StoryArc } from "./story-arc.ts";
import type { StoryBible } from "./story-bible.ts";
import type { BeatVisualIntent } from "./beat-visual-intent.ts";
import type { AudioOrigin, AudioOverlayKind } from "./audio-overlays.ts";
import type { Emotion } from "./video-style.ts";
import type { PipelineArtifact } from "./pipeline-artifact.ts";
import type { AgentErrorInfo } from "./agent-errors.ts";
import type { StoryboardGenerationState } from "./storyboard-generation.ts";
import type {
	StoryClarificationBatch,
	StoryClarificationProvenance,
} from "./story-clarification.ts";
import type { StoryReferenceAlias, StoryReferenceBinding } from "./story-visual-direction.ts";

/** What a tool did, for the chat transcript's effect badge. */
export type ToolEffect = "note" | "patch" | "asset" | "proposal" | "await";

/** The route a run took, as the planner classified the instruction. */
export type Intent =
	| "build_short"
	| "build_story"
	| "edit_element"
	| "add_element"
	| "research"
	| "restyle"
	| "approve"
	| "ask_clarify"
	| "finish";

/** One aligned word from caption alignment. */
export interface CaptionWord {
	text: string;
	startSec: number;
	endSec: number;
}

/** A cited source backing a factual claim. */
export interface ResearchSource {
	title: string;
	url: string;
	excerpt: string;
	retrievedAt: string;
}

/* ── Story plan shapes ──
 *
 * The plan is an artifact the editor renders and edits, so its shapes are part of
 * the contract even though the generation logic that fills them stays in
 * `apps/api/src/lib/story.ts`. */

export interface SourceEvidence {
	url: string;
	quote: string;
}

export type CitationStatus = "verified" | "unsupported" | "not_required";

export type SectionStatus = "draft" | "pending" | "voicing" | "imaging" | "ready" | "failed";

export interface StoryVoiceSegment {
	text: string;
	audioUrl: string;
	audioDurationSec: number;
	/** Full measured source-file duration. Generated story voice clips play
	 * whole files, so this normally equals audioDurationSec. */
	sourceDurationSec?: number;
	/** In-point into audioUrl. New generated story voice clips always use 0;
	 * non-zero values remain readable for legacy projects. */
	mediaStartSec?: number;
	/** Frozen silence after this clip. Clause/technical splits stay continuous;
	 * sentence and planned narration boundaries receive template pauses. */
	pauseAfterSec?: number;
	captionWords?: Array<{ text: string; startSec: number; endSec: number }>;
	sourceBeatId?: string;
	sourceRevisionId?: string;
	inputHash?: string;
}

export interface StoryVisualSegment {
	text: string;
	/** Reviewer-facing mirror. Image compilation reads `intent`. */
	visualPrompt: string;
	/** Authoring output. Optional until beat authoring finishes; required to generate. */
	intent?: BeatVisualIntent;
	durationSec: number;
	voiceSegmentIndex: number;
	/** Structured POV visual grammar that explains how this shot differs from its
	 * neighbors. Planning/review metadata only; provider prompts receive prose. */
	povShot?: PovShot;
	/** Plan-local reference keys before materialization. */
	refKeys?: string[];
	/** Durable reference_entity ids after materialization. */
	refIds?: string[];
	sourceBeatId?: string;
	sourceRevisionId?: string;
	inputHash?: string;
}

export interface StorySection {
	/** Stable generation-unit id. For canonical plans this is semantic beat id. */
	id: string;
	/** Stable containing section/chapter id when it differs from generation-unit id. */
	sectionId?: string;
	/** Stable authored unit inside section; measured voice/visual segments remain
	 * separate descendants. */
	semanticBeatId?: string;
	locked?: boolean;
	title: string;
	narration: string;
	visualPrompt: string;
	/** Whole-sequence editorial decision approved before asset generation. */
	editorial?: import("./story-sequence-direction.ts").StoryEditorialDecision;
	/** Operator-attached references direction must bind in this semantic beat. */
	requiredReferences?: StoryReferenceBinding[];
	notes?: string;
	/** Factual claims / source notes captured during research-first planning. */
	sourceNotes?: string;
	/** Real cited source URLs (from a ResearchBundle) backing this section's
	 *  factual claims. Preferred over sourceNotes for factual output; sourceNotes
	 *  remains for migration / unverified drafts. */
	sourceUrls?: string[];
	/** Exact quotes validated against retrieved excerpts. */
	sourceEvidence?: SourceEvidence[];
	/** Whether this section makes factual claims and their citation state. */
	factual?: boolean;
	/** Felt tone of this section, emitted by the planner. Drives the background-music
	 *  cue when the selected timeline template uses per-emotion music. Absent on plans
	 *  created before emotions were recorded — those fall back to the template's
	 *  default cue. */
	emotion?: Emotion;
	/** Pedagogical role for explainer sections. Guides narration/visual planning;
	 *  provider prompts still receive only pixel-facing visual text. */
	teachingMove?: ExplainerTeachingMove;
	/** Lifecycle role of this section when the viewer inhabits a body/system. */
	povStage?: PovStage;
	/* This section's job in the plan's story arc, drawn from that arc's function
	 * vocabulary. The same field `povStage.chapterFunction` already was, promoted off
	 * the POV gate: a chapter function is the narrative job a section holds, and it is
	 * NOT the timeline chapter that contains it — chapter identity, ordering and
	 * ranges are still derived exactly as before. Absent on plans made before arcs. */
	chapterFunction?: string;
	/** What the arc says this section must DO, carried from the skeleton so a
	 *  reviewer sees the section's purpose beside its narration. */
	chapterObligation?: string;
	/** A skeleton slot whose draft never succeeded. It keeps its place in the plan
	 *  with empty narration rather than being dropped or filled with substitute text. */
	needsDrafting?: boolean;
	citationStatus?: CitationStatus;
	status?: SectionStatus;
	/** Planning-only estimate (word-count). Never used as final timing. */
	estimatedDurationSec: number;
	audioUrl?: string;
	speechInputHash?: string;
	/** Measured from the generated audio — the source of truth for timing. */
	audioDurationSec?: number;
	/** Scene-aligned TTS clips. Legacy sections keep one section-level audioUrl. */
	voiceSegments?: StoryVoiceSegment[];
	/** Independent narration-correlated visual beats. A voice segment may own one
	 * or several visuals depending on maxVisualBeatSec. */
	visualSegments?: StoryVisualSegment[];
	visualInputHash?: string;
	/** Silence inserted after each segment except the last. Frozen at generation. */
	sceneVoiceoverPauseSec?: number;
	/** Local word timings relative to the section audio start. Filled by local
	 *  Whisper alignment when available; omitted means captions fall back to estimate. */
	captionWords?: Array<{ text: string; startSec: number; endSec: number }>;
	captionSourceBeatId?: string;
	captionSourceRevisionId?: string;
	captionInputHash?: string;
	/** Ordered image prompts for this section (>=1). One voiceover spans them all;
	 *  each image fills a slice of the measured audio so the visual changes during a
	 *  long narration. Falls back to [visualPrompt] when absent (single-image). */
	visualPrompts?: string[];
	/** Plan-local reference keys used by this section before approval-time
	 *  materialization creates durable entity ids. */
	refKeys?: string[];
	/** Durable reference_entity ids used by this section after materialization. */
	refIds?: string[];
	/** Per-image prompt plan-local reference keys, parallel to visualPrompts. */
	visualRefKeys?: string[][];
	/** Per-image prompt durable reference ids, parallel to visualPrompts. */
	visualRefIds?: string[][];
	/** The narration phrase/sentence each shot illustrates (parallel to visualPrompts),
	 *  used to align shot durations to the narration's sentence groups instead of an
	 *  equal time split — so an image swaps when the narration reaches that beat. */
	shotCues?: string[];
	/** Per-image POV shot grammar, parallel to visualPrompts. */
	povShots?: PovShot[];
	/** Generated images, parallel to visualPrompts. imageUrl mirrors imageUrls[0]
	 *  for back-compat. */
	imageUrls?: string[];
	imageUrl?: string;
	imageSourceBeatIds?: string[];
	imageSourceRevisionIds?: string[];
	imageInputHashes?: string[];
	frameSourceBeatId?: string;
	frameSourceRevisionId?: string;
	frameInputHash?: string;
	/** Last generation error (when status === "failed"), shown in the plan view. */
	error?: string;
	/** Absolute timeline start, assigned by placeSections from measured audio. */
	startSec?: number;
}

// Narration word budget for a target duration. ~2.6 words/sec → ~1560 words for
// 10 min. Planning hint only; measured audio is the source of truth afterwards.

/* ── The run's output ── */

// Percent-based clip placement (mirrors the editor's ClipLayout). The agent can
// position any visual clip via set_clip_layout.
export type AgentClipLayout = Partial<ClipLayout>;

/* `key` is the slide's stable identity, carried through the run rather than
 * recomputed from position. A run that edits slide 2 has to be able to say WHICH
 * slide it edited, and "the second one" stops being true the moment the user
 * reorders while the run is working. Optional because a slide the model has just
 * invented has no key until one is minted for it. */
export interface AgentSlide {
	key?: string;
	name?: string;
	caption: string;
	visual: string;
	image?: string;
	refIds?: string[];
	noteIds?: string[];
}
export interface AgentPost {
	key?: string;
	body: string;
	image?: string;
}

export interface AgentScene {
	/* The editor's scene id, carried through the run like an overlay's. A command
	 * the agent executes names the clip `scene:<id>`, and that name has to be the
	 * editor's. Absent on a scene the agent created; the document mints one. */
	id?: number;
	/* Where the editor placed the scene. Carried for the same reason: a scene the
	 * user moved keeps its position through a run. Absent = laid out in sequence. */
	startSec?: number;
	track?: number;
	visualClips?: SceneVisualClip[];
	name: string;
	durationSec: number;
	/** Semantic visual-beat duration excluding structural section lead-in/gap. */
	contentDurationSec?: number;
	shot: string;
	move: string;
	transition: string;
	// True when the transition was explicitly chosen (model arg or user edit), so
	// the auto-transition resolver leaves it alone. Absent = auto-managed.
	transitionLocked?: boolean;
	visual: string;
	voiceover: string;
	action?: string;
	sfx?: string;
	image?: string;
	audioUrl?: string;
	layout?: AgentClipLayout;
	refIds?: string[];
	/** `false` opts this scene out of the project's reference selection, so only
	 *  `refIds` applies. Absent means opted in. Mirrors the editor's scene flag. */
	useGlobalReferences?: boolean;
	// Video Director blueprint fields the agent may assign when a style preset is
	// active. Stored loosely as strings; the client narrows them to its unions.
	beat?: string;
	emotion?: string;
	intent?: string;
	question?: string;
	claim?: string;
	evidence?: string;
	sourceEvidence?: Array<{ url: string; quote: string }>;
	analogy?: string;
	visualType?: string;
	onScreenText?: string;
	/** Partial on purpose. A blueprint-built transition carries every field, but a
	 *  scene round-tripping through the editor carries whatever the user left on
	 *  it — the editor's own `Scene.sectionTransition` is all-optional. The server
	 *  already reads this defensively (`sectionTransition?.text?.trim()`), so the
	 *  required-field version this used to declare was a claim neither side kept.
	 *  Unifying the two copies of the contract is what surfaced it. */
	sectionTransition?: Partial<SectionTransition>;
	/** Section-first provenance survives flattening into editor/render scenes. */
	sceneKind?: "section_intro" | "storyboard";
	sceneKey?: string;
	logicalSceneId?: string;
	sectionId?: string;
	storyBeatId?: string;
	sourceRevisionId?: string;
	storyboardSceneId?: string;
	imageSourceStoryboardSceneId?: string;
	editorialPatternId?: string;
	information?: SceneInformation;
}

export type AgentEvent =
	| { kind: "assistant_text"; text: string }
	| { kind: "thinking_started"; title: string }
	| { kind: "thinking_note"; title: string; body: string; elapsedSec: number }
	| { kind: "tool_call_started"; tool: string; args: Record<string, unknown> }
	| {
			kind: "tool_call_completed";
			tool: string;
			note: string;
			thumbs?: string[];
			effect?: ToolEffect;
			errorInfo?: AgentErrorInfo;
	  }
	| { kind: "asset_created"; assetType: "audio" | "image"; url: string }
	| { kind: "artifact"; artifact: PipelineArtifact }
	| { kind: "storyboard_patch" }
	| { kind: "workflow_progress"; plan: WorkflowPlan }
	| { kind: "outcome_evaluation"; evaluation: OutcomeEvaluation }
	| { kind: "error"; message: string; errorInfo?: AgentErrorInfo }
	// ask_user suspend: the run pauses and this surfaces the question + option
	// chips in chat. The user's reply resumes the same job (Design B).
	/* `freeText` marks a question whose real answer is typed prose rather than one
	 * of the chips — the rejected story-plan gate, where the next thing the operator
	 * writes is the revision to draft against. The composer routes that message to
	 * the answer route instead of starting a new run, which is what keeps a
	 * rejection inside pre-production. */
	/* `batch` carries the pre-research story clarification: one to three questions
	 * answered together in one card and one structured submission. A client that
	 * predates it still renders `question` + `options`, which stay populated with the
	 * batch's first question so an old client is degraded, not broken. */
	| {
			kind: "question";
			question: string;
			options?: { label: string; value: string }[];
			actionId?: string;
			freeText?: boolean;
			batch?: StoryClarificationBatch;
	  }
	| { kind: "final"; text: string };

// id/track are preserved verbatim when a clip is seeded from a saved storyboard,
// so a run never re-homes the user's clips to row 0 or breaks transition refs.
// Agent-created clips leave them undefined and get fresh ids at persist.
export interface AgentAudioOverlay extends SourceAudioSettings {
	animation?: AudioAnimation;
	id: number;
	kind: AudioOverlayKind;
	origin?: AudioOrigin;
	content: string;
	url: string;
	voice?: string;
	startSec: number;
	durationSec: number;
	track?: number;
	volume?: number;
	fadeIn?: number;
	fadeOut?: number;
	originalDur?: number;
	mediaStartSec?: number;
	words?: CaptionWord[];
	duckUnderVoice?: number;
	mediaAssetId?: string;
}
export interface AgentTextOverlay {
	id?: number;
	content: string;
	startSec: number;
	durationSec: number;
	preset?: string;
	style?: ClipTextStyle;
	params?: TemplateParams;
	layout?: AgentClipLayout;
	track?: number;
}
export interface AgentVideoOverlay {
	thumb?: string;
	sourceDurationSec?: number;
	volume?: number;
	mediaStartSec?: number;
	mediaAssetId?: string;
	id?: number;
	url: string;
	kind: "image" | "video";
	startSec: number;
	durationSec: number;
	label?: string;
	layout?: AgentClipLayout;
	track?: number;
}
/* `id` is the persisted reference_entity id. It exists so the client binds to a
 * durable identity instead of minting `char-${Date.now()}` on every apply — which
 * made the same character reappear under a new id whenever a settled job was
 * re-applied (a run, then a reload resuming it). */
export interface AgentCharacter {
	id?: string;
	name: string;
	description: string;
	image?: string;
}
export interface StoryboardTableRow {
	startSec: number;
	endSec: number;
	content: string;
	kind: "scene" | "voiceover" | "text" | "effect";
}
export type VerificationStatus = "verified" | "partial" | "unverified";
export type WorkflowRoute = "plan_story" | "edit_scene" | "react";
export type WorkflowStatus = "pending" | "running" | "done" | "blocked" | "failed" | "skipped";
export interface WorkflowPlanItem {
	id: string;
	label: string;
	status: WorkflowStatus;
	tool?: string;
	reason?: string;
}
export interface WorkflowPlan {
	id: string;
	title: string;
	route: WorkflowRoute;
	readonly: true;
	reason?: string;
	items: WorkflowPlanItem[];
}
export type OutcomeRequirementId =
	| "content_present"
	| "brief_coverage"
	| "visual_assets"
	| "target_duration"
	| "evidence"
	| "valid_timeline"
	| "viewer_attention";
export interface OutcomeRequirement {
	id: OutcomeRequirementId;
	label: string;
	blocking: boolean;
}
export interface OutcomeFixProposal {
	command: string;
	scope?: string;
	tool?: string;
	args?: Record<string, unknown>;
}
export interface OutcomeFinding {
	id: string;
	requirementId: OutcomeRequirementId;
	severity: "pass" | "info" | "warning" | "blocker";
	message: string;
	fix?: OutcomeFixProposal;
}
export interface OutcomeContract {
	schemaVersion: 1;
	objective: string;
	contentType: "video" | "image" | "text";
	intent?: Intent;
	audience?: string;
	platform?: string;
	format: string;
	targetDurationSec?: number;
	createdAt: number;
	requirements: OutcomeRequirement[];
}
export interface OutcomeEvaluation {
	schemaVersion: 1;
	contractSchemaVersion: 1;
	status: "passed" | "needs_attention" | "failed";
	score: number;
	evaluatedAt: number;
	findings: OutcomeFinding[];
	metrics: {
		durationSec?: number;
		durationErrorPct?: number;
		briefKeywordCoverage?: number;
		/* `visualRelevancePct` is deliberately absent. It was lexical token overlap
		 * between a brief-language objective and an English image prompt — structurally
		 * near-zero, recorded on zero runs, and no evidence of relevance either way.
		 * Evaluations written before it was removed may still carry the key; nothing
		 * reads it. */
		visualContinuityPct?: number;
		peakAttentionLoad?: number;
		overloadSeconds?: number;
		blockerCount: number;
		warningCount: number;
		findingCount: number;
	};
}
export interface GenerationBatchUnit {
	ref: string;
	status: "planned" | "running" | "completed" | "failed";
	startedAt?: number;
	finishedAt?: number;
	artifactUrl?: string;
	error?: string;
}
export interface GenerationBatch {
	id: string;
	kind: "scene_frames" | "slide_images" | "story_sections";
	status: "planned" | "running" | "completed" | "failed";
	concurrency: number;
	createdAt: number;
	units: GenerationBatchUnit[];
}
export interface StoryPlanContext {
	generationState?: StoryboardGenerationState;
	planningBrief?: string;
	factual?: boolean;
	researchKey?: string;
	// Project-wide visual style bible (era/palette/medium/lens/lighting/negatives),
	// generated from the brief when the user picked no style reference image. Injected
	// into every shot's image prompt so the look stays consistent across sections.
	//
	// Superseded by `bible` below, which records the same constants as fields rather
	// than as prose. Kept because persisted plans carry it and `bible.summary` is
	// where it now lives for display.
	visualStyle?: string;
	/** The story's visual constants as fields: subjects, locations, medium, lighting,
	 *  palette, camera language, negatives. Authored once here at plan time and
	 *  rendered identically into every beat's prompt, so a story's look cannot drift
	 *  between one beat and the next. Absent on plans made before it existed. */
	bible?: StoryBible;
	/** The story spine the planner drafted alongside the sections: premise, hook,
	 *  tension, escalation, turn, resolution, emotional arc, visual motif. */
	engagement?: Partial<StoryEngagement>;
	/** Kind of video plan the single story planner selected. Missing legacy plans
	 *  default to story at read boundaries. */
	planKind?: VideoPlanKind;
	/** Learning spine for educational explainer videos. */
	explainerContract?: ExplainerContract;
	/** Optional embodied role/lifecycle contract for second-person POV stories. */
	povLifecycle?: PovLifecycle;
	/** Beat-driven or narration-driven. Resolved once when the plan was made. */
	structure?: StoryStructure;
	/** BCP-47-ish tag of the narration the planner wrote. */
	language?: string;
	/** The story arc this plan was drafted against. Absent on plans made before arcs
	 *  existed — those load and render unchanged and report no arc coverage. */
	arc?: StoryArc;
	/** True when the frame stage failed and the arc and language came from defaults
	 *  rather than from the brief, so an operator can see the framing was degraded. */
	frameDegraded?: boolean;
	/** Recurring story references requested by the planner and materialized before
	 * approved image generation. */
	plannedReferences?: StoryPlannedReference[];
	/** Narration aliases keyed by bound logical reference identity. */
	referenceAliases?: StoryReferenceAlias[];
	/** Direction stopped on something only the operator can supply (a product with
	 *  no roster entity). A flag, not a phrase in `directionErrors`: approval used
	 *  to classify this by searching the error text. Retrying direction cannot
	 *  clear it; changing the roster can. */
	directionBlocked?: boolean;
	/** Hash of draft, roster, materials, and template constraints direction saw. */
	directionFingerprint?: string;
	/** Non-draft fingerprint inputs needed by synchronous approval routes. */
	directionInputs?: { materials: string; templateConstraints: string };
	/** What the user decided before framing, and whether the drafted plan honored
	 *  the decisions that can be checked. Stored BESIDE `planningBrief`, which keeps
	 *  the original request intact — a decision is provenance, not the brief. Absent
	 *  on plans made before clarification, and on builds that bypassed it. */
	clarification?: StoryClarificationProvenance;
	/** What the user decided AFTER reading the retrieved sources, when research
	 *  exposed an editorial fork the evidence could not settle. Its own field beside
	 *  `clarification` because the two answer different questions — what was wanted,
	 *  and what was chosen once the evidence was in front of them — and a plan that
	 *  merged them could no longer say which. Absent whenever research raised no
	 *  material choice, which is the common case. */
	postResearchClarification?: StoryClarificationProvenance;
	/** Editorial sequence pass failed. Draft stays reviewable; approval/assets stop. */
	needsDirection?: boolean;
	directionErrors?: string[];
}
/* Artifact payloads. The envelope around them — identity, producer, revision,
 * content hash — and the schema each kind validates with live in
 * `pipeline-artifact.ts` and `pipeline-artifact-kinds.ts`. These are the payload
 * shapes consumers read. */

/** The story plan — the one plan artifact for video. Persisted so it survives
 *  runs/reload and the client can render the editable plan view; sections carry
 *  per-section status, measured audio and visual segments. */
export type StoryPlanPayload = {
	targetSec: number;
	sections: StorySection[];
	unverified?: boolean;
	verificationStatus?: VerificationStatus;
	citationCoverage?: { verified: number; total: number };
} & StoryPlanContext;

/** Living research artifact — cited sources backing factual planning. Replaced in
 *  place (single card) when refreshed; never raw page dumps. `briefKey`
 *  fingerprints the brief it was gathered for, so a changed brief does not reuse
 *  stale research. */
export interface ResearchBundlePayload {
	topic: string;
	sources: ResearchSource[];
	claimCount: number;
	briefKey?: string;
	queries?: string[];
}

/* Blockers the operator chose to leave as is, by id. An artifact rather than a
 * document field: blockers are derived from the plan and the latest delivery
 * check, which are artifacts too. Ids encode the condition, so an acknowledgement
 * expires by itself when the condition changes. */
export interface BlockerAcknowledgementsPayload {
	ids: string[];
}

export interface KnowledgePayload {
	title: string;
	body: string;
}
export interface MediaPayload {
	mediaType: "audio" | "video" | "image";
	url: string;
	label?: string;
	durationSec?: number;
}
export interface StyleBiblePayload {
	visualStyle: string;
	source: "generated" | "style_ref";
	refUrl?: string;
}
export interface StoryboardTablePayload {
	title: string;
	rows: StoryboardTableRow[];
}
/** A carousel's slides, as the content scaffold drafts them and slide visuals render them. */
export interface SlideDeckPayload {
	slides: AgentSlide[];
}
/** A text thread's posts. */
export interface PostThreadPayload {
	posts: AgentPost[];
}
