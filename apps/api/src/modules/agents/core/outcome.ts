/* Outcome contract + deterministic completion evaluation.
 *
 * Tool success is execution evidence, not delivery evidence. Every run snapshots
 * what the user asked for, then this module evaluates current project output
 * against that snapshot before the workflow may report completion. Keep this
 * pure: persistence and UI projection live at their owning boundaries. */
import { storyPlanArtifact } from "@maleo/shared";
import { jobArtifactsOfKind } from "./artifact-store.ts";
import type { Intent } from "./types.ts";
import type {
	AgentJob,
	OutcomeContract,
	OutcomeEvaluation,
	OutcomeFinding,
	OutcomeRequirement,
} from "./model.ts";
import {
	attentionLoadPerSecond,
	DEFAULT_TIMELINE_TEMPLATE,
	lintAttention,
	type AttentionSpan,
} from "@maleo/shared";

const WORD = /[\p{L}\p{N}]+/gu;
const STOP_WORDS = new Set([
	"a",
	"an",
	"and",
	"are",
	"atau",
	"buat",
	"create",
	"dan",
	"dari",
	"di",
	"for",
	"generate",
	"ini",
	"itu",
	"make",
	"of",
	"on",
	"the",
	"to",
	"untuk",
	"video",
	"yang",
]);

function uniqueText(...parts: Array<string | undefined>): string {
	const seen = new Set<string>();
	return parts
		.map((part) => part?.trim())
		.filter((part): part is string => {
			if (!part) return false;
			const key = part.toLocaleLowerCase();
			if (seen.has(key)) return false;
			seen.add(key);
			return true;
		})
		.join("\n\n");
}

function requirement(
	id: OutcomeRequirement["id"],
	label: string,
	blocking: boolean,
): OutcomeRequirement {
	return { id, label, blocking };
}

export function createOutcomeContract(input: {
	instruction: string;
	brief?: string;
	contentType: AgentJob["contentType"];
	audience?: string;
	platform?: string;
	format: string;
	targetDurationSec?: number;
	createdAt?: number;
}): OutcomeContract {
	const requirements: OutcomeRequirement[] = [
		requirement("content_present", "Deliver editable content, not only a plan or note", true),
		requirement("brief_coverage", "Keep output aligned with requested topic and action", false),
		requirement("valid_timeline", "Keep clip timing and media references render-safe", true),
	];
	requirements.push(requirement("visual_assets", "Materialize required visual assets", true));
	requirements.push(
		requirement("evidence", "Ground factual claims in matched project evidence", true),
	);
	requirements.push(requirement("viewer_attention", "Keep one clear viewer focus at a time", true));
	if (input.targetDurationSec && input.targetDurationSec > 0)
		requirements.push(
			requirement(
				"target_duration",
				`Stay near ${Math.round(input.targetDurationSec)}s target duration`,
				true,
			),
		);
	return {
		schemaVersion: 1,
		objective: uniqueText(input.instruction, input.brief) || "Deliver requested content",
		contentType: input.contentType,
		audience: input.audience,
		platform: input.platform,
		format: input.format,
		targetDurationSec: input.targetDurationSec,
		createdAt: input.createdAt ?? Date.now(),
		requirements,
	};
}

export function ensureOutcomeContract(job: AgentJob): OutcomeContract {
	if (job.outcomeContract) return job.outcomeContract;
	job.outcomeContract = createOutcomeContract({
		instruction: job.run?.instruction ?? job.brief,
		brief: job.brief,
		contentType: job.contentType,
		audience: job.audience,
		platform: job.platform,
		format: job.aspect,
		targetDurationSec: job.targetDurationSec,
		createdAt: job.startedAt,
	});
	return job.outcomeContract;
}

export function setOutcomeIntent(job: AgentJob, intent: Intent | null): void {
	ensureOutcomeContract(job).intent = intent ?? undefined;
}

