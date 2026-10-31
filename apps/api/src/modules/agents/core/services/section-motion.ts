/* Motion for directed on-screen text (motion-design-generation).
 *
 * Story direction gives a section on-screen text and a presentation. A
 * `headline`, `explainer` or `transition` section gets motion in place of its
 * plain-text overlay; `narrative` keeps plain text. Motion is placed as one
 * ordinary clip per layer, each on its own lane with its own keys, so the user can
 * edit every part of it (design D1).
 *
 * A beat's clips carry ids from a range reserved for that beat's text and start
 * (design D10). Every rebuild of the text layer keeps clips already in a beat's
 * range exactly as they are, user edits included, so regenerating never asks the
 * model again for an unchanged beat. Authoring runs once, after the timeline is
 * assembled. Any failure keeps plain text. */
import {
	defaultClipLayout,
	mapWithConcurrency,
	motionInputHash,
	PLAIN_TEXT_AUTHOR_STYLE,
	stableInputHash,
	type MotionClip,
	type StoryEditorialDecision,
} from "@maleo/shared";
import { authorMotionDesign, type MotionPresentation } from "../../../../lib/motion-author.ts";
import { placeSections, type StorySection } from "../../../../lib/story.ts";
import type { AgentJob, AgentTextOverlay } from "../model.ts";
import { getStyleBible } from "../plan-state.ts";
import { pushNote } from "../trace.ts";

const AUTHOR_CONCURRENCY = 3;
/** Generated motion clip ids: 60,000,000 + beat slot * 32 + layer. */
const MOTION_ID_BASE = 60_000_000;
const SLOT_SIZE = 32;
const SLOT_COUNT = 65_536;
/** Lane generated motion starts from: above the section titles on lane 0. */
const MOTION_FIRST_LANE = 1;

const isMotionPresentation = (value: string | undefined): value is MotionPresentation =>
	value === "headline" || value === "explainer" || value === "transition";

/** One section's directed on-screen text, where it plays. */
export interface DirectedTextSlot {
	text: string;
	startSec: number;
	durationSec: number;
	editorial?: StoryEditorialDecision;
}

export interface DirectedTextTiming {
	pauseSec: number;
	leadInSec: number;
	titleDurationSec: number;
}

export function directedTextSlots(
	sections: StorySection[],
	timing: DirectedTextTiming,
): DirectedTextSlot[] {
	return placeSections(sections, timing.pauseSec, timing.leadInSec).flatMap((section) => {
		const text = section.editorial?.onScreenText;
		if (!text || section.startSec == null || !section.audioDurationSec) return [];
		return [
			{
				text,
				startSec: section.startSec,
				durationSec: Math.min(timing.titleDurationSec, section.audioDurationSec),
				editorial: section.editorial,
			},
		];
	});
}

const presentationOf = (slot: DirectedTextSlot): MotionPresentation | undefined => {
	const presentation = slot.editorial?.presentation;
	return isMotionPresentation(presentation) ? presentation : undefined;
};

function motionKey(job: AgentJob, slot: DirectedTextSlot, presentation: string): string {
	return motionInputHash({
		sourceText: slot.text,
		presentation,
		startSec: slot.startSec,
		durationSec: slot.durationSec,
		aspect: job.aspect,
		visualStyle: getStyleBible(job),
	});
}

/** The first id of a beat's reserved range, from its text and start (D10). */
export function motionIdBase(slot: Pick<DirectedTextSlot, "text" | "startSec">): number {
	const hash = stableInputHash(["motion-slot:v1", slot.text, Math.round(slot.startSec * 1000)]);
	return MOTION_ID_BASE + (parseInt(hash, 36) % SLOT_COUNT) * SLOT_SIZE;
}

const inRange = (id: number | undefined, base: number) =>
	typeof id === "number" && id >= base && id < base + SLOT_SIZE;

/** Clips already placed for this beat: kept as they are, edits and all. */
function placedClips(job: AgentJob, slot: DirectedTextSlot): AgentTextOverlay[] {
	const base = motionIdBase(slot);
	return job.textOverlays.filter((t) => inRange(t.id, base));
}

