/* Canonical SRT interop: authored cue boundaries and explicit breaks are authoritative. */
import {
	CaptionClipSchema,
	CaptionSetSchema,
	captionTrackFor,
	estimateWordTimings,
	type Clip,
} from "@maleo/shared";
import type { EditorDoc } from "@maleo/shared/editor";

export interface SrtCue {
	startSec: number;
	endSec: number;
	text: string;
}
export interface SrtParseResult {
	cues: SrtCue[];
	malformedBlocks: number;
	overlappingCues: number;
}
const pad = (number: number, width: number) => String(number).padStart(width, "0");

export function toSrtTime(sec: number): string {
	if (!Number.isFinite(sec)) throw new Error("Subtitle time must be finite");
	const total = Math.round(Math.max(0, sec) * 1000);
	if (!Number.isSafeInteger(total)) throw new Error("Subtitle time exceeds supported range");
	return `${pad(Math.floor(total / 3600000), 2)}:${pad(Math.floor(total / 60000) % 60, 2)}:${pad(Math.floor(total / 1000) % 60, 2)},${pad(total % 1000, 3)}`;
}

export function fromSrtTime(time: string): number | null {
	const match = /^(\d+):(\d{2}):(\d{2})[,.](\d{1,3})$/u.exec(time.trim());
	if (!match || Number(match[2]) >= 60 || Number(match[3]) >= 60) return null;
	const millis =
		((Number(match[1]) * 60 + Number(match[2])) * 60 + Number(match[3])) * 1000 +
		Number(match[4]!.padEnd(3, "0"));
	return Number.isSafeInteger(millis) ? millis / 1000 : null;
}

export function parseSrt(text: string): SrtParseResult {
	const cues: SrtCue[] = [];
	let malformedBlocks = 0;
	for (const block of text
		.replace(/^\uFEFF/u, "")
		.replace(/\r\n?/gu, "\n")
		.trim()
		.split(/\n\s*\n/u)) {
		if (!block.trim()) continue;
		const lines = block.split("\n");
		const at = /^\s*\d+\s*$/u.test(lines[0] ?? "") ? 1 : 0;
		const times = /^\s*(\S+)\s*-->\s*(\S+)\s*$/u.exec(lines[at] ?? "");
		const startSec = times ? fromSrtTime(times[1]!) : null;
		const endSec = times ? fromSrtTime(times[2]!) : null;
		const content = lines
			.slice(at + 1)
			.join("\n")
			.trim();
		if (startSec === null || endSec === null || endSec <= startSec || !content) {
			malformedBlocks++;
			continue;
		}
		cues.push({ startSec, endSec, text: content });
	}
	cues.sort((left, right) => left.startSec - right.startSec);
	let end = 0;
	let overlappingCues = 0;
	for (const cue of cues) {
		if (cue.startSec < end) overlappingCues++;
		end = Math.max(end, cue.endSec);
	}
	return { cues, malformedBlocks, overlappingCues };
}

/** One complete set replacement. Caller commits this through the shared command boundary. */
export function importSrtCaptions(
	doc: EditorDoc,
	result: SrtParseResult,
	importId: string,
): EditorDoc {
	if (!result.cues.length)
		throw new Error("No valid captions found. Current captions were preserved.");
	const existing = doc.clips.filter((clip) => clip.type === "caption");
	if (existing.some((clip) => doc.trackFlags?.[clip.track]?.locked))
		throw new Error("Unlock caption tracks before replacing captions.");
	const track = captionTrackFor(doc);
	if (doc.trackFlags?.[track]?.locked)
		throw new Error("Unlock caption tracks before replacing captions.");
	const groupId = `srt:${importId}`;
	const clips = result.cues.map((cue, index) => {
		const durationSec = cue.endSec - cue.startSec;
		// Estimate in a wide local window before scaling, retaining short imported cues.
		const estimated = estimateWordTimings(cue.text, 0, cue.text.length);
		return CaptionClipSchema.parse({
			id: `caption:${importId}:${index}`,
			type: "caption",
			startSec: cue.startSec,
			durationSec,
			track,
			caption: {
				text: cue.text,
				words: estimated.map((word) => ({
					...word,
					startSec: (word.startSec / cue.text.length) * durationSec,
					endSec: (word.endSec / cue.text.length) * durationSec,
				})),
				provenance: { origin: "imported", wordTimingOrigin: "estimated" },
				sources: [],
				protection: { text: true, timing: true, segmentation: true, style: false },
				revision: 0,
				groupId,
				status: "current",
			},
		});
	});
	const captionSet = CaptionSetSchema.parse({
		initialized: true,
		language: doc.captionSet?.language ?? "auto",
		revision: (doc.captionSet?.revision ?? 0) + 1,
		deletedRanges: [],
		appliedRunIds: [],
	});
	return {
		...doc,
		captionSet,
		trackFlags: { ...doc.trackFlags, [track]: { ...doc.trackFlags?.[track], group: "caption" } },
		clips: [...doc.clips.filter((clip) => clip.type !== "caption"), ...clips],
	};
}

export function captionClipsToSrt(clips: readonly Clip[]): string {
	return (
		[...clips]
			.filter((clip) => clip.type === "caption")
			.sort((left, right) => left.startSec - right.startSec)
			.map((clip, index) => {
				const cue = CaptionClipSchema.parse(clip);
				return `${index + 1}\n${toSrtTime(cue.startSec)} --> ${toSrtTime(cue.startSec + cue.durationSec)}\n${cue.caption.text}`;
			})
			.join("\n\n") + "\n"
	);
}