function tokens(text: string): string[] {
	return (text.toLocaleLowerCase().match(WORD) ?? []).filter(
		(word) => word.length >= 4 && !STOP_WORDS.has(word),
	);
}

function outputText(job: AgentJob): string {
	return job.scenes
		.flatMap((scene) => [scene.name, scene.visual, scene.voiceover, scene.intent, scene.claim])
		.filter(Boolean)
		.join(" ");
}

function contentCount(job: AgentJob): number {
	return job.scenes.length;
}

function totalDuration(job: AgentJob): number {
	return job.scenes.reduce(
		(sum, scene) => sum + (Number.isFinite(scene.durationSec) ? Math.max(0, scene.durationSec) : 0),
		0,
	);
}

function fix(
	command: string,
	scope?: string,
	tool?: string,
	args?: Record<string, unknown>,
): OutcomeFinding["fix"] {
	return { command, scope, tool, args };
}

function add(findings: OutcomeFinding[], finding: OutcomeFinding): void {
	findings.push(finding);
}

function evaluateContent(job: AgentJob, findings: OutcomeFinding[]): void {
	const count = contentCount(job);
	if (count === 0) {
		const intent = ensureOutcomeContract(job).intent;
		if (intent !== "build_short" && intent !== "build_story") {
			add(findings, {
				id: "content-empty-after-change",
				requirementId: "content_present",
				severity: "pass",
				message: "No editable content remains after the requested scoped change.",
			});
			return;
		}
		add(findings, {
			id: "content-empty",
			requirementId: "content_present",
			severity: "blocker",
			message: "No editable content was produced.",
			fix: fix("Build the requested content from the approved brief."),
		});
		return;
	}
	add(findings, {
		id: "content-present",
		requirementId: "content_present",
		severity: "pass",
		message: `${count} editable scene${count === 1 ? "" : "s"} present.`,
	});
}

function evaluateVisuals(job: AgentJob, findings: OutcomeFinding[]): void {
	const intent = ensureOutcomeContract(job).intent;
	if (intent !== "build_short" && intent !== "build_story") return;
	const missing = job.scenes
		.map((scene, index) => ({ index, has: Boolean(scene.image?.trim()) }))
		.filter((item) => !item.has)
		.map((item) => item.index);
	if (!missing.length) {
		add(findings, {
			id: "visuals-ready",
			requirementId: "visual_assets",
			severity: "pass",
			message: "Required visual assets are materialized.",
		});
		return;
	}
	const label = "scene";
	for (const index of missing) {
		add(findings, {
			id: `visuals-missing-${label}-${index}`,
			requirementId: "visual_assets",
			severity: "blocker",
			message: `${label[0]!.toUpperCase()}${label.slice(1)} ${index + 1} is missing its generated visual.`,
			fix: fix(
				`Generate only the missing visual for ${label} ${index + 1}.`,
				`${label}:${index}`,
				"generate_frame",
				{ index },
			),
		});
	}
}

function evaluateDuration(
	job: AgentJob,
	findings: OutcomeFinding[],
	metrics: Partial<OutcomeEvaluation["metrics"]>,
): void {
	const target = ensureOutcomeContract(job).targetDurationSec;
	const intent = ensureOutcomeContract(job).intent;
	if (
		job.contentType !== "video" ||
		!target ||
		(intent !== "build_short" && intent !== "build_story")
	)
		return;
	const actual = totalDuration(job);
	const errorPct = target > 0 ? Math.abs(actual - target) / target : 0;
	metrics.durationSec = actual;
	metrics.durationErrorPct = Math.round(errorPct * 1000) / 10;
	if (errorPct <= 0.1) {
		add(findings, {
			id: "duration-pass",
			requirementId: "target_duration",
			severity: "pass",
			message: `${actual.toFixed(1)}s output is within 10% of ${target}s target.`,
		});
	} else if (errorPct <= 0.2) {
		add(findings, {
			id: "duration-warning",
			requirementId: "target_duration",
			severity: "warning",
			message: `${actual.toFixed(1)}s output differs ${(errorPct * 100).toFixed(1)}% from ${target}s target.`,
			fix: fix("Retiming scenes to match target duration while preserving narration."),
		});
	} else {
		add(findings, {
			id: "duration-blocker",
			requirementId: "target_duration",
			severity: "blocker",
			message: `${actual.toFixed(1)}s output differs ${(errorPct * 100).toFixed(1)}% from ${target}s target.`,
			fix: fix("Retiming scenes and narration to match requested duration."),
		});
	}
}

