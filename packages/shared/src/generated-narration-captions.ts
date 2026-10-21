import { z } from "zod";
import {
	CaptionClipSchema,
	CaptionCueSchema,
	CaptionProvenanceSchema,
	captionTrackFor,
} from "./caption-cues.ts";
import { estimateWordTimings } from "./caption-timing.ts";
import { groupCaptionWords } from "./caption-phrases.ts";
import { captureCaptionResult } from "./caption-results.ts";
import type { EditScope, EditorDoc } from "./editor/scope.ts";
import { batch, editCaptions, type EditorCommand } from "./editor/commands.ts";

export const GeneratedCaptionSourcesSchema = z.record(
	z.string().regex(/^\/api\/media\/[0-9a-f-]{36}$/),
	z.object({ language: z.string().min(1).max(24), provenance: CaptionProvenanceSchema }),
);
export type GeneratedCaptionSources = z.infer<typeof GeneratedCaptionSourcesSchema>;

/** Only fresh synthesis explicitly supplies this map. Loading stored narration never creates cues. */
export function withGeneratedNarrationCaptions(
	doc: EditorDoc,
	sources: GeneratedCaptionSources | undefined,
	applyCommand: (scope: EditScope, command: EditorCommand) => EditScope,
): EditorDoc {
	if (!sources || !Object.keys(sources).length) return doc;
	const admitted = GeneratedCaptionSourcesSchema.parse(sources);
	let scope: EditScope = { doc, slides: [], posts: [], mediaAssets: [] };
	for (const source of doc.clips) {
		if (source.type !== "audio" || !source.audio?.url || source.audio.kind !== "voiceover")
			continue;
		const fresh = admitted[source.audio.url];
		if (!fresh) continue;
		const mediaId = /^\/api\/media\/([0-9a-f-]{36})$/.exec(source.audio.url)?.[1];
		if (!mediaId) throw new Error("Generated captions require managed narration media");
		const runId = `narration:${mediaId}:${source.id}`;
		if (scope.doc.captionSet?.appliedRunIds.includes(runId)) continue;
		const words = source.audio.words?.length
			? source.audio.words
			: estimateWordTimings(source.audio.content, source.startSec, source.durationSec);
		const track = captionTrackFor(scope.doc);
		const binding = {
			clipId: source.id,
			mediaId,
			mediaRevision: mediaId,
			sourceStartSec: source.audio.mediaStartSec ?? 0,
			sourceEndSec: (source.audio.mediaStartSec ?? 0) + source.durationSec,
		};
		const candidates = groupCaptionWords(words).map((phrase, index) =>
			CaptionClipSchema.parse({
				id: `caption:${mediaId}:${source.id}:${index}`,
				type: "caption",
				startSec: phrase.startSec,
				durationSec: phrase.endSec - phrase.startSec,
				track,
				caption: CaptionCueSchema.parse({
					text: phrase.text,
					words: phrase.words,
					provenance: {
						...fresh.provenance,
						runId,
						wordTimingOrigin:
							phrase.estimatedWordTiming || !source.audio?.words?.length
								? "estimated"
								: fresh.provenance.wordTimingOrigin,
					},
					sources: [
						{
							...binding,
							sourceStartSec: binding.sourceStartSec + phrase.startSec - source.startSec,
							sourceEndSec: binding.sourceStartSec + phrase.endSec - source.startSec,
						},
					],
					protection: { text: false, timing: false, segmentation: false, style: false },
					revision: 0,
					groupId: runId,
					status: "current",
				}),
			}),
		);
		if (!candidates.length) continue;
		const context = captureCaptionResult(scope.doc, {
			startSec: source.startSec,
			endSec: source.startSec + source.durationSec,
			sources: [binding],
		});
		scope = applyCommand(
			scope,
			batch([
				editCaptions({
					action: "apply-result",
					...context,
					candidates,
					runId,
					language: fresh.language,
					replaceEdited: false,
				}),
				{
					type: "doc.setTrackFlags",
					trackFlags: {
						...scope.doc.trackFlags,
						[track]: { ...scope.doc.trackFlags?.[track], group: "caption" },
					},
				},
			]),
		);
	}
	return scope.doc;
}
