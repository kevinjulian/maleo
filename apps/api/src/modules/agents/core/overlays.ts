/* Overlays leaf — pure builders for the auto-generated text + infographic layers
 * of a storyboard timeline. Owns the reserved auto-id ranges so auto overlays can
 * be replaced in place without clobbering user/tool-added ones. Depends only on
 * shared motion helpers + the stock-audio resolver; domain types are imported
 * type-only from the orchestrator (no runtime cycle), so both the orchestrator
 * and the flow services can import these builders directly. */
import type {
	AgentJob,
	AgentScene,
	AgentTextOverlay,
	AgentAudioOverlay,
	AgentInfographicOverlay,
	AgentInfographicPayload,
} from "./model.ts";
import { STORY_TIMELINE_LANES, type StorySection } from "../../../lib/story.ts";
import {
	autoTransitionForScenes,
	motionGraphicSfxCue,
	overlayMotionForEmotion,
	presentationFor,
	type MotionGraphicDecision,
} from "@maleo/shared";
import { resolveStockAudio } from "@maleo/stock";
import { str } from "./services/util.ts";
import type { z } from "zod";
import type { infographicArgs } from "./helpers/schemas.ts";

// Reserved auto-id ranges. Auto overlays carry ids inside these bands so a rebuild
// replaces the stale auto layer in place; manual overlays (ids outside the bands)
// are never touched.
const AUTO_SCENE_TEXT_ID_MIN = 40_000_000;
const AUTO_EXPLAINER_TEXT_ID_MIN = 41_000_000;
const AUTO_SCENE_TEXT_ID_MAX = 50_000_000;
const SHORTFORM_AUTO_INFOGRAPHIC_ID_BASE = 10_000_000;
const LONGFORM_AUTO_INFOGRAPHIC_ID_BASE = 20_000_000;
const AUTO_INFOGRAPHIC_ID_LIMIT = 30_000_000;
const AUTO_INFOGRAPHIC_SFX_ID_OFFSET = 30_000_000;

// ── Text overlays ───────────────────────────────────────────────────────────

export function isAutoSceneTextId(id: number | undefined): boolean {
	return typeof id === "number" && id >= AUTO_SCENE_TEXT_ID_MIN && id < AUTO_SCENE_TEXT_ID_MAX;
}
function textSpanOverlaps(
	a: { startSec: number; durationSec: number },
	b: { startSec: number; durationSec: number },
): boolean {
	return b.startSec < a.startSec + a.durationSec && b.startSec + b.durationSec > a.startSec;
}
function resolveTextTrack(
	occupied: ReadonlyArray<AgentTextOverlay>,
	span: { startSec: number; durationSec: number },
	preferredTrack = 0,
): number {
	let track = Math.max(0, Math.round(preferredTrack));
	while (occupied.some((clip) => (clip.track ?? 0) === track && textSpanOverlaps(span, clip)))
		track++;
	return track;
}
export function buildSceneTextOverlays(
	scenes: AgentScene[],
	existing: AgentTextOverlay[] = [],
): AgentTextOverlay[] {
	const overlays: AgentTextOverlay[] = [];
	const occupied = [...existing];
	const pushAuto = (clip: AgentTextOverlay, preferredTrack: number): void => {
		const track = resolveTextTrack(occupied, clip, preferredTrack);
		const placed = { ...clip, track };
		overlays.push(placed);
		occupied.push(placed);
	};
	let cursor = 0;
	scenes.forEach((scene, index) => {
		const start = cursor;
		const dur = Math.max(1, scene.durationSec || 0);
		const presentation = presentationFor(scene);
		const text = scene.onScreenText?.trim();
		if (text && presentation.category === "headline") {
			pushAuto(
				{
					id: AUTO_SCENE_TEXT_ID_MIN + index * 2,
					content: text,
					startSec: start + Math.min(0.25, dur / 4),
					durationSec: Math.min(dur, 2.4),
					preset: "title",
					track: 1,
				},
				1,
			);
		}
		const explainerText = [
			scene.claim?.trim() || scene.question?.trim(),
			scene.evidence?.trim() || scene.analogy?.trim(),
		]
			.filter(Boolean)
			.join("\n");
		if (explainerText && presentation.category === "explainer") {
			pushAuto(
				{
					id: AUTO_EXPLAINER_TEXT_ID_MIN + index,
					content: explainerText,
					startSec: start + Math.min(0.6, dur / 3),
					durationSec: Math.min(dur, 2.6),
					preset: "explainer-card",
					track: 2,
				},
				2,
			);
		}
		const transitionText = scene.sectionTransition?.text?.trim();
		if (transitionText && presentation.category === "transition") {
			pushAuto(
				{
					id: AUTO_SCENE_TEXT_ID_MIN + index * 2 + 1,
					content: transitionText,
					startSec: start,
					durationSec: Math.min(dur, Math.max(0.5, scene.sectionTransition?.durationSec ?? 0.9)),
					preset: "section-card",
					track: 3,
				},
				3,
			);
		}
		cursor += dur;
	});
	return overlays;
}
export function syncSceneTextOverlays(job: AgentJob): void {
	const userText = job.textOverlays.filter((t) => !isAutoSceneTextId(t.id));
	const generated = buildSceneTextOverlays(job.scenes, userText);
	job.textOverlays = [...userText, ...generated];
}