function evaluateBrief(
	job: AgentJob,
	findings: OutcomeFinding[],
	metrics: Partial<OutcomeEvaluation["metrics"]>,
): void {
	const wanted = [...new Set(tokens(ensureOutcomeContract(job).objective))];
	if (!wanted.length) return;
	const delivered = new Set(tokens(outputText(job)));
	const matched = wanted.filter((word) => delivered.has(word));
	const coverage = matched.length / wanted.length;
	metrics.briefKeywordCoverage = Math.round(coverage * 1000) / 10;
	if (coverage >= 0.35) {
		add(findings, {
			id: "brief-pass",
			requirementId: "brief_coverage",
			severity: "pass",
			message: `Output reflects ${matched.length}/${wanted.length} key brief terms.`,
		});
	} else {
		add(findings, {
			id: "brief-warning",
			requirementId: "brief_coverage",
			severity: "warning",
			message: `Low lexical brief coverage (${matched.length}/${wanted.length}); review topic and requested action before delivery.`,
			fix: fix("Review brief coverage and patch only off-topic or missing beats."),
		});
	}
}

/* `visualRelevancePct` used to be computed here as lexical token overlap between
 * the outcome objective and each unit's image prompt. Narration and objectives
 * are written in the brief's language while image prompts are written in English,
 * so the overlap is structurally near-zero and carries no signal about relevance
 * at all. It was recorded on zero runs. It is not replaced with a tuned version:
 * a relevance judgement, if one is ever added, is a judgement — it records at
 * `warning` severity at most and never fails a run. What ships instead are counts
 * over the generated story sections, in `buildProjectQualityReport`. */
function evaluateVisualQuality(
	job: AgentJob,
	metrics: Partial<OutcomeEvaluation["metrics"]>,
): void {
	const units = job.scenes;
	if (!units.length) return;
	const ready = units.filter((unit) => Boolean(unit.image?.trim())).length / units.length;
	const styleLocked = Boolean(job.styleImageUrl || job.visualStyle || job.styleKnobs || job.style);
	metrics.visualContinuityPct = Math.round((ready * 0.7 + (styleLocked ? 0.3 : 0)) * 1000) / 10;
}

function evaluateEvidence(job: AgentJob, findings: OutcomeFinding[]): void {
	if (job.contentType !== "video") return;
	const intent = ensureOutcomeContract(job).intent;
	if (intent !== "build_short" && intent !== "build_story") return;
	const unsupportedScenes = job.scenes
		.map((scene, index) => ({ scene, index }))
		.filter(({ scene }) => Boolean(scene.claim?.trim()) && !scene.sourceEvidence?.length);
	const plan = jobArtifactsOfKind(job, storyPlanArtifact)[0]?.payload;
	const unsupportedSections = plan
		? plan.sections.filter((section) => section.factual && section.citationStatus === "unsupported")
				.length
		: 0;
	const total = unsupportedScenes.length + unsupportedSections;
	if (!total) return;
	add(findings, {
		id: "evidence-unsupported",
		requirementId: "evidence",
		severity: "blocker",
		message: `${total} factual claim${total === 1 ? "" : "s"} lack matched source evidence.`,
		fix: fix(
			"Ground unsupported claims with project evidence, or soften/remove them.",
			"project:evidence",
			"research_topic",
			{ topic: ensureOutcomeContract(job).objective },
		),
	});
}