/** The lowest lane at which `count` consecutive lanes are free for the span. */
function freeLanes(
	occupied: readonly AgentTextOverlay[],
	span: { startSec: number; durationSec: number },
	count: number,
): number {
	const busy = (lane: number) =>
		occupied.some(
			(o) =>
				(o.track ?? 0) === lane &&
				o.startSec < span.startSec + span.durationSec &&
				o.startSec + o.durationSec > span.startSec,
		);
	let first = MOTION_FIRST_LANE;
	while (Array.from({ length: count }, (_, i) => first + i).some(busy)) first++;
	return first;
}

function clipOverlays(
	slot: DirectedTextSlot,
	clips: readonly MotionClip[],
	occupied: readonly AgentTextOverlay[],
): AgentTextOverlay[] {
	const base = motionIdBase(slot);
	const first = freeLanes(occupied, slot, clips.length);
	return clips.map((clip, index) => ({
		id: base + index,
		content: clip.content,
		startSec: slot.startSec + clip.startSec,
		durationSec: clip.durationSec,
		preset: clip.preset,
		...(clip.style ? { style: clip.style } : {}),
		...(clip.params ? { params: clip.params } : {}),
		layout: clip.layout,
		track: first + clip.lane,
	}));
}

function plainOverlay(slot: DirectedTextSlot): AgentTextOverlay {
	return {
		content: slot.text,
		startSec: slot.startSec,
		durationSec: slot.durationSec,
		preset: "plain",
		style: { ...PLAIN_TEXT_AUTHOR_STYLE },
		layout: defaultClipLayout("text"),
	};
}

/** The text layer for directed on-screen text: a beat's motion clips where it has
 *  them (placed earlier, or authored this run), plain text otherwise. `occupied`
 *  are the overlays already placed around them, so motion takes free lanes. */
export function directedTextOverlays(
	job: AgentJob,
	slots: DirectedTextSlot[],
	occupied: readonly AgentTextOverlay[] = [],
): AgentTextOverlay[] {
	const out: AgentTextOverlay[] = [];
	for (const slot of slots) {
		const presentation = presentationOf(slot);
		const placed = presentation ? placedClips(job, slot) : [];
		const cached = presentation ? job.sceneMotion?.[motionKey(job, slot, presentation)] : undefined;
		const next = placed.length
			? placed
			: cached && "clips" in cached
				? clipOverlays(slot, cached.clips, [...occupied, ...out])
				: [plainOverlay(slot)];
		out.push(...next);
	}
	return out;
}

/** Authors motion for every eligible slot that has none placed or cached yet.
 *  Returns how many gained motion; the caller rebuilds the text layer when any did. */
export async function authorSectionMotion(
	job: AgentJob,
	slots: DirectedTextSlot[],
): Promise<number> {
	const pending = slots.filter((slot) => {
		const presentation = presentationOf(slot);
		return (
			presentation &&
			!placedClips(job, slot).length &&
			!job.sceneMotion?.[motionKey(job, slot, presentation)]
		);
	});
	const visualStyle = getStyleBible(job);
	const results = await mapWithConcurrency(pending, AUTHOR_CONCURRENCY, async (slot) => {
		const presentation = presentationOf(slot)!;
		const result = await authorMotionDesign({
			sourceText: slot.text,
			presentation,
			spanSec: slot.durationSec,
			aspect: job.aspect,
			purpose: slot.editorial?.purpose,
			visualConcept: slot.editorial?.visualConcept,
			visualStyle,
		});
		return { key: motionKey(job, slot, presentation), slot, result };
	});
	const entries = results.map(({ key, slot, result }) => {
		if (!result.ok) pushNote(job, "Motion", `"${slot.text}" stays plain text: ${result.error}`);
		else if (result.findings.length)
			pushNote(
				job,
				"Motion",
				`"${slot.text}": ${result.findings.map((f) => f.message).join("; ")}`,
			);
		return [key, result.ok ? { clips: result.clips } : { failure: result.error }] as const;
	});
	job.sceneMotion = { ...job.sceneMotion, ...Object.fromEntries(entries) };
	return entries.filter(([, entry]) => "clips" in entry).length;
}