// Auto-vary each scene's outgoing transition from its beat + the next scene's
// emotion, so any storyboard (manual, longform, or blueprint) reads with an
// intentional cut rhythm instead of a static default. Scenes whose transition
// was explicitly set (transitionLocked) are left untouched.
export function syncSceneTransitions(job: AgentJob): void {
	if (job.scenes.length < 2) return;
	const resolved = autoTransitionForScenes(job.scenes, job.styleKnobs);
	job.scenes.forEach((scene, i) => {
		if (scene.transitionLocked) return;
		const next = resolved[i];
		if (next) scene.transition = next;
	});
}

// ── Infographic overlays ────────────────────────────────────────────────────

export function isAutoInfographicOverlay(g: AgentInfographicOverlay): boolean {
	return (
		typeof g.id === "number" &&
		g.id >= SHORTFORM_AUTO_INFOGRAPHIC_ID_BASE &&
		g.id < AUTO_INFOGRAPHIC_ID_LIMIT
	);
}
export function replaceAutoInfographics(
	existing: ReadonlyArray<AgentInfographicOverlay>,
	generated: AgentInfographicOverlay[],
): AgentInfographicOverlay[] {
	return [...existing.filter((g) => !isAutoInfographicOverlay(g)), ...generated];
}

// An auto infographic's entry sound carries the graphic's id shifted into its own
// range, so rebuilding the graphics replaces stale sounds instead of stacking
// duplicates. Manual infographics (user/tool-added, id outside the auto range)
// never get an auto sound.
function isAutoInfographicSfx(a: AgentAudioOverlay): boolean {
	return (
		a.id >= SHORTFORM_AUTO_INFOGRAPHIC_ID_BASE + AUTO_INFOGRAPHIC_SFX_ID_OFFSET &&
		a.id < AUTO_INFOGRAPHIC_ID_LIMIT + AUTO_INFOGRAPHIC_SFX_ID_OFFSET
	);
}

// Resolve the entry-sound url per cue for the given motion-graphic kinds (dedup;
// unresolvable cues — no provider key / no match — map to null and are skipped
// at build time). Split from the sync build so sync assembly paths can pre-resolve.
export async function resolveInfographicSfxUrls(
	kinds: ReadonlyArray<string | undefined | null>,
): Promise<Map<string, string | null>> {
	const byCue = new Map<string, string | null>();
	for (const k of kinds) {
		const cue = motionGraphicSfxCue(k);
		if (!cue || byCue.has(cue)) continue;
		byCue.set(cue, (await resolveStockAudio("accent_hit", cue))?.url ?? null);
	}
	return byCue;
}

// One short accent hit at each auto infographic's entry, cued by its kind (shared
// cue table) so charts/stats/tables are heard arriving, not just seen.
function buildInfographicSfx(
	graphics: ReadonlyArray<AgentInfographicOverlay>,
	urlByCue: ReadonlyMap<string, string | null>,
): AgentAudioOverlay[] {
	const out: AgentAudioOverlay[] = [];
	for (const g of graphics) {
		if (!isAutoInfographicOverlay(g)) continue;
		const cue = motionGraphicSfxCue(g.payload.type);
		const url = cue ? urlByCue.get(cue) : null;
		if (!cue || !url) continue;
		out.push({
			id: g.id! + AUTO_INFOGRAPHIC_SFX_ID_OFFSET,
			kind: "accent_hit",
			content: cue,
			url,
			startSec: g.startSec,
			durationSec: Math.round(Math.min(1, Math.max(0.4, g.durationSec * 0.25)) * 100) / 100,
			volume: 0.6,
			fadeIn: 0,
			fadeOut: 0.25,
		});
	}
	return out;
}

// Rebuild the auto infographic entry sounds from the job's current infographic
// overlays (replace-in-place semantics). Returns how many sounds were placed.
export function applyInfographicSfx(
	job: AgentJob,
	urlByCue: ReadonlyMap<string, string | null>,
): number {
	const sfx = buildInfographicSfx(job.infographicOverlays, urlByCue);
	job.audioOverlays = [...job.audioOverlays.filter((a) => !isAutoInfographicSfx(a)), ...sfx];
	return sfx.length;
}
export async function refreshInfographicSfx(job: AgentJob): Promise<number> {
	const urls = await resolveInfographicSfxUrls(job.infographicOverlays.map((g) => g.payload.type));
	return applyInfographicSfx(job, urls);
}