function evaluateTimeline(job: AgentJob, findings: OutcomeFinding[]): void {
	const invalidScenes = job.scenes.filter(
		(scene) => !Number.isFinite(scene.durationSec) || scene.durationSec <= 0,
	).length;
	const invalidOverlays = [
		...job.textOverlays,
		...job.infographicOverlays,
		...job.videoOverlays,
		...job.audioOverlays,
	].filter(
		(clip) =>
			!Number.isFinite(clip.startSec) ||
			clip.startSec < 0 ||
			!Number.isFinite(clip.durationSec) ||
			clip.durationSec <= 0,
	).length;
	const invalidWords = job.audioOverlays.reduce(
		(count, audio) =>
			count +
			(audio.words ?? []).filter((word) => {
				const ordered = word.startSec >= 0 && word.endSec > word.startSec;
				const local = word.startSec >= 0 && word.endSec <= audio.durationSec + 0.05;
				const absolute =
					word.startSec >= audio.startSec - 0.05 &&
					word.endSec <= audio.startSec + audio.durationSec + 0.05;
				return !ordered || (!local && !absolute);
			}).length,
		0,
	);
	const total = invalidScenes + invalidOverlays + invalidWords;
	if (!total) {
		add(findings, {
			id: "timeline-pass",
			requirementId: "valid_timeline",
			severity: "pass",
			message: "Timeline durations, starts, and caption windows are valid.",
		});
		return;
	}
	add(findings, {
		id: "timeline-invalid",
		requirementId: "valid_timeline",
		severity: "blocker",
		message: `${total} invalid timeline or caption timing value${total === 1 ? "" : "s"} found.`,
		fix: fix("Repair invalid timing and re-align captions before render."),
	});
}

function attentionSpans(job: AgentJob): AttentionSpan[] {
	const spans: AttentionSpan[] = [];
	let cursor = 0;
	for (let index = 0; index < job.scenes.length; index++) {
		const scene = job.scenes[index]!;
		const dur = Math.max(0, scene.durationSec || 0);
		if (index > 0) spans.push({ kind: "scene_cut", start: cursor, dur: 0 });
		if (!new Set(["", "static", "none", "hold"]).has((scene.move ?? "").toLocaleLowerCase()))
			spans.push({ kind: "motion", start: cursor, dur });
		cursor += dur;
	}
	for (const overlay of job.textOverlays)
		spans.push({
			kind: "text",
			start: overlay.startSec,
			dur: overlay.durationSec,
			content: overlay.content,
		});
	for (const overlay of job.infographicOverlays)
		spans.push({
			kind: "infographic",
			start: overlay.startSec,
			dur: overlay.durationSec,
			content: overlay.payload.title,
		});
	for (const audio of job.audioOverlays) {
		if (audio.kind === "voiceover") {
			spans.push({
				kind: "voiceover",
				start: audio.startSec,
				dur: audio.durationSec,
				content: audio.content,
			});
			if (audio.words?.length)
				spans.push({ kind: "caption", start: audio.startSec, dur: audio.durationSec });
		} else if (audio.kind === "sfx" || audio.kind === "accent_hit")
			spans.push({ kind: "sfx", start: audio.startSec, dur: audio.durationSec });
	}
	return spans;
}

function evaluateViewerAttention(
	job: AgentJob,
	findings: OutcomeFinding[],
	metrics: Partial<OutcomeEvaluation["metrics"]>,
): void {
	if (job.contentType !== "video" || !job.scenes.length) return;
	const total = totalDuration(job);
	const spans = attentionSpans(job);
	const load = attentionLoadPerSecond(total, spans);
	metrics.peakAttentionLoad = Math.max(0, ...load);
	metrics.overloadSeconds = load.filter((value) => value >= 4.2).length;
	const attentionFindings = lintAttention(total, spans);
	const maxVisualBeatSec =
		job.timelineTemplate?.maxVisualBeatSec ?? DEFAULT_TIMELINE_TEMPLATE.maxVisualBeatSec;
	const maxVoiceoverSegmentSec =
		job.timelineTemplate?.maxVoiceoverSegmentSec ??
		DEFAULT_TIMELINE_TEMPLATE.maxVoiceoverSegmentSec;
	const pacingFindings = [
		...job.scenes.flatMap((scene, index) => {
			const durationSec = scene.contentDurationSec ?? scene.durationSec;
			return durationSec > maxVisualBeatSec + 0.01
				? [
						{
							code: "long_visual_beat",
							severity: "blocker" as const,
							startSec: job.scenes.slice(0, index).reduce((sum, item) => sum + item.durationSec, 0),
							endSec: job.scenes
								.slice(0, index + 1)
								.reduce((sum, item) => sum + item.durationSec, 0),
							message: `${durationSec.toFixed(1)}s visual beat exceeds ${maxVisualBeatSec.toFixed(1)}s template limit.`,
						},
					]
				: [];
		}),
		...job.audioOverlays
			.filter(
				(audio) => audio.kind === "voiceover" && audio.durationSec > maxVoiceoverSegmentSec + 0.01,
			)
			.map((audio) => ({
				code: "long_voiceover_segment",
				severity: "blocker" as const,
				startSec: audio.startSec,
				endSec: audio.startSec + audio.durationSec,
				message: `${audio.durationSec.toFixed(1)}s voiceover segment exceeds ${maxVoiceoverSegmentSec.toFixed(1)}s template limit.`,
			})),
	];
	if (!attentionFindings.length && !pacingFindings.length) {
		add(findings, {
			id: "viewer-attention-pass",
			requirementId: "viewer_attention",
			severity: "pass",
			message: "Timeline keeps a clear viewer focus.",
		});
		return;
	}
	for (const [index, finding] of [...attentionFindings, ...pacingFindings].entries()) {
		add(findings, {
			id: `viewer-attention-${finding.code}-${index}`,
			requirementId: "viewer_attention",
			severity: finding.severity,
			message: `${finding.startSec.toFixed(1)}-${finding.endSec.toFixed(1)}s: ${finding.message}`,
			fix: fix(
				"Split narration at semantic boundaries, map each part to a correlated visual beat, then reflow measured timing without trimming audio.",
				`timeline:${finding.startSec}-${finding.endSec}`,
			),
		});
	}
}

export function evaluateOutcome(job: AgentJob, now = Date.now()): OutcomeEvaluation {
	const contract = ensureOutcomeContract(job);
	const findings: OutcomeFinding[] = [];
	const metrics: Partial<OutcomeEvaluation["metrics"]> = {};
	evaluateContent(job, findings);
	evaluateVisuals(job, findings);
	evaluateDuration(job, findings, metrics);
	evaluateBrief(job, findings, metrics);
	evaluateVisualQuality(job, metrics);
	evaluateEvidence(job, findings);
	evaluateTimeline(job, findings);
	evaluateViewerAttention(job, findings, metrics);
	const blockers = findings.filter((finding) => finding.severity === "blocker").length;
	const warnings = findings.filter((finding) => finding.severity === "warning").length;
	const relevant = findings.filter((finding) => finding.severity !== "pass").length;
	const score = Math.max(0, Math.round(100 - blockers * 30 - warnings * 10));
	return {
		schemaVersion: 1,
		contractSchemaVersion: contract.schemaVersion,
		status: blockers ? "failed" : warnings ? "needs_attention" : "passed",
		score,
		evaluatedAt: now,
		findings,
		metrics: { ...metrics, blockerCount: blockers, warningCount: warnings, findingCount: relevant },
	};
}

export function recordOutcomeEvaluation(job: AgentJob): OutcomeEvaluation {
	const evaluation = evaluateOutcome(job);
	job.outcomeEvaluation = evaluation;
	job.events.push({ kind: "outcome_evaluation", evaluation });
	return evaluation;
}