// ── Infographic payload synthesis ───────────────────────────────────────────

export function compactTitle(text: string, fallback: string): string {
	const clean = text.replace(/\s+/g, " ").trim();
	return clean ? clean.slice(0, 54) : fallback;
}

export function parseNumberLike(value: unknown, fallback = 0): number {
	if (typeof value === "number" && Number.isFinite(value)) return value;
	if (typeof value !== "string") return fallback;
	const n = Number(value.replace(/,/g, "").match(/-?\d+(?:\.\d+)?/)?.[0]);
	return Number.isFinite(n) ? n : fallback;
}

function numberTokens(text: string): Array<{ raw: string; value: number }> {
	const out: Array<{ raw: string; value: number }> = [];
	for (const m of text.matchAll(
		/(?:[$€£¥]\s*)?-?\d[\d,.]*(?:\.\d+)?\s*(?:%|x|k|m|b|jt|juta|ribu)?/gi,
	)) {
		const raw = m[0].replace(/\s+/g, "");
		const value = parseNumberLike(raw, NaN);
		if (Number.isFinite(value)) out.push({ raw, value });
	}
	return out.slice(0, 5);
}

export function infographicPayloadFromMotionGraphic(
	mg: MotionGraphicDecision | undefined,
	fallback: {
		title: string;
		claim?: string;
		evidence?: string;
		onScreenText?: string;
		voiceover?: string;
		visualType?: string;
		index: number;
	},
): AgentInfographicPayload | null {
	if (!mg?.needed || mg.kind === "none") return null;
	if (mg.kind === "stat_reveal") {
		const value =
			mg.value ||
			numberTokens(
				[fallback.onScreenText, fallback.claim, fallback.evidence, fallback.voiceover]
					.filter(Boolean)
					.join(" "),
			)[0]?.raw;
		if (!value) return null;
		return {
			type: "stat_reveal",
			title: compactTitle(
				mg.title || fallback.onScreenText || fallback.claim || fallback.title,
				`Key point ${fallback.index + 1}`,
			),
			value,
			suffix: mg.unit,
			comparison: compactTitle(mg.reason || fallback.evidence || fallback.claim || "", ""),
		};
	}
	if (mg.kind === "bar_chart") {
		const rows = (mg.rows ?? []).filter((r) => Number.isFinite(r.value)).slice(0, 5);
		if (rows.length < 2) return null;
		return {
			type: "bar_chart",
			title: compactTitle(
				mg.title || fallback.onScreenText || fallback.claim || fallback.title,
				`Comparison ${fallback.index + 1}`,
			),
			rows,
			unit: mg.unit,
		};
	}
	if (mg.kind === "table_build") {
		const columns = (mg.columns ?? []).slice(0, 4);
		const rows = (mg.tableRows ?? []).slice(0, 5);
		if (!columns.length || !rows.length) return null;
		return {
			type: "table_build",
			title: compactTitle(
				mg.title || fallback.onScreenText || fallback.claim || fallback.title,
				`Explainer ${fallback.index + 1}`,
			),
			columns,
			rows,
		};
	}
	if (mg.kind === "price_tag") {
		const price =
			mg.value ||
			numberTokens(
				[fallback.onScreenText, fallback.claim, fallback.voiceover].filter(Boolean).join(" "),
			)[0]?.raw;
		if (!price) return null;
		return {
			type: "price_tag",
			title: compactTitle(
				mg.title || fallback.onScreenText || fallback.title,
				`Offer ${fallback.index + 1}`,
			),
			price,
			compareAt: mg.compareAt,
			note: compactTitle(mg.reason || "", "") || undefined,
		};
	}
	return null;
}

export function buildInfographicsForScenes(
	scenes: ReadonlyArray<AgentScene>,
	cueTimingByLogicalSceneId?: ReadonlyMap<string, { startSec: number; durationSec: number }>,
): AgentInfographicOverlay[] {
	let cursor = 0;
	return scenes
		.map((scene, index): AgentInfographicOverlay | null => {
			const dur = Math.max(1, scene.durationSec);
			const compiledCue = scene.logicalSceneId
				? cueTimingByLogicalSceneId?.get(scene.logicalSceneId)
				: undefined;
			const startSec =
				compiledCue?.startSec ?? Math.round((cursor + Math.min(0.45, dur * 0.12)) * 100) / 100;
			const durationSec =
				compiledCue?.durationSec ??
				Math.max(1, Math.round(Math.min(dur * 0.72, Math.max(1.4, dur - 0.35)) * 100) / 100);
			cursor += dur;
			const payload = infographicPayloadFromMotionGraphic(scene.motionGraphic, {
				title: scene.name,
				claim: scene.claim,
				evidence: scene.evidence,
				onScreenText: scene.onScreenText,
				voiceover: scene.voiceover,
				visualType: scene.visualType,
				index,
			});
			if (!payload || presentationFor(scene).category !== "infographic") return null;
			return {
				id: SHORTFORM_AUTO_INFOGRAPHIC_ID_BASE + index,
				startSec,
				durationSec,
				track: 1,
				layout: { xPct: 7, yPct: index % 2 === 0 ? 12 : 54, widthPct: 86, fit: "contain" },
				// Entrance follows the beat's emotional energy (calm fades, hype pops);
				// stays plain data the user can override per clip in the editor.
				animation: { in: overlayMotionForEmotion(scene.emotion), main: "build", out: "fade" },
				payload,
			};
		})
		.filter((g): g is AgentInfographicOverlay => g !== null);
}

export function buildInfographicsForSections(
	sections: ReadonlyArray<StorySection>,
): AgentInfographicOverlay[] {
	return sections
		.map((section, index): AgentInfographicOverlay | null => {
			const start = section.startSec ?? 0;
			const dur = Math.max(1, section.audioDurationSec ?? section.estimatedDurationSec ?? 4);
			const payload = infographicPayloadFromMotionGraphic(section.motionGraphic, {
				title: section.title,
				claim: section.notes || section.sourceNotes,
				evidence: section.sourceEvidence?.[0]?.quote,
				onScreenText: section.title,
				voiceover: section.narration,
				index,
			});
			if (!payload) return null;
			return {
				id: LONGFORM_AUTO_INFOGRAPHIC_ID_BASE + index,
				startSec: Math.round((start + Math.min(0.8, dur * 0.1)) * 100) / 100,
				durationSec: Math.max(
					1.2,
					Math.round(Math.min(dur * 0.68, Math.max(1.8, dur - 0.6)) * 100) / 100,
				),
				track: STORY_TIMELINE_LANES.data,
				layout: { xPct: 7, yPct: index % 2 === 0 ? 13 : 56, widthPct: 86, fit: "contain" },
				animation: { in: "slide_up", main: "build", out: "fade" },
				payload,
			};
		})
		.filter((g): g is AgentInfographicOverlay => g !== null);
}

/* Args -> infographic payload.
 *
 * This lived in `tool-executor.ts`, so the one tool that needs it could only reach
 * it through the capability bag. It belongs with the other overlay decoding, next
 * to `parseNumberLike`, which it uses. */
export const infographicPayloadFromArgs = (
	args: z.infer<typeof infographicArgs>,
): AgentInfographicPayload => {
	if (args.type === "bar_chart") {
		const rows = (args.rows ?? [])
			.map((row) => ({
				label: str(row.label, "Metric"),
				value: parseNumberLike(row.value, 0),
				color: str(row.color) || undefined,
			}))
			.filter((r) => r.label && Number.isFinite(r.value));
		if (rows.length < 2) throw new Error("bar_chart requires at least two finite rows");
		return { type: "bar_chart", title: args.title, rows, unit: args.unit || undefined };
	}
	if (args.type === "table_build") {
		const columns = (args.columns ?? []).filter(Boolean);
		/* Only `tableRows` can supply a table. `rows` is declared `array(record)`,
		 * so a model sending `rows: [["A","42"]]` never reaches here — the schema
		 * rejects it — and the old fallback that read `rows` for a table was
		 * already unreachable by the time this function ran. */
		const rows = (args.tableRows ?? []).filter((r) => r.length);
		const h = args.highlight;
		if (!columns.length || !rows.length)
			throw new Error("table_build requires explicit columns and rows");
		return {
			type: "table_build",
			title: args.title,
			columns,
			rows,
			highlight: h
				? {
						row: Number.isFinite(parseNumberLike(h.row, NaN)) ? parseNumberLike(h.row) : undefined,
						col: Number.isFinite(parseNumberLike(h.col, NaN)) ? parseNumberLike(h.col) : undefined,
					}
				: undefined,
		};
	}
	if (args.type === "price_tag") {
		const price = args.price || args.value;
		if (!price) throw new Error("price_tag requires price or value");
		return {
			type: "price_tag",
			title: args.title,
			price,
			compareAt: args.compareAt || undefined,
			note: args.note || undefined,
		};
	}
	if (!args.value) throw new Error("stat_reveal requires value");
	return {
		type: "stat_reveal",
		title: args.title,
		value: args.value,
		suffix: args.suffix || undefined,
		comparison: args.comparison || undefined,
	};
};
